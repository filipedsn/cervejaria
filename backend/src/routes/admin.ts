import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs';
import { prisma } from '../lib/prisma.js';
import { hashPassword, slugify } from '../lib/utils.js';
import {
  getMetricasMesPorCervejaria,
  getPrimeiraVendaFechada,
  listarMesesAdmin,
  metricasVazias,
  resolverMesAdmin,
  type MesAdmin,
  type MetricasMes,
} from '../lib/cervejaria-stats.js';
import { getCaixasAbertosPorCervejaria, proximoVencimento, type CaixaAbertoAdmin } from '../lib/admin-empresas.js';
import { desconectarSocketsDaCervejaria } from '../lib/realtime.js';
import {
  formatCervejariaAuth,
  reextractBrandingFromLogo,
  saveLogoAndExtractBranding,
  updateBrandingColors,
} from '../lib/cervejaria-branding.js';
import { ensureDefaultTaps } from '../lib/trailer-defaults.js';
import { adaptLegacyProvisioning, provisionEstablishment, provisionEstablishmentRequestSchema } from '../lib/provision-establishment.js';
import { canonicalPdvQaActivationEnabled } from '../lib/canonical-pdv-operational-config.js';
import { readOperationalConfig, updateOperationalConfig, updateOperationalConfigSchema } from '../lib/operational-config.js';
import { getAuthUser } from '../types/auth.js';
import {
  encryptSecret,
  getAdminSettingsResponse,
  getPlatformSettings,
  savePlatformSettings,
} from '../lib/system-config.js';
import { resetEmailTransporter, sendTestEmail } from '../lib/email.js';
import { getBackupFilePath, listBackupFiles, runDatabaseBackup } from '../lib/backup.js';

const ALLOWED_LOGO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/// Multipart entrega tudo como string, e z.coerce.boolean() trataria "false"
/// como true por ser string nao vazia.
const flagMultipart = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform<boolean | undefined>((valor) => {
    if (typeof valor === 'boolean') return valor;
    if (valor == null) return undefined;
    return valor === 'true' || valor === '1' || valor === 'on';
  });

const createCervejariaSchema = z
  .object({
    cervejariaNome: z.string().min(2),
    donoNome: z.string().min(2),
    donoEmail: z.string().email(),
    donoSenha: z.string().min(6),
    moduloCervejaria: flagMultipart,
    moduloOperacao: flagMultipart,
    operacaoControlaEstoque: flagMultipart,
    operacaoTemCozinha: flagMultipart,
  })
  .superRefine((data, ctx) => {
    if (data.moduloCervejaria === false && data.moduloOperacao !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Selecione ao menos um módulo para a empresa',
        path: ['moduloCervejaria'],
      });
    }
  });

/// Multipart envia campos vazios como "" quando o admin limpa o valor.
const dataContratoField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((valor, ctx) => {
    if (valor === undefined) return undefined;
    if (valor === null || valor.trim() === '') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
    const data = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
    if (!data || data.toISOString().slice(0, 10) !== valor.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Data de início do contrato inválida' });
      return z.NEVER;
    }
    return data;
  });

const diaVencimentoField = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((valor, ctx) => {
    if (valor === undefined) return undefined;
    if (valor === null || (typeof valor === 'string' && valor.trim() === '')) return null;
    const dia = typeof valor === 'number' ? valor : Number(valor);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Dia de vencimento deve estar entre 1 e 31' });
      return z.NEVER;
    }
    return dia;
  });

const contratoSchema = z.object({
  dataInicioContrato: dataContratoField,
  diaVencimento: diaVencimentoField,
});

function contratoData(contrato: z.output<typeof contratoSchema>) {
  return {
    ...(contrato.dataInicioContrato !== undefined ? { dataInicioContrato: contrato.dataInicioContrato } : {}),
    ...(contrato.diaVencimento !== undefined ? { diaVencimento: contrato.diaVencimento } : {}),
  };
}

