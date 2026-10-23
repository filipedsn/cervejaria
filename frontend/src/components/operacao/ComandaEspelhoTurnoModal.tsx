import { useQuery } from '@tanstack/react-query';
import { api, formatCurrency } from '../../lib/api';
import { FORMAS_PAGAMENTO, rotuloComanda, type ComandaOperacao } from '../../lib/operacao';
import { Modal } from '../Modal';

interface ItemEspelho {
  id: string;
  nome: string | null;
  quantidade: number;
  volumeMl: number;
  tapId?: string | null;
  precoUnit: number;
  subtotal: number;
  canceladoEm?: string | null;
  cancelamentoPendenteEm?: string | null;
  opcionais?: Array<{ nome: string; precoAdicional: number; quantidade: number }>;
  cancelamentosEntregue?: Array<{ quantidade: number; valorRetirado: number; createdAt: string }>;
}

interface ComandaEspelhoTurno extends ComandaOperacao {
  pontoVenda?: { id: string; nome: string } | null;
  turno?: { id: string; abertoEm: string; fechadoEm: string } | null;
  agendamento?: { nome: string; data: string; horaInicio: string; horaFim: string | null; agendaNome: string | null } | null;
  pagamentos: Array<ComandaOperacao['pagamentos'][number] & {
    sessaoCaixaId: string | null;
    classificacaoTurno: 'NESTE_TURNO' | 'DEPOIS_DO_TURNO' | 'CONTEXTO_NAO_REGISTRADO';
  }>;
  itensSemPedido: ItemEspelho[];
}

function dataHora(value: string | null | undefined): string {
  if (!value) return 'Não registrado';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Não registrado' : parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function dataLocal(value: string | null | undefined): string {
  if (!value) return 'Não registrado';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Não registrado' : parsed.toLocaleDateString('pt-BR');
}

function formaPagamento(forma: string): string {
  return FORMAS_PAGAMENTO.find((item) => item.valor === forma)?.label ?? forma;
}

function statusComanda(status: string): string {
  if (status === 'FECHADA') return 'Fechada';
  if (status === 'CANCELADA') return 'Cancelada';
  if (status === 'ABERTA') return 'Aberta';
  return status;
}

