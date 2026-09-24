import { prisma } from '../../src/lib/prisma.js';
import { hashPassword, verifyPassword } from '../../src/lib/utils.js';
import { generateResetToken, hashResetToken } from '../../src/lib/tokens.js';
import { api } from './http.js';
import type { TenantFixture } from './types.js';

type TestStatus = 'passed' | 'failed' | 'skipped' | 'warning';

interface Outcome {
  status?: TestStatus;
  message?: string;
  details?: string;
  expected?: string;
  actual?: string;
}

type TestFn = (
  meta: { id: string; category: string; name: string; requirement?: string },
  fn: () => Promise<Outcome>,
) => Promise<void>;

/** Fluxo forgot/reset de senha (dev: token via DB, SMTP opcional). */
export async function runAuthResetTests(tenant: TenantFixture, test: TestFn) {
  const stamp = Date.now();
  const email = `auth-reset-${stamp}@qa.test`;
  const senhaInicial = 'qa123456';
  const senhaNova = 'nova654321';
  const senhaHash = await hashPassword(senhaInicial);

  const usuario = await prisma.usuario.create({
    data: {
      nome: 'QA Reset',
      email,
      senhaHash,
      papel: 'ATENDENTE',
      cervejariaId: tenant.cervejariaId,
    },
  });

  try {
    await test(
      { id: 'AUTH-RP-01', category: 'Auth reset', name: 'Forgot e-mail desconhecido → 200 genérico', requirement: 'AUTH-RP' },
      async () => {
        const r = await api<{ message?: string }>('POST', '/api/auth/forgot-password', {
          body: { email: `nao-existe-${stamp}@qa.test` },
        });
        if (r.status !== 200 || !r.data.message?.includes('cadastrado')) {
          return {
            status: 'failed',
            message: 'Resposta genérica esperada',
            expected: '200',
            actual: `${r.status} ${r.raw.slice(0, 120)}`,
          };
        }
        return { message: 'Sem enumeração de e-mail', expected: '200', actual: '200' };
      },
    );

    await test(
      { id: 'AUTH-RP-02', category: 'Auth reset', name: 'Forgot e-mail válido cria token', requirement: 'AUTH-RP' },
      async () => {
        const antes = await prisma.passwordResetToken.count({ where: { usuarioId: usuario.id, usedAt: null } });
        const r = await api('POST', '/api/auth/forgot-password', { body: { email } });
        const depois = await prisma.passwordResetToken.count({ where: { usuarioId: usuario.id, usedAt: null } });
        if (r.status !== 200) {
          return { status: 'failed', message: 'Forgot falhou', expected: '200', actual: `${r.status} ${r.raw.slice(0, 180)}` };
        }
        if (depois <= antes) {
          return {
            status: 'failed',
            message: 'Token de reset não criado',
            expected: `${antes + 1}`,
            actual: String(depois),
          };
        }
        return { message: 'Token criado no banco', expected: '≥1 ativo', actual: String(depois) };
      },
    );

    const rawToken = generateResetToken();
    await prisma.passwordResetToken.create({
      data: {
        usuarioId: usuario.id,
        tokenHash: hashResetToken(rawToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await test(
      { id: 'AUTH-RP-03', category: 'Auth reset', name: 'Reset com token válido → 200', requirement: 'AUTH-RP' },
      async () => {
        const r = await api<{ message?: string }>('POST', '/api/auth/reset-password', {
          body: { token: rawToken, senha: senhaNova },
        });
        if (r.status !== 200 || !r.data.message?.includes('sucesso')) {
          return {
            status: 'failed',
            message: 'Reset deveria concluir',
            expected: '200',
            actual: `${r.status} ${r.raw.slice(0, 160)}`,
          };
        }
        const row = await prisma.usuario.findUnique({ where: { id: usuario.id }, select: { senhaHash: true } });
        if (!row?.senhaHash) {
          return { status: 'failed', message: 'Hash ausente após reset' };
        }
        const okNova = await verifyPassword(senhaNova, row.senhaHash);
        const okAntiga = await verifyPassword(senhaInicial, row.senhaHash);
        if (!okNova || okAntiga) {
          return {
            status: 'failed',
            message: 'Senha não atualizada corretamente',
            expected: 'nova OK / antiga rejeitada',
            actual: `nova=${okNova} antiga=${okAntiga}`,
          };
        }
        const login = await api('POST', '/api/auth/login', { body: { email, senha: senhaNova } });
        if (login.status !== 200) {
          return {
            status: 'failed',
            message: 'Login com a nova senha falhou',
            expected: '200',
            actual: String(login.status),
          };
        }
        return { message: 'Senha redefinida', expected: '200', actual: '200' };
      },
    );

    await test(
      { id: 'AUTH-RP-04', category: 'Auth reset', name: 'Reutilizar token → 400', requirement: 'AUTH-RP' },
      async () => {
        const r = await api('POST', '/api/auth/reset-password', {
          body: { token: rawToken, senha: 'outra123456' },
        });
        if (r.status !== 400) {
          return { status: 'failed', message: 'Token usado deve falhar', expected: '400', actual: String(r.status) };
        }
        return { message: 'Token single-use', expected: '400', actual: '400' };
      },
    );

    await test(
      { id: 'AUTH-RP-05', category: 'Auth reset', name: 'Token inválido → 400', requirement: 'AUTH-RP' },
      async () => {
        const r = await api('POST', '/api/auth/reset-password', {
          body: { token: 'token-invalido-qa', senha: 'abc123456' },
        });
        if (r.status !== 400) {
          return { status: 'failed', message: 'Token inválido', expected: '400', actual: String(r.status) };
        }
        return { message: 'Rejeição de token inválido', expected: '400', actual: '400' };
      },
    );

    const expiredToken = generateResetToken();
    await prisma.passwordResetToken.create({
      data: {
        usuarioId: usuario.id,
        tokenHash: hashResetToken(expiredToken),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });

    await test(
      { id: 'AUTH-RP-06', category: 'Auth reset', name: 'Expired token returns 400', requirement: 'AUTH-RP' },
      async () => {
        const r = await api('POST', '/api/auth/reset-password', {
          body: { token: expiredToken, senha: 'abc123456' },
        });
        if (r.status !== 400) {
          return { status: 'failed', message: 'Expired token must fail', expected: '400', actual: String(r.status) };
        }
        return { message: 'Expired token rejected', expected: '400', actual: '400' };
      },
    );

    const concurrentToken = generateResetToken();
    await prisma.passwordResetToken.create({
      data: {
        usuarioId: usuario.id,
        tokenHash: hashResetToken(concurrentToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await test(
      { id: 'AUTH-RP-07', category: 'Auth reset', name: 'Concurrent reset consumes token once without 500', requirement: 'AUTH-RP-03' },
      async () => {
        const [first, second] = await Promise.all([
          api('POST', '/api/auth/reset-password', { body: { token: concurrentToken, senha: 'concorrente123' } }),
          api('POST', '/api/auth/reset-password', { body: { token: concurrentToken, senha: 'concorrente123' } }),
        ]);
        const statuses = [first.status, second.status].sort((a, b) => a - b);
        if (statuses[0] !== 200 || statuses[1] !== 400) {
          return {
            status: 'failed',
            message: 'Only one request may consume the token',
            expected: '200 and 400',
            actual: statuses.join(' and '),
          };
        }
        return { message: 'Token consumed once without 500', expected: '200 and 400', actual: statuses.join(' and ') };
      },
    );
  } finally {
    await prisma.passwordResetToken.deleteMany({ where: { usuarioId: usuario.id } });
    await prisma.usuario.delete({ where: { id: usuario.id } });
  }
}
