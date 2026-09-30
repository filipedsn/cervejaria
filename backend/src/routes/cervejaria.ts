import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getAuthUser } from '../types/auth.js';
import {
  formatCervejariaAuth,
  saveLogoAndExtractBranding,
  savePortalBackground,
  reextractBrandingFromLogo,
  updateBrandingColors,
} from '../lib/cervejaria-branding.js';
import { buildCervejariaDashboard } from '../lib/cervejaria-dashboard.js';
import { getOperationalProfile } from '../lib/operational-profile.js';
import { updateOperationalConfig, updateOperationalConfigSchema } from '../lib/operational-config.js';
import { recalcComandaTotalInTx } from '../lib/comanda-service.js';
import { recalcComandaTotalOperacao } from '../lib/operacao/comanda-adapter.js';

const ALLOWED_LOGO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_BACKGROUND_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const updateBrandingSchema = z.object({
  corPrimaria: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida. Use formato #RRGGBB'),
});

const updateChavePixSchema = z.object({
  chavePix: z.string().trim().max(200, 'A chave PIX deve ter no máximo 200 caracteres').nullable(),
});

const updateOperacaoSchema = z
  .object({
    exibirKpisComanda: z.boolean().optional(),
    comandasColunaUnica: z.boolean().optional(),
    // Mantido para que clientes antigos ainda possam enviar a preferência;
    // o valor é ignorado porque o fluxo tradicional agora é único.
    usaCardapio: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.exibirKpisComanda !== undefined ||
      body.comandasColunaUnica !== undefined ||
      body.usaCardapio !== undefined,
    { message: 'Informe ao menos uma preferência' },
  );

function badRequest(message: string) {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = 400;
  return err;
}

async function getDonoCervejaria(request: import('fastify').FastifyRequest) {
  const user = getAuthUser(request);
  if (!user.cervejariaId) {
    const err = new Error('Usuário sem cervejaria vinculada') as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }

  const cervejaria = await prisma.cervejaria.findUnique({ where: { id: user.cervejariaId } });
  if (!cervejaria) {
    const err = new Error('Cervejaria não encontrada') as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }

  return cervejaria;
}

export async function cervejariaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireDono);

  app.get('/dashboard', async (request, reply) => {
    const user = getAuthUser(request);
    const now = new Date();
    const query = request.query as { ano?: string; mes?: string; trailerId?: string; tipo?: string };
    const ano = query.ano ? Number.parseInt(query.ano, 10) : now.getFullYear();
    const mes = query.mes ? Number.parseInt(query.mes, 10) : now.getMonth() + 1;
    const trailerId = query.trailerId?.trim() || undefined;
    const tipoRaw = query.tipo?.trim();
    const tipo = tipoRaw === 'agendado' || tipoRaw === 'avulso' || tipoRaw === 'caixa' ? tipoRaw : 'todos';

    if (!Number.isFinite(ano) || !Number.isFinite(mes) || mes < 1 || mes > 12) {
      return reply.status(400).send({ error: 'Período inválido' });
    }
    if (ano > now.getFullYear() || (ano === now.getFullYear() && mes > now.getMonth() + 1)) {
      return reply.status(400).send({ error: 'Não é possível consultar períodos futuros' });
    }

    return buildCervejariaDashboard(user.cervejariaId!, ano, mes, trailerId, tipo);
  });

  app.get('/branding', async (request) => {
    const cervejaria = await getDonoCervejaria(request);
    return formatCervejariaAuth(cervejaria);
  });

  app.patch('/branding', async (request) => {
    const user = getAuthUser(request);
    const body = updateBrandingSchema.parse(request.body);
    const updated = await updateBrandingColors(user.cervejariaId!, body.corPrimaria);
    return formatCervejariaAuth(updated);
  });

  app.patch('/chave-pix', async (request) => {
    const user = getAuthUser(request);
    const body = updateChavePixSchema.parse(request.body);
    const updated = await prisma.cervejaria.update({
      where: { id: user.cervejariaId! },
      data: { chavePix: body.chavePix || null },
    });
    return formatCervejariaAuth(updated);
  });

  app.patch('/operacao', async (request) => {
    const user = getAuthUser(request);
    const body = updateOperacaoSchema.parse(request.body);
    const updated = await prisma.cervejaria.update({
      where: { id: user.cervejariaId! },
      data: {
        ...(body.exibirKpisComanda !== undefined ? { exibirKpisComanda: body.exibirKpisComanda } : {}),
        ...(body.comandasColunaUnica !== undefined ? { comandasColunaUnica: body.comandasColunaUnica } : {}),
      },
    });
    return formatCervejariaAuth(updated);
  });

  app.get('/configuracao-operacional', async (request) => {
    const user = getAuthUser(request);
    const [configuration, profile] = await Promise.all([
      prisma.configuracaoOperacional.findUnique({ where: { cervejariaId: user.cervejariaId! } }),
      getOperationalProfile(user.cervejariaId!),
    ]);
    return {
      configuration,
      enablements: profile?.capabilities ?? { cashMode: false, plannedOperations: false, taps: false, inventory: false, kitchen: false },
    };
  });

  app.patch('/configuracao-operacional', async (request) => {
    const user = getAuthUser(request);
    const body = updateOperationalConfigSchema.parse(request.body);
    return prisma.$transaction(async (tx) => {
      const updated = await updateOperationalConfig(tx, user.cervejariaId!, body);
      if (body.kitchenItemsChargeAtLaunch !== undefined) {
        const openComandas = await tx.comanda.findMany({
          where: {
            status: 'ABERTA',
            OR: [
              { evento: { cervejariaId: user.cervejariaId! } },
              { origem: 'CAIXA', pontoVenda: { cervejariaId: user.cervejariaId! } },
            ],
          },
          select: { id: true, origem: true },
        });
        for (const comanda of openComandas) {
          if (comanda.origem === 'CAIXA') await recalcComandaTotalOperacao(tx, comanda.id);
          else await recalcComandaTotalInTx(tx, comanda.id);
        }
      }
      return updated;
    });
  });

  app.post('/branding/reextract', async (request) => {
    const user = getAuthUser(request);
    const updated = await reextractBrandingFromLogo(user.cervejariaId!);
    return formatCervejariaAuth(updated);
  });

  app.post('/branding/logo', async (request) => {
    const user = getAuthUser(request);
    let logoBuffer: Buffer | null = null;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'logo') continue;
        if (!ALLOWED_LOGO_TYPES.has(part.mimetype)) {
          throw badRequest('Formato de logo inválido. Use PNG, JPG, WEBP ou GIF.');
        }
        logoBuffer = await part.toBuffer();
        if (logoBuffer.length > 5 * 1024 * 1024) {
          throw badRequest('Logo deve ter no máximo 5 MB.');
        }
      }
    }

    if (!logoBuffer) {
      throw badRequest('Nenhuma imagem enviada.');
    }

    const updated = await saveLogoAndExtractBranding(user.cervejariaId!, logoBuffer);
    return formatCervejariaAuth(updated);
  });

  app.post('/branding/portal-background', async (request) => {
    const user = getAuthUser(request);
    let imageBuffer: Buffer | null = null;

    for await (const part of request.parts()) {
      if (part.type !== 'file' || part.fieldname !== 'background') continue;
      if (!ALLOWED_BACKGROUND_TYPES.has(part.mimetype)) {
        throw badRequest('Formato inválido. Use PNG, JPG ou WEBP.');
      }
      imageBuffer = await part.toBuffer();
      if (imageBuffer.length > 5 * 1024 * 1024) {
        throw badRequest('A imagem deve ter no máximo 5 MB.');
      }
    }

    if (!imageBuffer) throw badRequest('Nenhuma imagem enviada.');
    try {
      const updated = await savePortalBackground(user.cervejariaId!, imageBuffer);
      return formatCervejariaAuth(updated);
    } catch (err) {
      if (err instanceof Error && 'statusCode' in err) throw err;
      throw badRequest('A imagem enviada não pôde ser processada. Escolha outro arquivo.');
    }
  });

  app.delete('/branding/portal-background', async (request) => {
    const user = getAuthUser(request);
    const updated = await prisma.cervejaria.update({
      where: { id: user.cervejariaId! },
      data: { portalBackgroundUrl: null },
    });
    return formatCervejariaAuth(updated);
  });
}
