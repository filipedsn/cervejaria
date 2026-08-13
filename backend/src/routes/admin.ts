import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs';
import { prisma } from '../lib/prisma.js';
import { hashPassword, slugify } from '../lib/utils.js';
import {
  getStatsMesAtualPorCervejaria,
  emptyMesAtualStats,
  getMesAtualLabel,
} from '../lib/cervejaria-stats.js';
import {
  formatCervejariaAuth,
  reextractBrandingFromLogo,
  saveLogoAndExtractBranding,
  updateBrandingColors,
} from '../lib/cervejaria-branding.js';
import { ensureDefaultTaps } from '../lib/trailer-defaults.js';
import { ativarModuloQuiosque } from '../lib/quiosque/modulo.js';
import {
  encryptSecret,
  getAdminSettingsResponse,
  getPlatformSettings,
  savePlatformSettings,
} from '../lib/system-config.js';
import { resetEmailTransporter, sendTestEmail } from '../lib/email.js';
import { getBackupFilePath, listBackupFiles, runDatabaseBackup } from '../lib/backup.js';

const ALLOWED_LOGO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/// Multipart entrega tudo como string, e z.coerce.boolean() trataria "false"
/// como true por ser string nao vazia.
const flagMultipart = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((valor) => {
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
    moduloQuiosque: flagMultipart,
    quiosqueControlaEstoque: flagMultipart,
    quiosqueTemCozinha: flagMultipart,
  })
  .superRefine((data, ctx) => {
    if (data.moduloCervejaria === false && data.moduloQuiosque !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Selecione ao menos um módulo para a empresa',
        path: ['moduloCervejaria'],
      });
    }
  });