function LinhaItem({ item, cancelado = false }: { item: ItemEspelho; cancelado?: boolean }) {
  const adicionais = item.opcionais ?? [];
  const valorAdicionais = adicionais.reduce((sum, adicional) => sum + adicional.precoAdicional * adicional.quantidade, 0);
  const precoBaseSnapshot = item.precoUnit - valorAdicionais;
  return (
    <div className={`rounded-xl border p-3 ${cancelado ? 'border-red-500/30 bg-red-500/5' : 'border-line bg-surface'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold break-words">{item.nome || 'Nome não registrado'}{cancelado && <span className="ml-2 text-xs font-bold uppercase text-red-600">Cancelado</span>}</p>
          <p className="mt-1 text-xs text-ink-faint">
            {item.quantidade} un.
            {item.volumeMl > 0 ? ` · ${item.volumeMl} ml` : ''}
            {item.tapId ? ` · Tap ${item.tapId}` : ''}
            {` · Unitário ${formatCurrency(precoBaseSnapshot)}`}
          </p>
          {adicionais.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-ink-muted">
              {adicionais.map((adicional, index) => (
                <li key={`${adicional.nome}:${index}`}>
                  Adicional: {adicional.nome}{adicional.quantidade > 1 ? ` × ${adicional.quantidade}` : ''} · {formatCurrency(adicional.precoAdicional * adicional.quantidade)}
                </li>
              ))}
            </ul>
          )}
          {item.cancelamentoPendenteEm && <p className="mt-2 text-xs text-amber-700">Cancelamento pendente registrado em {dataHora(item.cancelamentoPendenteEm)}</p>}
        </div>
        <p className="shrink-0 text-right font-semibold tabular-nums">{formatCurrency(item.subtotal)}</p>
      </div>
    </div>
  );
}

function Campo({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-ink-faint">{label}</dt><dd className="mt-0.5 break-words text-sm font-medium">{value}</dd></div>;
}

export function ComandaEspelhoTurnoModal({
  comandaId,
  pontoVendaId,
  sessaoCaixaId,
  onClose,
}: {
  comandaId: string;
  pontoVendaId: string;
  sessaoCaixaId: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['operacao-comanda-espelho-turno', sessaoCaixaId, pontoVendaId, comandaId],
    queryFn: () => api.get<ComandaEspelhoTurno>(
      `/api/operacao/comandas/${encodeURIComponent(comandaId)}/espelho-turno?${new URLSearchParams({ pontoVendaId, sessaoCaixaId })}`,
    ),
    retry: false,
  });

  const ativo = (item: ItemEspelho) => !item.canceladoEm;
  const formatarItem = (item: ComandaOperacao['pedidos'][number]['itens'][number]): ItemEspelho => ({
    ...item,
    nome: item.nome || null,
    precoUnit: item.precoUnit,
    subtotal: item.subtotal,
  });
  const totalRecebido = data?.pagamentos.reduce((sum, pagamento) => sum + pagamento.valor, 0) ?? 0;
  const itensCancelados = data?.pedidos.flatMap((pedido) => pedido.itens.map(formatarItem).filter((item) => !ativo(item))) ?? [];
  const canceladosSemPedido = data?.itensSemPedido.filter((item) => !ativo(item)) ?? [];
  const itensAvulsosAtivos = data?.itensSemPedido.filter(ativo) ?? [];
  const cancelamentosParciais = [
    ...(data?.itensSemPedido ?? []).filter(ativo).flatMap((item) => (item.cancelamentosEntregue ?? []).map((cancelamento) => ({ ...cancelamento, nome: item.nome, volumeMl: item.volumeMl }))),
    ...(data?.pedidos.flatMap((pedido) => pedido.itens.map(formatarItem).filter(ativo)) ?? []).flatMap((item) => (item.cancelamentosEntregue ?? []).map((cancelamento) => ({ ...cancelamento, nome: item.nome, volumeMl: item.volumeMl }))),
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title="Espelho da comanda"
      hideHeaderClose
      closeOnBackdrop={false}
      wide
      footer={<button type="button" className="touch-btn-secondary min-h-12 w-full" onClick={onClose}>Fechar</button>}
    >
      {isLoading ? (
        <p className="py-8 text-center text-sm text-ink-faint" role="status">Carregando comanda…</p>
      ) : isError || !data ? (
        <div className="py-8 text-center" role="alert">
          <p className="font-semibold">Não foi possível consultar esta comanda.</p>
          <p className="mt-1 text-sm text-ink-faint">O registro pode estar indisponível ou não pertencer a este turno.</p>
        </div>
      ) : (
        <div className="space-y-5 pb-1">
          <section className="rounded-xl border border-line bg-surface-lighter p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-lg font-bold">{rotuloComanda(data) || 'Comanda sem identificação'}</h3>
                <p className="mt-1 text-sm text-ink-muted">
                  {data.numero != null ? `Nº ${data.numero}` : 'Número não registrado'} · {statusComanda(data.status)}
                </p>
              </div>
              <span className="rounded-full border border-line px-3 py-1 text-xs font-semibold">{statusComanda(data.status)}</span>
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo label="Cliente" value={data.cliente?.nome ?? 'Não registrado'} />
              <Campo label="PDV" value={data.pontoVenda?.nome ?? 'Não registrado'} />
              <Campo label="Aberta em" value={dataHora(data.createdAt)} />
              <Campo label="Fechada em" value={dataHora(data.fechadaEm)} />
              <Campo label="Turno" value={data.turno ? `${dataHora(data.turno.abertoEm)} – ${dataHora(data.turno.fechadoEm)}` : 'Não registrado'} />
              <Campo label="Agendamento" value={data.agendamento ? `${data.agendamento.nome} · ${dataLocal(data.agendamento.data)} · ${data.agendamento.horaInicio}${data.agendamento.horaFim ? `–${data.agendamento.horaFim}` : ''}${data.agendamento.agendaNome ? ` · ${data.agendamento.agendaNome}` : ''}` : 'Não registrado'} />
            </dl>
          </section>

          <section className="space-y-3">
            <h3 className="section-label">Itens registrados</h3>
            {itensAvulsosAtivos.length > 0 && <div className="space-y-2">{itensAvulsosAtivos.map((item) => <LinhaItem key={item.id} item={item} />)}</div>}
            {data.pedidos.map((pedido) => {
              const ativos = pedido.itens.map(formatarItem).filter(ativo);
              return ativos.length > 0 ? (
                <div key={pedido.id} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Pedido {pedido.numero} · {pedido.status}</p>
                  {ativos.map((item) => <LinhaItem key={item.id} item={item} />)}
                </div>
              ) : null;
            })}
            {itensAvulsosAtivos.length === 0 && data.pedidos.every((pedido) => pedido.itens.every((item) => !ativo(formatarItem(item)))) && itensCancelados.length + canceladosSemPedido.length === 0 && <p className="text-sm text-ink-faint">Nenhum item registrado.</p>}
            {(itensCancelados.length > 0 || canceladosSemPedido.length > 0 || cancelamentosParciais.length > 0) && (
              <div className="space-y-2 pt-2">
                <h4 className="text-sm font-semibold text-red-700 dark:text-red-300">Itens cancelados (fora do total líquido)</h4>
                {[...canceladosSemPedido, ...itensCancelados].map((item) => <LinhaItem key={`cancelado:${item.id}`} item={item} cancelado />)}
                {cancelamentosParciais.map((cancelamento, index) => (
                  <div key={`cancelamento-parcial:${cancelamento.createdAt}:${index}`} className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm">
                    <p className="font-semibold">Cancelamento parcial · {cancelamento.nome || 'Nome não registrado'}</p>
                    <p className="mt-1 text-xs text-ink-faint">{cancelamento.quantidade} un.{cancelamento.volumeMl > 0 ? ` · ${cancelamento.volumeMl} ml` : ''} · {formatCurrency(cancelamento.valorRetirado)} · {dataHora(cancelamento.createdAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-line p-4">
            <h3 className="section-label">Resumo financeiro</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">Subtotal</dt><dd className="tabular-nums">{formatCurrency(data.subtotal)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">Descontos</dt><dd className="tabular-nums">{formatCurrency(data.desconto)}</dd></div>
              <div className="flex justify-between gap-3 border-t border-line pt-2 font-bold"><dt>Total líquido</dt><dd className="tabular-nums">{formatCurrency(data.total)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">Recebido</dt><dd className="tabular-nums">{formatCurrency(totalRecebido)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">Saldo pendente</dt><dd className="tabular-nums">{formatCurrency(data.valorEmAberto)}</dd></div>
            </dl>
          </section>

          <section className="space-y-2">
            <h3 className="section-label">Pagamentos</h3>
            {data.pagamentos.length === 0 ? <p className="text-sm text-ink-faint">Sem pagamento registrado</p> : data.pagamentos.map((pagamento) => {
              const classificacao = pagamento.classificacaoTurno === 'NESTE_TURNO'
                ? 'Recebido neste turno'
                : pagamento.classificacaoTurno === 'DEPOIS_DO_TURNO'
                  ? 'Recebido depois do turno'
                  : 'Contexto do caixa não registrado';
              return (
                <div key={pagamento.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-line p-3">
                  <div><p className="font-medium">{formaPagamento(pagamento.forma)}</p><p className="mt-1 text-xs text-ink-faint">{dataHora(pagamento.pagoEm)} · {classificacao}</p></div>
                  <p className="font-semibold tabular-nums">{formatCurrency(pagamento.valor)}</p>
                </div>
              );
            })}
          </section>
        </div>
      )}
    </Modal>
  );
}
