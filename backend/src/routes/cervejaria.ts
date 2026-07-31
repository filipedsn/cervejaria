import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getAuthUser } from '../types/auth.js';
import {
  formatCervejariaAuth,
  saveLogoAndExtractBranding,
  reextractBrandingFromLogo,
  updateBrandingColors,
} from '../lib/cervejaria-branding.js';
import { buildCervejariaDashboard } from '../lib/cervejaria-dashboard.js';

const ALLOWED_LOGO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const updateBrandingSchema = z.object({
  corPrimaria: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida. Use formato #RRGGBB'),
});

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
    const tipo = tipoRaw === 'agendado' || tipoRaw === 'avulso' ? tipoRaw : 'todos';

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
}