const updateCervejariaSchema = z.object({
  cervejariaNome: z.string().min(2),
  donoNome: z.string().min(2),
  donoEmail: z.string().email(),
  donoSenha: z.string().optional(),
  corPrimaria: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida. Use formato #RRGGBB')
    .optional(),
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

async function parseMultipartCervejaria<T>(
  request: import('fastify').FastifyRequest,
  schema: z.ZodType<T>,
) {
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
    configuracaoQuiosque?: {
      ativo: boolean;
      exclusivo: boolean;
      controlaEstoque: boolean;
      temCozinha: boolean;
    } | null;
    _count?: { usuarios: number; eventos: number };
    usuarios?: Array<{ id: string; nome: string; email: string }>;
  },
  mesAtual?: ReturnType<typeof emptyMesAtualStats>,
) {
  const branding = formatCervejariaAuth(c);
  const quiosque = c.configuracaoQuiosque;
  const temQuiosque = quiosque?.ativo === true;
  const temCervejaria = !temQuiosque || !quiosque.exclusivo;

  return {
    ...branding,
    ativo: c.ativo,
    modulos: {
      cervejaria: temCervejaria,
      quiosque: temQuiosque,
      quiosqueControlaEstoque: temQuiosque && quiosque.controlaEstoque,
      quiosqueTemCozinha: temQuiosque && quiosque.temCozinha,
    },
    mesAtual,
    _count: c._count,
    usuarios: c.usuarios,
  };
}

async function mapCervejariasList() {
  const [cervejarias, statsMap] = await Promise.all([
    prisma.cervejaria.findMany({
      orderBy: { nome: 'asc' },
      include: {
        _count: { select: { usuarios: true, eventos: true } },
        configuracaoQuiosque: {
          select: {
            ativo: true,
            exclusivo: true,
            controlaEstoque: true,
            temCozinha: true,
          },
        },
        usuarios: {
          where: { papel: 'DONO' },
          select: { id: true, nome: true, email: true },
          take: 1,
        },
      },
    }),
    getStatsMesAtualPorCervejaria(),
  ]);

  const mesLabel = getMesAtualLabel();

  return cervejarias.map((c) =>
    formatAdminCervejaria(c, statsMap.get(c.id) ?? emptyMesAtualStats(mesLabel)),
  );
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireAdmin);

  app.get('/cervejarias', async () => mapCervejariasList());

  app.get('/cervejarias/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const cervejaria = await prisma.cervejaria.findUnique({
      where: { id },
      include: {
        configuracaoQuiosque: {
          select: {
            ativo: true,
            exclusivo: true,
            controlaEstoque: true,
            temCozinha: true,
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

  app.post('/cervejarias', async (request, reply) => {
    const { body, logoBuffer } = await parseMultipartCervejaria(request, createCervejariaSchema);

    const existing = await prisma.usuario.findUnique({ where: { email: body.donoEmail } });
    if (existing) {
      return reply.status(409).send({ error: 'E-mail do proprietário já cadastrado' });
    }

    let slug = slugify(body.cervejariaNome);
    const slugExists = await prisma.cervejaria.findUnique({ where: { slug } });
    if (slugExists) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    const senhaHash = await hashPassword(body.donoSenha);

    const moduloQuiosque = body.moduloQuiosque === true;
    const moduloCervejaria = body.moduloCervejaria !== false;

    const result = await prisma.$transaction(async (tx) => {
      const cervejaria = await tx.cervejaria.create({
        data: {
          nome: body.cervejariaNome,
          slug,
          // Trailer e taps sao artefatos da cervejaria: empresa so de quiosque
          // nao nasce com eles.
          ...(moduloCervejaria ? { trailers: { create: { nome: 'Principal' } } } : {}),
        },
      });

      const dono = await tx.usuario.create({
        data: {
          nome: body.donoNome,
          email: body.donoEmail,
          senhaHash,
          papel: 'DONO',
          cervejariaId: cervejaria.id,
        },
        select: { id: true, nome: true, email: true, papel: true },
      });

      if (moduloQuiosque) {
        await ativarModuloQuiosque(tx, {
          cervejariaId: cervejaria.id,
          controlaEstoque: body.quiosqueControlaEstoque === true,
          temCozinha: body.quiosqueTemCozinha === true,
          exclusivo: !moduloCervejaria,
        });
      }

      return { cervejaria, dono };
    });

    let cervejaria = result.cervejaria;
    if (logoBuffer) {
      cervejaria = await saveLogoAndExtractBranding(cervejaria.id, logoBuffer);
    }

    if (moduloCervejaria) {
      const trailer = await prisma.trailer.findFirst({
        where: { cervejariaId: cervejaria.id },
        orderBy: { createdAt: 'asc' },
      });
      if (trailer) {
        await ensureDefaultTaps(trailer.id, cervejaria.id);
      }
    }

    return reply.status(201).send({ cervejaria, dono: result.dono });
  });

  app.patch('/cervejarias/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { body, logoBuffer } = await parseMultipartCervejaria(request, updateCervejariaSchema);

    const existing = await prisma.cervejaria.findUnique({
      where: { id },
      include: { usuarios: { where: { papel: 'DONO' }, take: 1 } },
    });
    if (!existing) return reply.status(404).send({ error: 'Cervejaria não encontrada' });

    const dono = existing.usuarios[0];
    if (!dono) return reply.status(400).send({ error: 'Cervejaria sem proprietário vinculado' });

    if (body.donoEmail !== dono.email) {
      const emailTaken = await prisma.usuario.findUnique({ where: { email: body.donoEmail } });
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
        data: { nome: body.cervejariaNome, slug },
      });

      const donoData: { nome: string; email: string; senhaHash?: string; passwordChangedAt?: Date } = {
        nome: body.donoNome,
        email: body.donoEmail,
      };
      if (body.donoSenha && body.donoSenha.length >= 6) {
        donoData.senhaHash = await hashPassword(body.donoSenha);
        donoData.passwordChangedAt = new Date();
      }
      await tx.usuario.update({ where: { id: dono.id }, data: donoData });
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
        usuarios: { where: { papel: 'DONO' }, select: { id: true, nome: true, email: true }, take: 1 },
      },
    });

    if (!updated) return reply.status(404).send({ error: 'Cervejaria não encontrada' });
    const statsMap = await getStatsMesAtualPorCervejaria();
    return formatAdminCervejaria(updated, statsMap.get(id) ?? emptyMesAtualStats(getMesAtualLabel()));
  });

  app.post('/cervejarias/:id/branding/reextract', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.cervejaria.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Cervejaria não encontrada' });

    await reextractBrandingFromLogo(id);
    const statsMap = await getStatsMesAtualPorCervejaria();
    const withOwner = await prisma.cervejaria.findUnique({
      where: { id },
      include: {
        _count: { select: { usuarios: true, eventos: true } },
        usuarios: { where: { papel: 'DONO' }, select: { id: true, nome: true, email: true }, take: 1 },
      },
    });
    if (!withOwner) return reply.status(404).send({ error: 'Cervejaria não encontrada' });
    return formatAdminCervejaria(withOwner, statsMap.get(id) ?? emptyMesAtualStats(getMesAtualLabel()));
  });

  app.patch('/cervejarias/:id/ativo', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = toggleAtivoSchema.parse(request.body);

    const existing = await prisma.cervejaria.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Cervejaria não encontrada' });
    }

    const cervejaria = await prisma.cervejaria.update({
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

    return cervejaria;
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
