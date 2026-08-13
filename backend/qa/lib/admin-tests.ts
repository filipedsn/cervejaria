import { prisma } from '../../src/lib/prisma.js';
import { api } from './http.js';
import type { QaContext } from './types.js';

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

interface CervejariaAdmin {
  id: string;
  nome: string;
  slug: string;
  ativo?: boolean;
  logoUrl?: string | null;
  corPrimaria?: string | null;
  modulos?: {
    cervejaria: boolean;
    quiosque: boolean;
    quiosqueControlaEstoque: boolean;
    quiosqueTemCozinha: boolean;
  };
}

/** PNG 1x1 válido — o suficiente para o pipeline de branding extrair cor. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Cadastro nos 3 modos, branding, ativação, settings e backups. */
export async function runAdminTests(ctx: QaContext, test: TestFn) {
  const adminToken = ctx.admin?.token;
  if (!adminToken) {
    await test(
      { id: 'ADM-00', category: 'Admin', name: 'Seed ADMIN', requirement: 'ADM' },
      async () => ({ status: 'failed', message: 'Token de ADMIN ausente no contexto' }),
    );
    return;
  }

  const stamp = Date.now();
  const donoToken = ctx.tenants[0]?.donoToken ?? '';
  const criadas: string[] = [];
  let cervejariaId = '';
  let quiosqueId = '';
  let hibridaId = '';

  function novoCadastro(sufixo: string, extras: Record<string, string> = {}) {
    return {
      cervejariaNome: `QA Admin ${sufixo} ${stamp}`,
      donoNome: `Dono ${sufixo}`,
      donoEmail: `qa-adm-${sufixo}-${stamp}@qa.test`,
      donoSenha: 'qa123456',
      ...extras,
    };
  }

  await test(
    { id: 'ADM-01', category: 'Admin', name: 'DONO não acessa rotas de admin → 403', requirement: 'ADM-01' },
    async () => {
      if (!donoToken) return { status: 'skipped', message: 'Token de dono indisponível' };
      const r = await api('GET', '/api/admin/cervejarias', { token: donoToken });
      if (r.status !== 403) {
        return { status: 'failed', message: 'DONO acessou admin', expected: '403', actual: String(r.status) };
      }
      return { message: 'Painel restrito ao ADMIN', expected: '403', actual: '403' };
    },
  );

  await test(
    { id: 'ADM-02', category: 'Admin', name: 'Cadastro modo cervejaria cria trailer e taps', requirement: 'ADM-02' },
    async () => {
      const r = await api<{ cervejaria: CervejariaAdmin }>('POST', '/api/admin/cervejarias', {
        token: adminToken,
        multipart: { fields: novoCadastro('cerv', { moduloCervejaria: 'true', moduloQuiosque: 'false' }) },
      });
      if (r.status !== 201 || !r.data?.cervejaria?.id) {
        return { status: 'failed', message: 'Cadastro cervejaria', expected: '201', actual: `${r.status} ${r.raw.slice(0, 120)}` };
      }
      cervejariaId = r.data.cervejaria.id;
      criadas.push(cervejariaId);

      const trailers = await prisma.trailer.count({ where: { cervejariaId } });
      const taps = await prisma.tap.count({ where: { cervejariaId } });
      const quiosque = await prisma.configuracaoQuiosque.findUnique({ where: { cervejariaId } });
      if (trailers !== 1 || taps === 0 || quiosque) {
        return {
          status: 'failed',
          message: 'Artefatos do modo cervejaria',
          expected: '1 trailer / taps > 0 / sem quiosque',
          actual: `${trailers} / ${taps} / quiosque=${Boolean(quiosque)}`,
        };
      }
      return { message: `1 trailer e ${taps} taps padrão`, expected: 'taps > 0', actual: String(taps) };
    },
  );

  await test(
    { id: 'ADM-03', category: 'Admin', name: 'Cadastro modo quiosque exclusivo sem trailer', requirement: 'ADM-03' },
    async () => {
      const r = await api<{ cervejaria: CervejariaAdmin }>('POST', '/api/admin/cervejarias', {
        token: adminToken,
        multipart: {
          fields: novoCadastro('quio', {
            moduloCervejaria: 'false',
            moduloQuiosque: 'true',
            quiosqueControlaEstoque: 'true',
            quiosqueTemCozinha: 'false',
          }),
        },
      });
      if (r.status !== 201 || !r.data?.cervejaria?.id) {
        return { status: 'failed', message: 'Cadastro quiosque', expected: '201', actual: `${r.status} ${r.raw.slice(0, 120)}` };
      }
      quiosqueId = r.data.cervejaria.id;
      criadas.push(quiosqueId);

      const trailers = await prisma.trailer.count({ where: { cervejariaId: quiosqueId } });
      const cfg = await prisma.configuracaoQuiosque.findUnique({ where: { cervejariaId: quiosqueId } });
      if (trailers !== 0 || !cfg?.exclusivo || !cfg.controlaEstoque || cfg.temCozinha) {
        return {
          status: 'failed',
          message: 'Config do quiosque exclusivo',
          expected: '0 trailers / exclusivo / estoque on / cozinha off',
          actual: `${trailers} / ${cfg?.exclusivo} / ${cfg?.controlaEstoque} / ${cfg?.temCozinha}`,
        };
      }
      const pontos = await prisma.pontoVenda.count({ where: { cervejariaId: quiosqueId } });
      if (pontos === 0) return { status: 'failed', message: 'Ponto de venda padrão ausente' };
      return { message: 'Quiosque exclusivo sem trailer', expected: 'exclusivo', actual: 'exclusivo' };
    },
  );

  await test(
    { id: 'ADM-04', category: 'Admin', name: 'Cadastro modo híbrido liga os dois módulos', requirement: 'ADM-04' },
    async () => {
      const r = await api<{ cervejaria: CervejariaAdmin }>('POST', '/api/admin/cervejarias', {
        token: adminToken,
        multipart: {
          fields: novoCadastro('hib', {
            moduloCervejaria: 'true',
            moduloQuiosque: 'true',
            quiosqueControlaEstoque: 'true',
            quiosqueTemCozinha: 'true',
          }),
        },
      });
      if (r.status !== 201 || !r.data?.cervejaria?.id) {
        return { status: 'failed', message: 'Cadastro híbrido', expected: '201', actual: `${r.status} ${r.raw.slice(0, 120)}` };
      }
      hibridaId = r.data.cervejaria.id;
      criadas.push(hibridaId);

      const trailers = await prisma.trailer.count({ where: { cervejariaId: hibridaId } });
      const cfg = await prisma.configuracaoQuiosque.findUnique({ where: { cervejariaId: hibridaId } });
      if (trailers !== 1 || !cfg || cfg.exclusivo || !cfg.temCozinha) {
        return {
          status: 'failed',
          message: 'Config híbrida',
          expected: '1 trailer / não exclusivo / cozinha on',
          actual: `${trailers} / ${cfg?.exclusivo} / ${cfg?.temCozinha}`,
        };
      }
      return { message: 'Híbrida com trailer + quiosque', expected: 'ambos', actual: 'ambos' };
    },
  );

  await test(
    { id: 'ADM-05', category: 'Admin', name: 'Cadastro sem nenhum módulo → 400', requirement: 'ADM-05' },
    async () => {
      const r = await api('POST', '/api/admin/cervejarias', {
        token: adminToken,
        multipart: { fields: novoCadastro('semmod', { moduloCervejaria: 'false', moduloQuiosque: 'false' }) },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Empresa sem módulo aceita', expected: '400', actual: String(r.status) };
      }
      return { message: 'superRefine exige um módulo', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'ADM-06', category: 'Admin', name: 'E-mail de dono duplicado → 409', requirement: 'ADM-06' },
    async () => {
      if (!cervejariaId) return { status: 'failed', message: 'ADM-02 incompleto' };
      const r = await api('POST', '/api/admin/cervejarias', {
        token: adminToken,
        multipart: {
          fields: {
            cervejariaNome: `QA Admin Dup ${stamp}`,
            donoNome: 'Dono Duplicado',
            donoEmail: `qa-adm-cerv-${stamp}@qa.test`,
            donoSenha: 'qa123456',
            moduloCervejaria: 'true',
          },
        },
      });
      if (r.status !== 409) {
        return { status: 'failed', message: 'E-mail duplicado aceito', expected: '409', actual: String(r.status) };
      }
      return { message: 'E-mail do dono é único', expected: '409', actual: '409' };
    },
  );

  await test(
    { id: 'ADM-07', category: 'Admin', name: 'Logo com mimetype proibido → 400', requirement: 'ADM-07' },
    async () => {
      const r = await api('POST', '/api/admin/cervejarias', {
        token: adminToken,
        multipart: {
          fields: novoCadastro('badlogo', { moduloCervejaria: 'true' }),
          files: [
            {
              fieldname: 'logo',
              filename: 'malicioso.svg',
              contentType: 'image/svg+xml',
              content: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
            },
          ],
        },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'SVG aceito como logo', expected: '400', actual: String(r.status) };
      }
      const orfã = await prisma.cervejaria.findFirst({ where: { nome: `QA Admin badlogo ${stamp}` } });
      if (orfã) {
        criadas.push(orfã.id);
        return { status: 'failed', message: 'Cervejaria criada apesar do erro de logo', expected: 'nenhuma', actual: orfã.id };
      }
      return { message: 'Só PNG/JPG/WEBP/GIF', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'ADM-08', category: 'Admin', name: 'Logo acima de 5 MB → 400', requirement: 'ADM-08' },
    async () => {
      const grande = Buffer.concat([PNG_1X1, Buffer.alloc(5 * 1024 * 1024 + 1024, 0)]);
      const r = await api('POST', '/api/admin/cervejarias', {
        token: adminToken,
        multipart: {
          fields: novoCadastro('biglogo', { moduloCervejaria: 'true' }),
          files: [{ fieldname: 'logo', filename: 'grande.png', contentType: 'image/png', content: grande }],
        },
      });
      if (r.status !== 400 && r.status !== 413) {
        return { status: 'failed', message: 'Logo gigante aceita', expected: '400/413', actual: String(r.status) };
      }
      const orfã = await prisma.cervejaria.findFirst({ where: { nome: `QA Admin biglogo ${stamp}` } });
      if (orfã) criadas.push(orfã.id);
      return { message: `Limite de 5 MB aplicado (${r.status})`, expected: '400/413', actual: String(r.status) };
    },
  );

  await test(
    { id: 'ADM-09', category: 'Admin', name: 'Upload de logo extrai branding', requirement: 'ADM-09' },
    async () => {
      if (!cervejariaId) return { status: 'failed', message: 'ADM-02 incompleto' };
      const r = await api<CervejariaAdmin>('PATCH', `/api/admin/cervejarias/${cervejariaId}`, {
        token: adminToken,
        multipart: {
          fields: {
            cervejariaNome: `QA Admin cerv ${stamp}`,
            donoNome: 'Dono cerv',
            donoEmail: `qa-adm-cerv-${stamp}@qa.test`,
          },
          files: [{ fieldname: 'logo', filename: 'logo.png', contentType: 'image/png', content: PNG_1X1 }],
        },
      });
      if (r.status !== 200) {
        return { status: 'failed', message: 'Upload de logo', expected: '200', actual: `${r.status} ${r.raw.slice(0, 120)}` };
      }
      const persistida = await prisma.cervejaria.findUnique({
        where: { id: cervejariaId },
        select: { logoUrl: true, corPrimaria: true },
      });
      if (!persistida?.logoUrl) {
        return { status: 'failed', message: 'logoUrl não persistida', expected: 'caminho', actual: 'null' };
      }
      return {
        message: `Logo ${persistida.logoUrl} · cor ${persistida.corPrimaria ?? 'n/d'}`,
        expected: 'logoUrl salva',
        actual: 'salva',
      };
    },
  );

  await test(
    { id: 'ADM-10', category: 'Admin', name: 'Cor primária inválida → 400', requirement: 'ADM-10' },
    async () => {
      if (!cervejariaId) return { status: 'failed', message: 'ADM-02 incompleto' };
      const r = await api('PATCH', `/api/admin/cervejarias/${cervejariaId}`, {
        token: adminToken,
        multipart: {
          fields: {
            cervejariaNome: `QA Admin cerv ${stamp}`,
            donoNome: 'Dono cerv',
            donoEmail: `qa-adm-cerv-${stamp}@qa.test`,
            corPrimaria: 'vermelho',
          },
        },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Cor inválida aceita', expected: '400', actual: String(r.status) };
      }
      return { message: 'Cor exige #RRGGBB', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'ADM-11', category: 'Admin', name: 'Cor primária válida é aplicada', requirement: 'ADM-11' },
    async () => {
      if (!cervejariaId) return { status: 'failed', message: 'ADM-02 incompleto' };
      const r = await api<CervejariaAdmin>('PATCH', `/api/admin/cervejarias/${cervejariaId}`, {
        token: adminToken,
        multipart: {
          fields: {
            cervejariaNome: `QA Admin cerv ${stamp}`,
            donoNome: 'Dono cerv',
            donoEmail: `qa-adm-cerv-${stamp}@qa.test`,
            corPrimaria: '#1A2B3C',
          },
        },
      });
      if (r.status !== 200) {
        return { status: 'failed', message: 'Aplicar cor', expected: '200', actual: String(r.status) };
      }
      const persistida = await prisma.cervejaria.findUnique({
        where: { id: cervejariaId },
        select: { corPrimaria: true },
      });
      if (persistida?.corPrimaria?.toUpperCase() !== '#1A2B3C') {
        return { status: 'failed', message: 'Cor persistida', expected: '#1A2B3C', actual: String(persistida?.corPrimaria) };
      }
      return { message: 'Cor #1A2B3C aplicada', expected: '#1A2B3C', actual: '#1A2B3C' };
    },
  );

  await test(
    { id: 'ADM-12', category: 'Admin', name: 'Reextract sem logo → 400/404', requirement: 'ADM-12' },
    async () => {
      if (!quiosqueId) return { status: 'failed', message: 'ADM-03 incompleto' };
      const r = await api('POST', `/api/admin/cervejarias/${quiosqueId}/branding/reextract`, { token: adminToken });
      if (r.status === 200) {
        return { status: 'failed', message: 'Reextract sem logo devolveu 200', expected: '400/404', actual: '200' };
      }
      if (r.status !== 400 && r.status !== 404) {
        return { status: 'failed', message: 'Reextract sem logo', expected: '400/404', actual: String(r.status) };
      }
      return { message: `Sem logo, sem reextract (${r.status})`, expected: '400/404', actual: String(r.status) };
    },
  );

  await test(
    { id: 'ADM-13', category: 'Admin', name: 'Reextract com logo recalcula paleta', requirement: 'ADM-13' },
    async () => {
      if (!cervejariaId) return { status: 'failed', message: 'ADM-02 incompleto' };
      const r = await api<CervejariaAdmin>('POST', `/api/admin/cervejarias/${cervejariaId}/branding/reextract`, {
        token: adminToken,
      });
      if (r.status !== 200) {
        return { status: 'failed', message: 'Reextract', expected: '200', actual: `${r.status} ${r.raw.slice(0, 120)}` };
      }
      const persistida = await prisma.cervejaria.findUnique({
        where: { id: cervejariaId },
        select: { corPrimaria: true },
      });
      // Reextract volta a derivar da logo, sobrescrevendo a cor manual do ADM-11.
      if (persistida?.corPrimaria?.toUpperCase() === '#1A2B3C') {
        return {
          status: 'failed',
          message: 'Reextract não recalculou a cor',
          expected: '≠ #1A2B3C',
          actual: String(persistida?.corPrimaria),
        };
      }
      return { message: `Paleta recalculada (${persistida?.corPrimaria})`, expected: 'derivada da logo', actual: 'recalculada' };
    },
  );

  await test(
    { id: 'ADM-14', category: 'Admin', name: 'Desativar empresa bloqueia login do dono', requirement: 'ADM-14' },
    async () => {
      if (!hibridaId) return { status: 'failed', message: 'ADM-04 incompleto' };
      const off = await api('PATCH', `/api/admin/cervejarias/${hibridaId}/ativo`, {
        token: adminToken,
        body: { ativo: false },
      });
      if (off.status !== 200) {
        return { status: 'failed', message: 'Desativar', expected: '200', actual: String(off.status) };
      }

      const login = await api('POST', '/api/auth/login', {
        body: { email: `qa-adm-hib-${stamp}@qa.test`, senha: 'qa123456' },
      });
      if (login.status !== 403) {
        return { status: 'failed', message: 'Login em empresa inativa', expected: '403', actual: String(login.status) };
      }

      const on = await api('PATCH', `/api/admin/cervejarias/${hibridaId}/ativo`, {
        token: adminToken,
        body: { ativo: true },
      });
      if (on.status !== 200) {
        return { status: 'failed', message: 'Reativar', expected: '200', actual: String(on.status) };
      }
      const relogin = await api('POST', '/api/auth/login', {
        body: { email: `qa-adm-hib-${stamp}@qa.test`, senha: 'qa123456' },
      });
      if (relogin.status !== 200) {
        return { status: 'failed', message: 'Login após reativar', expected: '200', actual: String(relogin.status) };
      }
      return { message: 'Desativa bloqueia, reativa libera', expected: '403 → 200', actual: '403 → 200' };
    },
  );

  await test(
    { id: 'ADM-15', category: 'Admin', name: 'Cervejaria inexistente → 404', requirement: 'ADM-15' },
    async () => {
      const r = await api('PATCH', '/api/admin/cervejarias/nao-existe-qa/ativo', {
        token: adminToken,
        body: { ativo: true },
      });
      if (r.status !== 404) {
        return { status: 'failed', message: 'ID inexistente', expected: '404', actual: String(r.status) };
      }
      return { message: '404 em ID inexistente', expected: '404', actual: '404' };
    },
  );

  await test(
    { id: 'ADM-16', category: 'Admin', name: 'GET /settings expõe config sem vazar senha', requirement: 'ADM-16' },
    async () => {
      const r = await api<{ smtp?: Record<string, unknown>; backup?: Record<string, unknown> }>(
        'GET',
        '/api/admin/settings',
        { token: adminToken },
      );
      if (r.status !== 200 || !r.data?.smtp || !r.data.backup) {
        return { status: 'failed', message: 'Settings', expected: '200 com smtp e backup', actual: String(r.status) };
      }
      if ('pass' in r.data.smtp || 'passEnc' in r.data.smtp) {
        return { status: 'failed', message: 'Senha SMTP exposta', expected: 'sem pass', actual: Object.keys(r.data.smtp).join(',') };
      }
      return { message: 'Config sem segredo em claro', expected: 'sem pass', actual: 'sem pass' };
    },
  );

  await test(
    { id: 'ADM-17', category: 'Admin', name: 'PATCH /settings persiste retenção de backup', requirement: 'ADM-17' },
    async () => {
      const original = await api<{ backup?: { retentionDays?: number } }>('GET', '/api/admin/settings', {
        token: adminToken,
      });
      const anterior = original.data?.backup?.retentionDays ?? 7;
      const alvo = anterior === 21 ? 14 : 21;

      const r = await api<{ backup?: { retentionDays?: number } }>('PATCH', '/api/admin/settings', {
        token: adminToken,
        body: { backup: { retentionDays: alvo } },
      });
      if (r.status !== 200 || r.data?.backup?.retentionDays !== alvo) {
        return {
          status: 'failed',
          message: 'Persistir retenção',
          expected: String(alvo),
          actual: `${r.status} ${r.data?.backup?.retentionDays}`,
        };
      }

      await api('PATCH', '/api/admin/settings', {
        token: adminToken,
        body: { backup: { retentionDays: anterior } },
      });
      return { message: `Retenção ${anterior}→${alvo}→${anterior}`, expected: String(alvo), actual: String(alvo) };
    },
  );

  await test(
    { id: 'ADM-18', category: 'Admin', name: 'PATCH /settings rejeita retenção fora do range', requirement: 'ADM-18' },
    async () => {
      const r = await api('PATCH', '/api/admin/settings', {
        token: adminToken,
        body: { backup: { retentionDays: 9999 } },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'Retenção absurda aceita', expected: '400', actual: String(r.status) };
      }
      return { message: 'Range 1..365 aplicado', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'ADM-19', category: 'Admin', name: 'Teste de SMTP com e-mail inválido → 400', requirement: 'ADM-19' },
    async () => {
      const r = await api('POST', '/api/admin/settings/smtp/test', {
        token: adminToken,
        body: { email: 'nao-e-email' },
      });
      if (r.status !== 400) {
        return { status: 'failed', message: 'E-mail inválido aceito', expected: '400', actual: String(r.status) };
      }
      return { message: 'Validação de destinatário', expected: '400', actual: '400' };
    },
  );

  await test(
    { id: 'ADM-20', category: 'Admin', name: 'Teste de SMTP sem servidor cai no fallback', requirement: 'ADM-20' },
    async () => {
      const r = await api<{ message?: string; error?: string }>('POST', '/api/admin/settings/smtp/test', {
        token: adminToken,
        body: { email: 'qa-smtp@qa.test' },
      });
      // Sem SMTP em DEV o envio vai para o console (200) ou falha explicitamente (400).
      if (r.status !== 200 && r.status !== 400) {
        return { status: 'failed', message: 'Teste de SMTP', expected: '200/400', actual: `${r.status} ${r.raw.slice(0, 120)}` };
      }
      return {
        message: r.status === 200 ? 'Fallback de console aceitou' : `Erro tratado: ${r.data?.error ?? ''}`,
        expected: '200/400 sem 500',
        actual: String(r.status),
      };
    },
  );

  await test(
    { id: 'ADM-21', category: 'Admin', name: 'Listagem de backups responde sem executar dump', requirement: 'ADM-21' },
    async () => {
      const r = await api<{ files?: unknown[] }>('GET', '/api/admin/settings/backups', { token: adminToken });
      if (r.status !== 200 || !Array.isArray(r.data?.files)) {
        return { status: 'failed', message: 'Listar backups', expected: '200 files[]', actual: String(r.status) };
      }
      return { message: `${r.data.files.length} backup(s) listado(s)`, expected: 'array', actual: 'array' };
    },
  );

  await test(
    { id: 'ADM-22', category: 'Admin', name: 'Download com filename fora do padrão → 404', requirement: 'ADM-22' },
    async () => {
      const r = await api('GET', '/api/admin/settings/backups/..%2F..%2Fetc%2Fpasswd', { token: adminToken });
      if (r.status !== 404 && r.status !== 400) {
        return { status: 'failed', message: 'Path traversal no download', expected: '404/400', actual: String(r.status) };
      }
      return { message: `Traversal bloqueado (${r.status})`, expected: '404/400', actual: String(r.status) };
    },
  );

  await test(
    { id: 'ADM-23', category: 'Admin', name: 'Rotas de backup exigem ADMIN', requirement: 'ADM-23' },
    async () => {
      if (!donoToken) return { status: 'skipped', message: 'Token de dono indisponível' };
      const lista = await api('GET', '/api/admin/settings/backups', { token: donoToken });
      const run = await api('POST', '/api/admin/settings/backups/run', { token: donoToken });
      if (lista.status !== 403 || run.status !== 403) {
        return {
          status: 'failed',
          message: 'Backup acessível a não-admin',
          expected: '403/403',
          actual: `${lista.status}/${run.status}`,
        };
      }
      return { message: 'Backup restrito ao ADMIN', expected: '403', actual: '403' };
    },
  );

  await test(
    { id: 'ADM-24', category: 'Admin', name: 'Limpeza das empresas criadas no teste', requirement: 'ADM-24' },
    async () => {
      const ids = Array.from(new Set(criadas));
      for (const id of ids) {
        await prisma.usuario.deleteMany({ where: { cervejariaId: id } });
        await prisma.cervejaria.delete({ where: { id } }).catch(() => undefined);
      }
      const restantes = await prisma.cervejaria.count({ where: { id: { in: ids } } });
      if (restantes > 0) {
        return { status: 'failed', message: 'Cervejarias de teste não removidas', expected: '0', actual: String(restantes) };
      }
      return { message: `${ids.length} empresa(s) de teste removida(s)`, expected: '0 restantes', actual: '0' };
    },
  );
}
