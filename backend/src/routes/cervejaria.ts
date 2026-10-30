import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
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
import { requirePermissaoOuDono } from '../lib/operacao/permissoes.js';
import { getOperationalProfile } from '../lib/operational-profile.js';
import { readOperationalConfig, updateOperationalConfig, updateOperationalConfigSchema } from '../lib/operational-config.js';
import { syncCategoriaChopeComTorneiras } from '../lib/operacao/categoria-chope-torneiras.js';
import {
  categoriasElegiveisAlertaBalcao,
  categoriasVisiveisNoPortal,
  listCategoriasEstabelecimento,
} from '../lib/portal-categorias.js';

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

  app.get('/configuracao-portal-categorias', { preHandler: [app.requireDono] }, async (request) => {
    const user = getAuthUser(request);
    const [brewery, names] = await Promise.all([
      prisma.cervejaria.findUniqueOrThrow({ where: { id: user.cervejariaId! }, select: { portalCategoriasPermitidas: true } }),
      listCategoriasEstabelecimento(user.cervejariaId!),
    ]);
    return {
      categorias: names,
      categoriasPermitidas: Array.isArray(brewery.portalCategoriasPermitidas) ? brewery.portalCategoriasPermitidas : null,
    };
  });

  app.put('/configuracao-portal-categorias', { preHandler: [app.requireDono] }, async (request) => {
    const user = getAuthUser(request);
    const body = z.object({ categoriasPermitidas: z.array(z.string().trim().min(1).max(100)).max(200).nullable() }).parse(request.body);
    const names = await listCategoriasEstabelecimento(user.cervejariaId!);
    const known = new Set(names);
    if (body.categoriasPermitidas?.some((name) => !known.has(name))) throw badRequest('Uma ou mais categorias não pertencem a este estabelecimento');
    const categories = body.categoriasPermitidas === null ? null : [...new Set(body.categoriasPermitidas)];
    const brewery = await prisma.cervejaria.findUniqueOrThrow({
      where: { id: user.cervejariaId! },
      select: { portalAlertaBalcaoCategorias: true },
    });
    const { alertaAtivo } = categoriasElegiveisAlertaBalcao(names, categories, brewery.portalAlertaBalcaoCategorias);
    await prisma.cervejaria.update({
      where: { id: user.cervejariaId! },
      data: {
        portalCategoriasPermitidas: categories === null ? Prisma.DbNull : categories,
        portalAlertaBalcaoCategorias: alertaAtivo === null ? Prisma.DbNull : alertaAtivo,
      },
    });
    return { categorias: names, categoriasPermitidas: categories };
  });

  app.get('/configuracao-portal-alerta-balcao', { preHandler: [app.requireDono] }, async (request) => {
    const user = getAuthUser(request);
    const [brewery, names] = await Promise.all([
      prisma.cervejaria.findUniqueOrThrow({
        where: { id: user.cervejariaId! },
        select: { portalAlertaBalcaoCategorias: true, portalCategoriasPermitidas: true },
      }),
      listCategoriasEstabelecimento(user.cervejariaId!),
    ]);
    const { elegiveis, alertaAtivo } = categoriasElegiveisAlertaBalcao(
      names,
      brewery.portalCategoriasPermitidas,
      brewery.portalAlertaBalcaoCategorias,
    );
    return {
      categorias: elegiveis,
      categoriasAlertaBalcao: alertaAtivo,
    };
  });

  app.put('/configuracao-portal-alerta-balcao', { preHandler: [app.requireDono] }, async (request) => {
    const user = getAuthUser(request);
    const body = z.object({ categoriasAlertaBalcao: z.array(z.string().trim().min(1).max(100)).max(200).nullable() }).parse(request.body);
    const [names, brewery] = await Promise.all([
      listCategoriasEstabelecimento(user.cervejariaId!),
      prisma.cervejaria.findUniqueOrThrow({
        where: { id: user.cervejariaId! },
        select: { portalCategoriasPermitidas: true },
      }),
    ]);
    const elegiveis = categoriasVisiveisNoPortal(names, brewery.portalCategoriasPermitidas);
    const known = new Set(elegiveis);
    if (body.categoriasAlertaBalcao?.some((name) => !known.has(name))) {
      throw badRequest('Só é possível alertar categorias disponíveis no portal do cliente');
    }
    const categories = body.categoriasAlertaBalcao === null ? null : [...new Set(body.categoriasAlertaBalcao)];
    await prisma.cervejaria.update({
      where: { id: user.cervejariaId! },
      data: { portalAlertaBalcaoCategorias: categories === null ? Prisma.DbNull : categories },
    });
    return { categorias: elegiveis, categoriasAlertaBalcao: categories };
  });

  app.get('/dashboard', { preHandler: [requirePermissaoOuDono(app, 'dashboard.read')] }, async (request, reply) => {
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

  app.get('/branding', { preHandler: [app.requireDono] }, async (request) => {
    const cervejaria = await getDonoCervejaria(request);
    return formatCervejariaAuth(cervejaria);
  });

  app.patch('/branding', { preHandler: [app.requireDono] }, async (request) => {
    const user = getAuthUser(request);
    const body = updateBrandingSchema.parse(request.body);
    const updated = await updateBrandingColors(user.cervejariaId!, body.corPrimaria);
    return formatCervejariaAuth(updated);
  });

  app.patch('/chave-pix', { preHandler: [app.requireDono] }, async (request) => {
    const user = getAuthUser(request);
    const body = updateChavePixSchema.parse(request.body);
    const updated = await prisma.cervejaria.update({
      where: { id: user.cervejariaId! },
      data: { chavePix: body.chavePix || null },
    });
    return formatCervejariaAuth(updated);
  });

  app.patch('/operacao', { preHandler: [app.requireDono] }, async (request) => {
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

  app.get('/configuracao-operacional', { preHandler: [app.requireDono] }, async (request) => {
    const user = getAuthUser(request);
    const configuration = await readOperationalConfig(user.cervejariaId!);
    const canonical = configuration && 'configurationSource' in configuration && configuration.configurationSource === 'CANONICAL_PDV';
    const profile = canonical ? null : await getOperationalProfile(user.cervejariaId!);
    return {
      // The client must distinguish confirmed LEGACY from a missing or failed
      // configuration read before showing mode-specific controls.
      configurationSource: canonical ? 'CANONICAL_PDV' as const : 'LEGACY' as const,
      configuration,
      enablements: canonical
        ? {
            cashMode: true,
            cashRegister: true,
            plannedOperations: false,
            taps: configuration.tapsEnabled,
            inventory: configuration.inventoryEnabled,
            kitchen: configuration.kitchenEnabled,
          }
        : profile?.capabilities ?? { cashMode: false, cashRegister: false, plannedOperations: false, taps: false, inventory: false, kitchen: false },
    };
  });

  app.patch('/configuracao-operacional', { preHandler: [app.requireDono] }, async (request) => {
    const user = getAuthUser(request);
    const body = updateOperationalConfigSchema.parse(request.body);
    const updated = await prisma.$transaction((tx) =>
      updateOperationalConfig(tx, user.cervejariaId!, body, { userId: user.sub, role: 'DONO' }),
    );
    if (body.tapsEnabled !== undefined) {
      await syncCategoriaChopeComTorneiras(user.cervejariaId!, body.tapsEnabled);
    }
    return updated;
  });

  app.post('/branding/reextract', { preHandler: [app.requireDono] }, async (request) => {
    const user = getAuthUser(request);
    const updated = await reextractBrandingFromLogo(user.cervejariaId!);
    return formatCervejariaAuth(updated);
  });

  app.post('/branding/logo', { preHandler: [app.requireDono] }, async (request) => {
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

  app.post('/branding/portal-background', { preHandler: [app.requireDono] }, async (request) => {
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

  app.delete('/branding/portal-background', { preHandler: [app.requireDono] }, async (request) => {
    const user = getAuthUser(request);
    const updated = await prisma.cervejaria.update({
      where: { id: user.cervejariaId! },
      data: { portalBackgroundUrl: null },
    });
    return formatCervejariaAuth(updated);
  });
}