const updateCervejariaSchema = z.object({
  dataInicioContrato: dataContratoField,
  diaVencimento: diaVencimentoField,
  cervejariaNome: z.string().min(2),
  donoNome: z.string().min(2),
  donoEmail: z.string().email(),
  donoSenha: z.string().optional(),
  corPrimaria: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida. Use formato #RRGGBB')
    .optional(),
  operacaoControlaEstoque: flagMultipart,
  operacaoTemCozinha: flagMultipart,
  confirmacaoEstoque: flagMultipart,
});

const toggleAtivoSchema = z.object({
  ativo: z.boolean(),
});

const settingsSchema = z.object({
  appUrl: z.string().url().optional(),
  smtp: z
    .object({
      enabled: z.boolean().optional(),
      host: z.string().optional(),
      port: z.coerce.number().int().min(1).max(65535).optional(),
      secure: z.boolean().optional(),
      user: z.string().optional(),
      pass: z.string().optional(),
      from: z.string().optional(),
    })
    .optional(),
  backup: z
    .object({
      enabled: z.boolean().optional(),
      retentionDays: z.coerce.number().int().min(1).max(365).optional(),
      scheduleHour: z.coerce.number().int().min(0).max(23).optional(),
    })
    .optional(),
});

const testEmailSchema = z.object({
  email: z.string().email(),
});

function badRequest(message: string) {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = 400;
  return err;
}

async function parseMultipartCervejaria<S extends z.ZodTypeAny>(
  request: import('fastify').FastifyRequest,
  schema: S,
): Promise<{ body: z.output<S>; logoBuffer: Buffer | null }> {
  const fields: Record<string, string> = {};
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
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }

  return { body: schema.parse(fields), logoBuffer };
}

function formatAdminCervejaria(
  c: {
    id: string;
    nome: string;
    slug: string;
    ativo: boolean;
    logoUrl: string | null;
    corPrimaria: string | null;
    corPaleta: unknown;
    exibirKpisComanda: boolean;
    comandasColunaUnica: boolean;
    comandasAlarmeAtivo: boolean;
    comandasAlarmeIntervaloSegundos: number;
    usaCardapio: boolean;
    updatedAt: Date;
    dataInicioContrato?: Date | null;
    diaVencimento?: number | null;
    configuracaoOperacao?: {
      ativo: boolean;
      exclusivo: boolean;
      controlaEstoque: boolean;
      temCozinha: boolean;
    } | null;
    configuracaoOperacional?: {
      plannedOperationsEnabled: boolean | null;
      inventoryEnabled: boolean | null;
      kitchenEnabled: boolean | null;
    } | null;
    _count?: { usuarios: number; eventos: number };
    usuarios?: Array<{ id: string; nome: string; email: string }>;
  },
  metricasMes?: MetricasMes,
  caixasAbertos: CaixaAbertoAdmin[] = [],
) {
  const branding = formatCervejariaAuth(c);
  const operacao = c.configuracaoOperacao;
  const operacional = c.configuracaoOperacional;
  const temOperacao = operacional
    ? operacional.plannedOperationsEnabled !== null || operacional.inventoryEnabled === true || operacional.kitchenEnabled === true
    : operacao?.ativo === true;
  const temCervejaria = !temOperacao || operacao?.exclusivo !== true;

  return {
    ...branding,
    ativo: c.ativo,
    modulos: {
      cervejaria: temCervejaria,
      operacao: temOperacao,
      operacaoControlaEstoque: operacional?.inventoryEnabled ?? (temOperacao && operacao?.controlaEstoque === true),
      operacaoTemCozinha: operacional?.kitchenEnabled ?? (temOperacao && operacao?.temCozinha === true),
    },
    contrato: {
      dataInicio: c.dataInicioContrato ? c.dataInicioContrato.toISOString().slice(0, 10) : null,
      diaVencimento: c.diaVencimento ?? null,
      proximoVencimento: proximoVencimento(c.diaVencimento ?? null, c.dataInicioContrato ?? null),
    },
    metricasMes,
    caixasAbertos,
    _count: c._count,
    usuarios: c.usuarios,
  };
}

