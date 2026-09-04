import type { FastifyInstance } from 'fastify';

import { z } from 'zod';

import rateLimit from '@fastify/rate-limit';

import { prisma } from '../lib/prisma.js';

import { hashPassword, verifyPassword } from '../lib/utils.js';

import { generateResetToken, hashResetToken } from '../lib/tokens.js';

import { sendPasswordResetEmail } from '../lib/email.js';
import { getAppUrl } from '../lib/system-config.js';

import { formatCervejariaAuth } from '../lib/cervejaria-branding.js';

import {

  clearAuthCookie,

  setAuthCookie,

  signUserToken,

} from '../lib/session.js';

import {

  RATE_LIMIT_FORGOT_MAX,

  RATE_LIMIT_LOGIN_MAX,

  RATE_LIMIT_WINDOW,

} from '../lib/security-config.js';
import { emitAuthEvent } from '../lib/auth-observability.js';



const loginSchema = z.object({

  email: z.string().email(),

  senha: z.string().min(1),

});



const forgotPasswordSchema = z.object({

  email: z.string().email(),

});



const resetPasswordSchema = z.object({

  token: z.string().min(1),

  senha: z.string().min(6),

});



function authResponse(
  usuario: {
    id: string;
    nome: string;
    email: string;
    papel: string;
    cervejariaId: string | null;
    passwordChangedAt: Date;
    podeDarDescontoQuiosque?: boolean;
  },
  cervejaria: Parameters<typeof formatCervejariaAuth>[0] | null,
) {
  return {
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      papel: usuario.papel,
      podeDarDescontoQuiosque: usuario.podeDarDescontoQuiosque ?? false,
    },
    cervejaria: cervejaria ? formatCervejariaAuth(cervejaria) : null,
  };
}



export async function authRoutes(app: FastifyInstance) {

  await app.register(async (scope) => {

    await scope.register(rateLimit, {

      max: RATE_LIMIT_LOGIN_MAX,

      timeWindow: RATE_LIMIT_WINDOW,

    });



    scope.post('/login', async (request, reply) => {

      const body = loginSchema.parse(request.body);



      const usuario = await prisma.usuario.findUnique({

        where: { email: body.email },

        include: { cervejaria: true },

      });



      if (!usuario || !(await verifyPassword(body.senha, usuario.senhaHash))) {
        emitAuthEvent(request, 'auth.login.failed', { reasonCode: 'INVALID_CREDENTIALS' });

        return reply.status(401).send({ error: 'E-mail ou senha inválidos' });

      }



      if (usuario.cervejaria && !usuario.cervejaria.ativo) {

        return reply.status(403).send({

          error: 'Cervejaria desativada. Entre em contato com o administrador do sistema.',

        });

      }



      const token = signUserToken(app, usuario);

      setAuthCookie(reply, token);

      emitAuthEvent(request, 'auth.login.succeeded', { user: usuario, role: usuario.papel });

      return authResponse(usuario, usuario.cervejaria);

    });

  });



  await app.register(async (scope) => {

    await scope.register(rateLimit, {

      max: RATE_LIMIT_FORGOT_MAX,

      timeWindow: RATE_LIMIT_WINDOW,

    });



    scope.post('/forgot-password', async (request) => {

      const body = forgotPasswordSchema.parse(request.body);

      const usuario = await prisma.usuario.findUnique({ where: { email: body.email } });



      if (usuario) {

        const rawToken = generateResetToken();

        const tokenHash = hashResetToken(rawToken);

        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);



        await prisma.passwordResetToken.updateMany({

          where: { usuarioId: usuario.id, usedAt: null },

          data: { usedAt: new Date() },

        });



        await prisma.passwordResetToken.create({

          data: { usuarioId: usuario.id, tokenHash, expiresAt },

        });



        const appUrl = await getAppUrl();

        const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;

        await sendPasswordResetEmail(usuario.email, resetUrl);

      }



      return { message: 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.' };

    });

  });



  app.post('/reset-password', async (request, reply) => {

    const body = resetPasswordSchema.parse(request.body);

    const tokenHash = hashResetToken(body.token);



    const resetToken = await prisma.passwordResetToken.findUnique({

      where: { tokenHash },

      include: { usuario: true },

    });



    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {

      return reply.status(400).send({ error: 'Link inválido ou expirado. Solicite um novo.' });

    }



    const senhaHash = await hashPassword(body.senha);

    const now = new Date();



    await prisma.$transaction(async (tx) => {
      // The observable Prisma client wraps delegate calls in native Promises,
      // which cannot be passed to Prisma's array transaction API. Claim the
      // one-time token inside an interactive transaction instead.
      const claimedToken = await tx.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      if (claimedToken.count !== 1) {
        throw app.httpErrors.badRequest('Link inv\u00e1lido ou expirado. Solicite um novo.');
      }

      await tx.usuario.update({
        where: { id: resetToken.usuarioId },
        data: { senhaHash, passwordChangedAt: now },
      });
    });



    return { message: 'Senha redefinida com sucesso. Faça login com a nova senha.' };

  });



  app.post('/logout', async (request, reply) => {

    try {
      await request.jwtVerify();
      emitAuthEvent(request, 'auth.logout');
    } catch {
      // Logout is intentionally idempotent.
    }

    clearAuthCookie(reply);

    return { message: 'Logout realizado' };

  });



  app.get('/me', { preHandler: [app.authenticate] }, async (request, reply) => {

    const user = request.user;



    const usuario = await prisma.usuario.findUnique({

      where: { id: user.sub },

      include: { cervejaria: true },

    });



    if (!usuario) {

      return reply.status(404).send({ error: 'Usuário não encontrado' });

    }



    if (usuario.cervejaria && !usuario.cervejaria.ativo) {

      return reply.status(403).send({

        error: 'Cervejaria desativada. Entre em contato com o administrador do sistema.',

      });

    }



    return {
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        papel: usuario.papel,
        podeDarDescontoQuiosque: usuario.podeDarDescontoQuiosque,
      },
      cervejaria: usuario.cervejaria ? formatCervejariaAuth(usuario.cervejaria) : null,
    };

  });

}


