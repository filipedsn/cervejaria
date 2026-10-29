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
import { parseCervejariaDashboardPeriodo } from '../lib/cervejaria-dashboard-periodo.js';
import { requirePermissaoOuDono } from '../lib/operacao/permissoes.js';
import { getOperationalProfile } from '../lib/operational-profile.js';
import { readOperationalConfig, updateOperationalConfig, updateOperationalConfigSchema } from '../lib/operational-config.js';

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
    const [brewery, categories, legacyCategories] = await Promise.all([
      prisma.cervejaria.findUniqueOrThrow({ where: { id: user.cervejariaId! }, select: { portalCategoriasPermitidas: true } }),
      prisma.categoriaProdutoPdv.findMany({ where: { cervejariaId: user.cervejariaId! }, orderBy: [{ nomeNormalizado: 'asc' }, { nome: 'asc' }], select: { nome: true } }),
      prisma.produto.findMany({ where: { cervejariaId: user.cervejariaId!, ativo: true, categoria: { not: null } }, distinct: ['categoria'], select: { categoria: true } }),
    ]);
    const names = [...new Set([...categories.map((category) => category.nome), ...legacyCategories.map((category) => category.categoria).filter((name): name is string => Boolean(name)), 'Outros'])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return {
      categorias: names,
      categoriasPermitidas: Array.isArray(brewery.portalCategoriasPermitidas) ? brewery.portalCategoriasPermitidas : null,
    };
  });

  app.put('/configuracao-portal-categorias', { preHandler: [app.requireDono] }, async (request) => {
    const user = getAuthUser(request);
    const body = z.object({ categoriasPermitidas: z.array(z.string().trim().min(1).max(100)).max(200).nullable() }).parse(request.body);
    const [existing, legacyCategories] = await Promise.all([
      prisma.categoriaProdutoPdv.findMany({ where: { cervejariaId: user.cervejariaId! }, select: { nome: true } }),
      prisma.produto.findMany({ where: { cervejariaId: user.cervejariaId!, ativo: true, categoria: { not: null } }, distinct: ['categoria'], select: { categoria: true } }),
    ]);
    const names = [...new Set([...existing.map((category) => category.nome), ...legacyCategories.map((category) => category.categoria).filter((name): name is string => Boolean(name)), 'Outros'])];
    const known = new Set(names);
    if (body.categoriasPermitidas?.some((name) => !known.has(name))) throw badRequest('Uma ou mais categorias não pertencem a este estabelecimento');
    const categories = body.categoriasPermitidas === null ? null : [...new Set(body.categoriasPermitidas)];
    await prisma.cervejaria.update({ where: { id: user.cervejariaId! }, data: { portalCategoriasPermitidas: categories === null ? Prisma.DbNull : categories } });
    return { categorias: names, categoriasPermitidas: categories };
  });

  app.get('/dashboard', { preHandler: [requirePermissaoOuDono(app, 'dashboard.read')] }, async (request, reply) => {
    const user = getAuthUser(request);
    const query = request.query as { modo?: string; ano?: string; mes?: string; de?: string; ate?: string; trailerId?: string; tipo?: string };
    const trailerId = query.trailerId?.trim() || undefined;
    const tipoRaw = query.tipo?.trim();
    const tipo = tipoRaw === 'agendado' || tipoRaw === 'avulso' || tipoRaw === 'caixa' ? tipoRaw : 'todos';
    const parsed = parseCervejariaDashboardPeriodo(query);
    if (!parsed.ok) {
      return reply.status(400).send({
        error: parsed.error === 'Período futuro indisponível'
          ? 'Não é possível consultar períodos futuros'
          : parsed.error,
      });
    }

    return buildCervejariaDashboard(user.cervejariaId!, parsed.periodo, trailerId, tipo);
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
    return prisma.$transaction((tx) => updateOperationalConfig(tx, user.cervejariaId!, body, { userId: user.sub, role: 'DONO' }));
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