async function formatAdminCervejariaComMes(
  c: Parameters<typeof formatAdminCervejaria>[0],
  mes: MesAdmin = resolverMesAdmin(undefined)!,
) {
  const [metricas, caixas] = await Promise.all([
    getMetricasMesPorCervejaria(mes, c.id),
    getCaixasAbertosPorCervejaria(c.id),
  ]);
  return formatAdminCervejaria(c, metricas.get(c.id) ?? metricasVazias(mes), caixas.get(c.id) ?? []);
}

async function mapCervejariasList(mes: MesAdmin) {
  const [cervejarias, metricasMap, caixasMap] = await Promise.all([
    prisma.cervejaria.findMany({
      orderBy: { nome: 'asc' },
      select: {
        id: true,
        nome: true,
        slug: true,
        ativo: true,
        logoUrl: true,
        corPrimaria: true,
        corPaleta: true,
        exibirKpisComanda: true,
        comandasColunaUnica: true,
        comandasAlarmeAtivo: true,
        comandasAlarmeIntervaloSegundos: true,
        usaCardapio: true,
        updatedAt: true,
        dataInicioContrato: true,
        diaVencimento: true,
        _count: { select: { usuarios: true, eventos: true } },
        configuracaoOperacao: {
          select: {
            ativo: true,
            exclusivo: true,
            controlaEstoque: true,
            temCozinha: true,
          },
        },
        configuracaoOperacional: {
          select: {
            plannedOperationsEnabled: true,
            inventoryEnabled: true,
            kitchenEnabled: true,
          },
        },
        usuarios: {
          where: { papel: 'DONO' },
          select: { id: true, nome: true, email: true },
          take: 1,
        },
      },
    }),
    getMetricasMesPorCervejaria(mes),
    getCaixasAbertosPorCervejaria(),
  ]);

  return cervejarias.map((c) =>
    formatAdminCervejaria(c, metricasMap.get(c.id) ?? metricasVazias(mes), caixasMap.get(c.id) ?? []),
  );
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireAdmin);

  app.get('/cervejarias', async (request, reply) => {
    const { mes: chave } = request.query as { mes?: string };
    const mes = resolverMesAdmin(chave);
    if (!mes) return reply.status(400).send({ error: 'Mês inválido. Use o formato AAAA-MM e um mês até o atual.' });
    return mapCervejariasList(mes);
  });

  app.get('/metricas/meses', async () => ({
    meses: listarMesesAdmin(await getPrimeiraVendaFechada()),
  }));

  app.get('/cervejarias/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const cervejaria = await prisma.cervejaria.findUnique({
      where: { id },
      include: {
        configuracaoOperacao: {
          select: {
            ativo: true,
            exclusivo: true,
            controlaEstoque: true,
            temCozinha: true,
          },
        },
        configuracaoOperacional: {
          select: {
            plannedOperationsEnabled: true,
            inventoryEnabled: true,
            kitchenEnabled: true,
          },
        },
        usuarios: {
          where: { papel: 'DONO' },
          select: { id: true, nome: true, email: true },
          take: 1,
        },
      },
    });
    if (!cervejaria) return reply.status(404).send({ error: 'Cervejaria não encontrada' });
    return formatAdminCervejaria(cervejaria);
  });

  // The operational configuration is shared with the owner portal.  Admin
  // never writes the legacy module projection.
  app.get('/cervejarias/:id/configuracao-operacional', async (request, reply) => {
    const { id } = request.params as { id: string };
    const configuration = await readOperationalConfig(id);
    if (!configuration) return reply.status(404).send({ error: 'Configuração operacional não encontrada' });
    return configuration;
  });

  app.patch('/cervejarias/:id/configuracao-operacional', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.cervejaria.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return reply.status(404).send({ error: 'Cervejaria não encontrada' });
    const body = updateOperationalConfigSchema.parse(request.body);
    const user = getAuthUser(request);
    return prisma.$transaction((tx) => updateOperationalConfig(tx, id, body, { userId: user.sub, role: 'ADMIN' }));
  });

  app.post('/cervejarias/provision', async (request, reply) => {
    const canonical = canonicalPdvQaActivationEnabled();
    const body = provisionEstablishmentRequestSchema.parse(request.body);
    const contrato = contratoData(contratoSchema.parse(request.body ?? {}));
    const existing = await prisma.usuario.findUnique({ where: { email: body.dono.email }, select: { id: true } });
    if (existing) return reply.status(409).send({ error: 'E-mail do proprietário já cadastrado' });
    let slug = slugify(body.nome);
    if (await prisma.cervejaria.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;
    const senhaHash = await hashPassword(body.dono.senha);
    let result: Awaited<ReturnType<typeof provisionEstablishment>>;
    try {
      result = await prisma.$transaction(async (tx) => {
        const provisioned = await provisionEstablishment(tx, {
          ...body,
          slug,
          dono: { ...body.dono, senhaHash },
        }, { mode: canonical ? 'CANONICAL' : 'LEGACY' });
        if (Object.keys(contrato).length > 0) {
          await tx.cervejaria.update({ where: { id: provisioned.cervejaria.id }, data: contrato, select: { id: true } });
        }
        return provisioned;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return reply.status(409).send({ error: 'Empresa ou proprietário já cadastrado.' });
      throw error;
    }
    return reply.status(201).send(canonical ? result : {
      cervejaria: result.cervejaria,
      dono: result.dono,
      configuracaoOperacional: result.configuracaoOperacional,
    });
  });

  app.post('/cervejarias', async (request, reply) => {
    const canonical = canonicalPdvQaActivationEnabled();
    const { body, logoBuffer } = await parseMultipartCervejaria(request, createCervejariaSchema);

    const existing = await prisma.usuario.findUnique({ where: { email: body.donoEmail }, select: { id: true } });
    if (existing) {
      return reply.status(409).send({ error: 'E-mail do proprietário já cadastrado' });
    }

    let slug = slugify(body.cervejariaNome);
    const slugExists = await prisma.cervejaria.findUnique({ where: { slug } });
    if (slugExists) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    const senhaHash = await hashPassword(body.donoSenha);

    const moduloOperacao = body.moduloOperacao === true;
    const moduloCervejaria = body.moduloCervejaria !== false;

    const legacy = adaptLegacyProvisioning({
      cervejariaNome: body.cervejariaNome,
      donoNome: body.donoNome,
      donoEmail: body.donoEmail,
      senhaHash,
      moduloCervejaria,
      moduloOperacao,
      operacaoControlaEstoque: body.operacaoControlaEstoque === true,
      operacaoTemCozinha: body.operacaoTemCozinha === true,
    }, slug);
    let result: Awaited<ReturnType<typeof provisionEstablishment>>;
    try {
      result = await prisma.$transaction((tx) => provisionEstablishment(tx, legacy.input, {
        ...legacy.resources,
        mode: canonical ? 'CANONICAL' : 'LEGACY',
      }));
    } catch (error) {
      if (isUniqueConstraintError(error)) return reply.status(409).send({ error: 'Empresa ou proprietário já cadastrado.' });
      throw error;
    }

    let cervejaria = result.cervejaria;
    if (logoBuffer) {
      cervejaria = await saveLogoAndExtractBranding(cervejaria.id, logoBuffer);
    }

    // Temporary compatibility only: legacy Trailer/tap provisioning remains
    // active while canonical provisioning is disabled. The canonical path
    // stores taps capability on its PDV and never substitutes a Trailer.
    if (!canonical && legacy.resources.createTrailer) {
      const trailer = await prisma.trailer.findFirst({
        where: { cervejariaId: cervejaria.id },
        orderBy: { createdAt: 'asc' },
      });
      if (trailer) await ensureDefaultTaps(trailer.id, cervejaria.id);
    }

    return reply.status(201).send({ cervejaria, dono: result.dono });
  });

  app.patch('/cervejarias/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const admin = getAuthUser(request);
    const { body, logoBuffer } = await parseMultipartCervejaria(request, updateCervejariaSchema);

    const existing = await prisma.cervejaria.findUnique({
      where: { id },
      include: { usuarios: { where: { papel: 'DONO' }, take: 1, select: { id: true, nome: true, email: true } } },
    });
    if (!existing) return reply.status(404).send({ error: 'Cervejaria não encontrada' });

    const dono = existing.usuarios[0];
    if (!dono) return reply.status(400).send({ error: 'Cervejaria sem proprietário vinculado' });

    if (body.donoEmail !== dono.email) {
      const emailTaken = await prisma.usuario.findUnique({ where: { email: body.donoEmail }, select: { id: true } });
      if (emailTaken) return reply.status(409).send({ error: 'E-mail do proprietário já cadastrado' });
    }

    let slug = existing.slug;
    if (body.cervejariaNome !== existing.nome) {
      slug = slugify(body.cervejariaNome);
      const slugTaken = await prisma.cervejaria.findFirst({ where: { slug, NOT: { id } } });
      if (slugTaken) slug = `${slug}-${Date.now().toString(36)}`;
    }

    await prisma.$transaction(async (tx) => {
      await tx.cervejaria.update({
        where: { id },
        data: {
          nome: body.cervejariaNome,
          slug,
          ...contratoData({ dataInicioContrato: body.dataInicioContrato, diaVencimento: body.diaVencimento }),
        },
      });

      const donoData: { nome: string; email: string; senhaHash?: string; passwordChangedAt?: Date } = {
        nome: body.donoNome,
        email: body.donoEmail,
      };
      if (body.donoSenha && body.donoSenha.length >= 6) {
        donoData.senhaHash = await hashPassword(body.donoSenha);
        donoData.passwordChangedAt = new Date();
      }
      await tx.usuario.update({ where: { id: dono.id }, data: donoData, select: { id: true } });

      if (
        body.operacaoTemCozinha !== undefined ||
        body.operacaoControlaEstoque !== undefined
      ) {
        await updateOperationalConfig(tx, id, {
          ...(body.operacaoTemCozinha !== undefined ? { kitchenEnabled: body.operacaoTemCozinha } : {}),
          ...(body.operacaoControlaEstoque !== undefined
            ? {
                inventoryEnabled: body.operacaoControlaEstoque,
                ...(body.confirmacaoEstoque === true ? { confirmacaoEstoque: true as const } : {}),
              }
            : {}),
        }, { userId: admin.sub, role: 'ADMIN' });
      }
    });

    if (logoBuffer) {
      await saveLogoAndExtractBranding(id, logoBuffer);
    }
    if (body.corPrimaria) {
      await updateBrandingColors(id, body.corPrimaria);
    }

    const updated = await prisma.cervejaria.findUnique({
      where: { id },
      include: {
        _count: { select: { usuarios: true, eventos: true } },
        configuracaoOperacao: {
          select: { ativo: true, exclusivo: true, controlaEstoque: true, temCozinha: true },
        },
        configuracaoOperacional: {
          select: { plannedOperationsEnabled: true, inventoryEnabled: true, kitchenEnabled: true },
        },
        usuarios: { where: { papel: 'DONO' }, select: { id: true, nome: true, email: true }, take: 1 },
      },
    });

    if (!updated) return reply.status(404).send({ error: 'Cervejaria não encontrada' });
    return formatAdminCervejariaComMes(updated);
  });

  app.post('/cervejarias/:id/branding/reextract', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.cervejaria.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Cervejaria não encontrada' });

    await reextractBrandingFromLogo(id);
    const withOwner = await prisma.cervejaria.findUnique({
      where: { id },
      include: {
        _count: { select: { usuarios: true, eventos: true } },
        usuarios: { where: { papel: 'DONO' }, select: { id: true, nome: true, email: true }, take: 1 },
      },
    });
    if (!withOwner) return reply.status(404).send({ error: 'Cervejaria não encontrada' });
    return formatAdminCervejariaComMes(withOwner);
  });

  app.patch('/cervejarias/:id/ativo', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = toggleAtivoSchema.parse(request.body);

    const resultado = await prisma.$transaction(async (tx) => {
      // FOR UPDATE espera aberturas de caixa em andamento (que travam a linha em FOR SHARE).
      const linhas = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM public."Cervejaria" WHERE "id" = ${id} FOR UPDATE
      `;
      if (linhas.length === 0) return { status: 'nao_encontrada' as const };

      if (!body.ativo) {
        const caixas = (await getCaixasAbertosPorCervejaria(id, tx)).get(id) ?? [];
        if (caixas.length > 0) return { status: 'caixa_aberto' as const, caixas };
      }

      const cervejaria = await tx.cervejaria.update({
        where: { id },
        data: { ativo: body.ativo },
        include: {
          _count: { select: { usuarios: true, eventos: true } },
          usuarios: {
            where: { papel: 'DONO' },
            select: { id: true, nome: true, email: true },
            take: 1,
          },
        },
      });
      return { status: 'ok' as const, cervejaria };
    });

    if (resultado.status === 'nao_encontrada') {
      return reply.status(404).send({ error: 'Cervejaria não encontrada' });
    }
    if (resultado.status === 'caixa_aberto') {
      const locais = resultado.caixas.map((caixa) => caixa.local).join(', ');
      return reply.status(409).send({
        error: `Não é possível desativar: há caixa aberto (${locais}). Feche o caixa antes de desativar a empresa.`,
        code: 'CASH_REGISTER_OPEN',
        caixasAbertos: resultado.caixas,
      });
    }

    if (!body.ativo) await desconectarSocketsDaCervejaria(app.io, id);
    return resultado.cervejaria;
  });

  app.get('/settings', async () => getAdminSettingsResponse());

  app.patch('/settings', async (request) => {
    const body = settingsSchema.parse(request.body);
    const current = await getPlatformSettings();

    const smtpUpdate = { ...current.smtp, ...body.smtp };
    if (body.smtp?.pass !== undefined && body.smtp.pass.length > 0) {
      smtpUpdate.passEnc = encryptSecret(body.smtp.pass);
    }

    const next = await savePlatformSettings({
      appUrl: body.appUrl ?? current.appUrl,
      smtp: smtpUpdate,
      backup: body.backup ? { ...current.backup, ...body.backup } : current.backup,
    });

    resetEmailTransporter();

    return getAdminSettingsResponse().then((resp) => ({
      ...resp,
      appUrl: next.appUrl,
      smtp: {
        enabled: next.smtp.enabled,
        host: next.smtp.host,
        port: next.smtp.port,
        secure: next.smtp.secure,
        user: next.smtp.user,
        from: next.smtp.from,
        passConfigured: Boolean(next.smtp.passEnc),
      },
      backup: next.backup,
      smtpSource: 'database' as const,
    }));
  });

  app.post('/settings/smtp/test', async (request, reply) => {
    const { email } = testEmailSchema.parse(request.body);
    try {
      await sendTestEmail(email);
      return { message: `E-mail de teste enviado para ${email}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao enviar e-mail de teste';
      return reply.status(400).send({ error: msg });
    }
  });

  app.get('/settings/backups', async () => ({
    files: listBackupFiles(),
    ...(await getAdminSettingsResponse()),
  }));

  app.post('/settings/backups/run', async (_request, reply) => {
    try {
      const file = await runDatabaseBackup();
      return { message: 'Backup concluído', file };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao executar backup';
      return reply.status(500).send({ error: msg });
    }
  });

  app.get('/settings/backups/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const filepath = getBackupFilePath(filename);
    if (!filepath) return reply.status(404).send({ error: 'Backup não encontrado' });

    const stream = fs.createReadStream(filepath);
    reply.header('Content-Type', 'application/sql');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(stream);
  });
}
