import type { Socket } from 'socket.io-client';
import { prisma } from '../../src/lib/prisma.js';
import {
  API_BASE,
  api,
  chopeItemBody,
  portalSessao,
  uniquePortalTestPhone,
  uniqueStaffComandaBody,
} from './http.js';
import { ensureTenantEventoAberto } from './tenant-evento.js';
import type { QaContext, TenantFixture } from './types.js';

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

const CONNECT_TIMEOUT_MS = 8000;
const EVENT_TIMEOUT_MS = 4000;

async function connectStaff(token: string): Promise<Socket> {
  const { io: ioClient } = await import('socket.io-client');
  const socket = ioClient(API_BASE, {
    transports: ['websocket'],
    timeout: 5000,
    reconnection: false,
    auth: { token },
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout no handshake')), CONNECT_TIMEOUT_MS);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  return socket;
}

async function connectCliente(cookie: string): Promise<Socket> {
  const { io: ioClient } = await import('socket.io-client');
  const socket = ioClient(API_BASE, {
    transports: ['websocket'],
    timeout: 5000,
    reconnection: false,
    extraHeaders: { Cookie: cookie },
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout no handshake do cliente')), CONNECT_TIMEOUT_MS);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  return socket;
}

/** Coleta eventos a partir de agora; resolve no primeiro que casar com o predicado. */
function collect<T = unknown>(socket: Socket, event: string) {
  const received: T[] = [];
  let resolveFn: ((value: T | null) => void) | null = null;
  let matcher: ((payload: T) => boolean) | null = null;

  const handler = (payload: T) => {
    received.push(payload);
    if (resolveFn && matcher && matcher(payload)) {
      const done = resolveFn;
      resolveFn = null;
      done(payload);
    }
  };
  socket.on(event, handler);

  return {
    received,
    /** Aguarda um evento que satisfaça o predicado (inclui os já recebidos). */
    wait(predicate: (payload: T) => boolean, timeoutMs = EVENT_TIMEOUT_MS): Promise<T | null> {
      const already = received.find(predicate);
      if (already) return Promise.resolve(already);
      return new Promise<T | null>((resolve) => {
        matcher = predicate;
        resolveFn = resolve;
        setTimeout(() => {
          if (resolveFn) {
            resolveFn = null;
            resolve(null);
          }
        }, timeoutMs);
      });
    },
    dispose() {
      socket.off(event, handler);
    },
  };
}

/** Aguarda o servidor processar o join (não há ack no protocolo). */
function settle(ms = 350) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ComandaEventPayload {
  id?: string;
  comandaId?: string;
  itens?: Array<{ id: string }>;
}

/**
 * Rooms, entrega de eventos e isolamento multi-tenant do Socket.IO.
 * Usa tenants dedicados para não interferir nas suítes funcionais.
 */
export async function runRealtimeTests(ctx: QaContext, test: TestFn, perfSink?: (label: string, ms: number) => void) {
  const tenantA: TenantFixture | undefined = ctx.tenants[5] ?? ctx.tenants[0];
  const tenantB: TenantFixture | undefined = ctx.tenants[6] ?? ctx.tenants[1];

  if (!tenantA || !tenantB || tenantA.cervejariaId === tenantB.cervejariaId) {
    await test(
      { id: 'RT-03', category: 'Realtime', name: 'Seed realtime', requirement: 'RT' },
      async () => ({ status: 'failed', message: 'Tenants insuficientes para testes de realtime' }),
    );
    return;
  }

  await ensureTenantEventoAberto(tenantA);
  await ensureTenantEventoAberto(tenantB);

  let socketA: Socket | null = null;
  let socketB: Socket | null = null;
  let clienteA: Socket | null = null;
  let clienteB: Socket | null = null;
  let comandaA = '';
  let comandaClienteA = '';
  let comandaClienteB = '';

  try {
    try {
      socketA = await connectStaff(tenantA.donoToken);
      socketB = await connectStaff(tenantB.donoToken);
    } catch (err) {
      await test(
        { id: 'RT-03', category: 'Realtime', name: 'Conexão de sockets para rooms', requirement: 'RT-03' },
        async () => ({
          status: 'failed',
          message: `Handshake falhou: ${err instanceof Error ? err.message : String(err)}`,
        }),
      );
      return;
    }

    socketA.emit('join:evento', tenantA.eventoId);
    socketA.emit('join:cervejaria', tenantA.cervejariaId);
    socketB.emit('join:evento', tenantB.eventoId);
    socketB.emit('join:cervejaria', tenantB.cervejariaId);
    // Tentativas cross-tenant devem ser silenciosamente ignoradas pelo servidor.
    socketA.emit('join:evento', tenantB.eventoId);
    socketA.emit('join:cervejaria', tenantB.cervejariaId);
    await settle();

    await test(
      { id: 'RT-03', category: 'Realtime', name: 'Room evento entrega comanda:created', requirement: 'RT-03' },
      async () => {
        const criadas = collect<ComandaEventPayload>(socketA!, 'comanda:created');
        const t0 = performance.now();
        const r = await api<{ id: string }>('POST', '/api/comandas', {
          token: tenantA.atendenteTokens[0],
          body: uniqueStaffComandaBody(tenantA.eventoId, `RT Socket ${Date.now()}`, 61),
        });
        if (r.status !== 201 || !r.data?.id) {
          criadas.dispose();
          return { status: 'failed', message: 'Setup comanda', expected: '201', actual: String(r.status) };
        }
        comandaA = r.data.id;

        const hit = await criadas.wait((p) => p?.id === comandaA);
        const latencia = performance.now() - t0;
        criadas.dispose();
        if (!hit) {
          return {
            status: 'failed',
            message: 'comanda:created não chegou na room do evento',
            expected: comandaA,
            actual: 'timeout',
          };
        }
        perfSink?.('Socket.IO comanda:created (e2e)', latencia);
        return { message: `Entregue em ${latencia.toFixed(0)}ms`, expected: comandaA, actual: hit.id ?? '' };
      },
    );

    await test(
      { id: 'RT-04', category: 'Realtime', name: 'Room evento entrega item:added', requirement: 'RT-04' },
      async () => {
        if (!comandaA) return { status: 'failed', message: 'RT-03 não rodou' };
        const itens = collect<ComandaEventPayload>(socketA!, 'item:added');
        const r = await api('POST', `/api/comandas/${comandaA}/itens`, {
          token: tenantA.atendenteTokens[0],
          body: chopeItemBody(tenantA.produtoId, tenantA.tapId, tenantA.volumeMl),
        });
        if (r.status !== 201) {
          itens.dispose();
          return { status: 'failed', message: 'Setup item', expected: '201', actual: String(r.status) };
        }
        const hit = await itens.wait((p) => p?.id === comandaA);
        itens.dispose();
        if (!hit) return { status: 'failed', message: 'item:added não chegou', expected: comandaA, actual: 'timeout' };
        return { message: 'item:added entregue', expected: comandaA, actual: hit.id ?? '' };
      },
    );

    await test(
      { id: 'RT-05', category: 'Realtime', name: 'Item de chope dispara ranking:updated', requirement: 'RT-05' },
      async () => {
        if (!comandaA) return { status: 'failed', message: 'RT-03 não rodou' };
        const ranking = collect<{ eventoId?: string }>(socketA!, 'ranking:updated');
        const r = await api('POST', `/api/comandas/${comandaA}/itens`, {
          token: tenantA.atendenteTokens[0],
          body: chopeItemBody(tenantA.produtoId, tenantA.tapId, tenantA.volumeMl),
        });
        if (r.status !== 201) {
          ranking.dispose();
          return { status: 'failed', message: 'Setup item chope', expected: '201', actual: String(r.status) };
        }
        const hit = await ranking.wait((p) => p?.eventoId === tenantA.eventoId);
        ranking.dispose();
        if (!hit) {
          return { status: 'failed', message: 'ranking:updated não chegou', expected: tenantA.eventoId, actual: 'timeout' };
        }
        return { message: 'ranking:updated entregue', expected: tenantA.eventoId, actual: hit.eventoId ?? '' };
      },
    );

    await test(
      { id: 'RT-06', category: 'Realtime', name: 'Fechamento entrega comanda:closed', requirement: 'RT-06' },
      async () => {
        if (!comandaA) return { status: 'failed', message: 'RT-03 não rodou' };
        const atual = await api<{ total: string | number }>('GET', `/api/comandas/${comandaA}`, {
          token: tenantA.donoToken,
        });
        const total = Number(atual.data?.total ?? 0);
        const fechadas = collect<ComandaEventPayload>(socketA!, 'comanda:closed');
        const r = await api('POST', `/api/pagamentos/comandas/${comandaA}/fechar`, {
          token: tenantA.atendenteTokens[0],
          body: { pagamentos: [{ forma: 'PIX', valor: total }] },
        });
        if (r.status !== 200) {
          fechadas.dispose();
          return { status: 'failed', message: 'Fechar comanda', expected: '200', actual: String(r.status) };
        }
        const hit = await fechadas.wait((p) => p?.id === comandaA);
        fechadas.dispose();
        if (!hit) return { status: 'failed', message: 'comanda:closed não chegou', expected: comandaA, actual: 'timeout' };
        return { message: 'comanda:closed entregue', expected: comandaA, actual: hit.id ?? '' };
      },
    );

    await test(
      { id: 'RT-07', category: 'Realtime', name: 'Socket de outro tenant não recebe comanda:created', requirement: 'RT-07' },
      async () => {
        const espiao = collect<ComandaEventPayload>(socketB!, 'comanda:created');
        const legitimo = collect<ComandaEventPayload>(socketA!, 'comanda:created');
        const r = await api<{ id: string }>('POST', '/api/comandas', {
          token: tenantA.atendenteTokens[0],
          body: uniqueStaffComandaBody(tenantA.eventoId, `RT Isolamento ${Date.now()}`, 62),
        });
        if (r.status !== 201 || !r.data?.id) {
          espiao.dispose();
          legitimo.dispose();
          return { status: 'failed', message: 'Setup comanda', expected: '201', actual: String(r.status) };
        }
        const novoId = r.data.id;
        const chegouNoDono = await legitimo.wait((p) => p?.id === novoId);
        const vazou = espiao.received.some((p) => p?.id === novoId);
        espiao.dispose();
        legitimo.dispose();
        if (!chegouNoDono) {
          return { status: 'failed', message: 'Evento não chegou nem no tenant dono', expected: novoId, actual: 'timeout' };
        }
        if (vazou) {
          return { status: 'failed', message: 'Tenant B recebeu comanda de A', expected: 'sem vazamento', actual: 'vazou' };
        }
        return { message: 'Isolamento por room confirmado', expected: 'sem vazamento', actual: 'isolado' };
      },
    );

    await test(
      { id: 'RT-08', category: 'Realtime', name: 'join:evento cross-tenant é ignorado', requirement: 'RT-08' },
      async () => {
        // socketA pediu join no evento de B logo após conectar; não deve estar na room.
        const espiao = collect<ComandaEventPayload>(socketA!, 'comanda:created');
        const legitimo = collect<ComandaEventPayload>(socketB!, 'comanda:created');
        const r = await api<{ id: string }>('POST', '/api/comandas', {
          token: tenantB.atendenteTokens[0],
          body: uniqueStaffComandaBody(tenantB.eventoId, `RT CrossJoin ${Date.now()}`, 63),
        });
        if (r.status !== 201 || !r.data?.id) {
          espiao.dispose();
          legitimo.dispose();
          return { status: 'failed', message: 'Setup comanda B', expected: '201', actual: String(r.status) };
        }
        const novoId = r.data.id;
        const chegouEmB = await legitimo.wait((p) => p?.id === novoId);
        const vazou = espiao.received.some((p) => p?.id === novoId);
        espiao.dispose();
        legitimo.dispose();
        if (!chegouEmB) {
          return { status: 'failed', message: 'Evento não chegou no tenant B', expected: novoId, actual: 'timeout' };
        }
        if (vazou) {
          return { status: 'failed', message: 'join:evento cross-tenant foi aceito', expected: 'ignorado', actual: 'aceito' };
        }
        return { message: 'join:evento cross-tenant ignorado', expected: 'ignorado', actual: 'ignorado' };
      },
    );

    await test(
      { id: 'RT-09', category: 'Realtime', name: 'Room cervejaria entrega tap-montagem:updated', requirement: 'RT-09' },
      async () => {
        const legitimo = collect<{ eventoId?: string }>(socketB!, 'tap-montagem:updated');
        const espiao = collect<{ eventoId?: string }>(socketA!, 'tap-montagem:updated');
        const r = await api('PUT', `/api/eventos/${tenantB.eventoId}/taps/${tenantB.tapId}/chope`, {
          token: tenantB.donoToken,
          body: { produtoId: tenantB.produtoId },
        });
        if (r.status !== 200) {
          legitimo.dispose();
          espiao.dispose();
          return { status: 'failed', message: 'Posicionar chope', expected: '200', actual: String(r.status) };
        }
        const hit = await legitimo.wait((p) => p?.eventoId === tenantB.eventoId);
        const vazou = espiao.received.some((p) => p?.eventoId === tenantB.eventoId);
        legitimo.dispose();
        espiao.dispose();
        if (!hit) {
          return { status: 'failed', message: 'tap-montagem:updated não chegou', expected: tenantB.eventoId, actual: 'timeout' };
        }
        if (vazou) {
          return { status: 'failed', message: 'join:cervejaria cross-tenant vazou', expected: 'isolado', actual: 'vazou' };
        }
        return { message: 'Room cervejaria entregue e isolada', expected: tenantB.eventoId, actual: hit.eventoId ?? '' };
      },
    );

    await test(
      { id: 'RT-10', category: 'Realtime', name: 'Socket sem join não recebe eventos do evento', requirement: 'RT-10' },
      async () => {
        let mudo: Socket | null = null;
        try {
          mudo = await connectStaff(tenantA.donoToken);
        } catch (err) {
          return { status: 'failed', message: `Conexão falhou: ${err instanceof Error ? err.message : String(err)}` };
        }
        const espiao = collect<ComandaEventPayload>(mudo, 'comanda:created');
        const legitimo = collect<ComandaEventPayload>(socketA!, 'comanda:created');
        const r = await api<{ id: string }>('POST', '/api/comandas', {
          token: tenantA.atendenteTokens[0],
          body: uniqueStaffComandaBody(tenantA.eventoId, `RT SemJoin ${Date.now()}`, 64),
        });
        const novoId = r.data?.id ?? '';
        await legitimo.wait((p) => p?.id === novoId);
        const recebeu = espiao.received.some((p) => p?.id === novoId);
        espiao.dispose();
        legitimo.dispose();
        mudo.disconnect();
        if (r.status !== 201 || !novoId) {
          return { status: 'failed', message: 'Setup comanda', expected: '201', actual: String(r.status) };
        }
        if (recebeu) {
          return { status: 'failed', message: 'Socket sem join recebeu evento', expected: 'nada', actual: 'recebeu' };
        }
        return { message: 'Sem join, sem evento', expected: 'nada', actual: 'nada' };
      },
    );

    await test(
      { id: 'RT-11', category: 'Realtime', name: 'Quiosque emite pedido-novo na room cervejaria', requirement: 'RT-11' },
      async () => {
        const cfg = ctx.configTenants?.find((c) => c.code === 'QUIOSQUE-11');
        if (!cfg?.pontoVendaId || !cfg.produtoPreparoId) {
          return { status: 'failed', message: 'QUIOSQUE-11 ausente no contexto' };
        }

        let socketQ: Socket | null = null;
        try {
          socketQ = await connectStaff(cfg.donoToken);
        } catch (err) {
          return { status: 'failed', message: `Conexão falhou: ${err instanceof Error ? err.message : String(err)}` };
        }
        socketQ.emit('join:cervejaria', cfg.cervejariaId);
        await settle();

        const novos = collect<{ id?: string }>(socketQ, 'quiosque:pedido-novo');

        const atual = await api<{ sessao?: { status: string } }>(
          'GET',
          `/api/quiosque/caixa?pontoVendaId=${cfg.pontoVendaId}`,
          { token: cfg.donoToken },
        );
        if (atual.data?.sessao?.status !== 'ABERTO') {
          await api('POST', '/api/quiosque/caixa/abrir', {
            token: cfg.donoToken,
            body: { pontoVendaId: cfg.pontoVendaId, trocoInicial: 50 },
          });
        }

        const comanda = await api<{ id: string; pedidos?: Array<{ id: string }> }>('POST', '/api/quiosque/comandas', {
          token: cfg.donoToken,
          body: {
            pontoVendaId: cfg.pontoVendaId,
            tipo: 'APELIDO',
            identificador: `RT-Q-${Date.now()}`,
            itens: [{ produtoId: cfg.produtoPreparoId, quantidade: 1 }],
          },
        });
        if (comanda.status !== 201) {
          novos.dispose();
          socketQ.disconnect();
          return { status: 'failed', message: 'Comanda quiosque', expected: '201', actual: String(comanda.status) };
        }
        const pedidoId = comanda.data?.pedidos?.[0]?.id;
        const hit = await novos.wait((p) => !pedidoId || p?.id === pedidoId);
        novos.dispose();
        socketQ.disconnect();
        if (!hit) {
          return { status: 'failed', message: 'quiosque:pedido-novo não chegou', expected: pedidoId ?? 'pedido', actual: 'timeout' };
        }
        return { message: 'Cozinha notificada via socket', expected: 'pedido-novo', actual: 'recebido' };
      },
    );

    await test(
      { id: 'RT-12', category: 'Realtime', name: 'Token expirado rejeitado no handshake', requirement: 'RT-12' },
      async () => {
        const { signToken, decodeToken } = await import('./jwt.js');
        const payload = decodeToken(tenantA.donoToken)?.payload ?? {};
        delete payload.exp;
        delete payload.iat;
        const expirado = signToken(payload, { expiresInSec: -60 });
        try {
          const socket = await connectStaff(expirado);
          socket.disconnect();
          return { status: 'failed', message: 'Socket aceitou token expirado', expected: 'rejeitado', actual: 'conectou' };
        } catch {
          return { message: 'Handshake rejeitou token expirado', expected: 'rejeitado', actual: 'rejeitado' };
        }
      },
    );

    await test(
      { id: 'RT-13', category: 'Realtime', name: 'Cliente A não recebe item:added da comanda B', requirement: 'TQ-001-A' },
      async () => {
        const [sessaoA, sessaoB] = await Promise.all([
          portalSessao(tenantA.slug, tenantA.trailerId, {
            nome: 'TQ001 Cliente A',
            telefone: uniquePortalTestPhone(71, 1),
          }),
          portalSessao(tenantA.slug, tenantA.trailerId, {
            nome: 'TQ001 Cliente B',
            telefone: uniquePortalTestPhone(71, 2),
          }),
        ]);
        if (
          sessaoA.status !== 201 ||
          sessaoB.status !== 201 ||
          !sessaoA.cookie ||
          !sessaoB.cookie ||
          !sessaoA.comandaId ||
          !sessaoB.comandaId
        ) {
          return {
            status: 'failed',
            message: 'Setup das sessões do portal falhou',
            expected: 'duas sessões 201',
            actual: `${sessaoA.status}/${sessaoB.status}`,
          };
        }

        comandaClienteA = sessaoA.comandaId;
        comandaClienteB = sessaoB.comandaId;
        clienteA = await connectCliente(sessaoA.cookie);
        clienteB = await connectCliente(sessaoB.cookie);
        await settle();

        const eventosA = collect<ComandaEventPayload>(clienteA, 'item:added');
        const eventosB = collect<ComandaEventPayload>(clienteB, 'item:added');
        const eventosStaff = collect<ComandaEventPayload>(socketA!, 'item:added');
        const r = await api('POST', `/api/comandas/${comandaClienteB}/itens`, {
          token: tenantA.atendenteTokens[0],
          body: chopeItemBody(tenantA.produtoId, tenantA.tapId, tenantA.volumeMl),
        });
        const recebidoB = await eventosB.wait((p) => p?.comandaId === comandaClienteB);
        const recebidoStaff = await eventosStaff.wait((p) => p?.id === comandaClienteB);
        await settle();
        const vazouParaA = eventosA.received.some(
          (p) => p?.id === comandaClienteB || p?.comandaId === comandaClienteB,
        );
        eventosA.dispose();
        eventosB.dispose();
        eventosStaff.dispose();

        if (r.status !== 201) {
          return { status: 'failed', message: 'Inclusão de item', expected: '201', actual: String(r.status) };
        }
        if (!recebidoB || !recebidoStaff) {
          return {
            status: 'failed',
            message: 'Evento não chegou aos destinatários legítimos',
            expected: 'cliente B e staff',
            actual: `clienteB=${!!recebidoB}, staff=${!!recebidoStaff}`,
          };
        }
        if (vazouParaA) {
          return {
            status: 'failed',
            message: 'Cliente A recebeu evento privado da comanda B',
            expected: 'isolado',
            actual: 'vazou',
          };
        }
        return { message: 'Comandas de clientes isoladas', expected: 'isolado', actual: 'isolado' };
      },
    );

    await test(
      { id: 'RT-14', category: 'Realtime', name: 'Cliente recebe sinal mínimo da própria comanda', requirement: 'TQ-001-B' },
      async () => {
        if (!clienteB || !comandaClienteB) return { status: 'failed', message: 'RT-13 não preparou cliente B' };
        const eventos = collect<ComandaEventPayload>(clienteB, 'item:added');
        const r = await api('POST', `/api/comandas/${comandaClienteB}/itens`, {
          token: tenantA.atendenteTokens[0],
          body: chopeItemBody(tenantA.produtoId, tenantA.tapId, tenantA.volumeMl),
        });
        const hit = await eventos.wait((p) => p?.comandaId === comandaClienteB);
        eventos.dispose();
        if (r.status !== 201 || !hit) {
          return {
            status: 'failed',
            message: 'Cliente B não recebeu atualização da própria comanda',
            expected: comandaClienteB,
            actual: hit?.comandaId ?? `HTTP ${r.status}`,
          };
        }
        const keys = Object.keys(hit).sort();
        if (keys.length !== 1 || keys[0] !== 'comandaId') {
          return {
            status: 'failed',
            message: 'Payload do cliente contém dados além do identificador',
            expected: 'comandaId',
            actual: keys.join(','),
          };
        }
        return { message: 'Sinal privado mínimo entregue', expected: 'comandaId', actual: keys.join(',') };
      },
    );

    await test(
      { id: 'RT-15', category: 'Realtime', name: 'Funcionário mantém atualização completa do evento', requirement: 'TQ-001-C' },
      async () => {
        if (!comandaClienteB) return { status: 'failed', message: 'RT-13 não preparou comanda B' };
        const eventos = collect<ComandaEventPayload>(socketA!, 'item:added');
        const r = await api('POST', `/api/comandas/${comandaClienteB}/itens`, {
          token: tenantA.atendenteTokens[0],
          body: chopeItemBody(tenantA.produtoId, tenantA.tapId, tenantA.volumeMl),
        });
        const hit = await eventos.wait((p) => p?.id === comandaClienteB && Array.isArray(p.itens));
        eventos.dispose();
        if (r.status !== 201 || !hit) {
          return {
            status: 'failed',
            message: 'Room operacional perdeu a atualização completa',
            expected: comandaClienteB,
            actual: hit?.id ?? `HTTP ${r.status}`,
          };
        }
        return { message: 'Evento operacional preservado', expected: comandaClienteB, actual: hit.id ?? '' };
      },
    );

    await test(
      { id: 'RT-16', category: 'Realtime', name: 'Aviso público de sessão expirada usa room do portal', requirement: 'TQ-001' },
      async () => {
        if (!clienteA || !clienteB) return { status: 'failed', message: 'RT-13 não preparou clientes do portal' };
        const expiradoA = collect<{ eventoId?: string; reason?: string }>(clienteA, 'portal:session-expired');
        const expiradoB = collect<{ eventoId?: string; reason?: string }>(clienteB, 'portal:session-expired');
        const expiradoStaff = collect<{ eventoId?: string }>(socketA!, 'portal:session-expired');

        await prisma.comanda.updateMany({
          where: { eventoId: tenantA.eventoId, status: 'ABERTA' },
          data: { status: 'CANCELADA' },
        });
        const r = await api('PATCH', `/api/eventos/${tenantA.eventoId}/fechar`, { token: tenantA.donoToken });
        const [hitA, hitB] = await Promise.all([
          expiradoA.wait((p) => p?.eventoId === tenantA.eventoId && p.reason === 'evento_fechado'),
          expiradoB.wait((p) => p?.eventoId === tenantA.eventoId && p.reason === 'evento_fechado'),
        ]);
        await settle();
        const vazouParaStaff = expiradoStaff.received.some((p) => p?.eventoId === tenantA.eventoId);
        expiradoA.dispose();
        expiradoB.dispose();
        expiradoStaff.dispose();

        if (r.status !== 200 || !hitA || !hitB) {
          return {
            status: 'failed',
            message: 'Aviso de expiração não chegou aos clientes do portal',
            expected: 'cliente A e cliente B',
            actual: `HTTP=${r.status}, A=${!!hitA}, B=${!!hitB}`,
          };
        }
        if (vazouParaStaff) {
          return {
            status: 'failed',
            message: 'Aviso exclusivo do portal chegou à room operacional',
            expected: 'somente portal',
            actual: 'staff recebeu',
          };
        }
        return { message: 'Expiração pública preservada e separada', expected: 'portal', actual: 'portal' };
      },
    );
  } finally {
    socketA?.disconnect();
    socketB?.disconnect();
    clienteA?.disconnect();
    clienteB?.disconnect();
  }
}
