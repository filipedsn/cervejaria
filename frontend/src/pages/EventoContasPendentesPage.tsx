import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { Loading } from '../components/Loading';
import { EmptyState } from '../components/EmptyState';
import { PaymentFormModal, createDefaultPaymentForm, toPaymentForma, type PaymentFormRow } from '../components/PaymentFormModal';
import { parseCurrencyInput } from '../lib/currency';

type ContaEvento = {
  id: string;
  valorOriginal: number;
  recebido: number;
  saldo: number;
  createdAt: string;
  cliente: { id: string; nome: string; telefone: string | null };
  comanda: { id: string; numero: number | null; fechadaEm: string | null; itens: Array<{ nome: string | null; quantidade: number }> };
  pagamentos: Array<{ id: string; forma: string; valor: number; pagoEm: string }>;
};

export function EventoContasPendentesPage() {
  const { eventoId = '' } = useParams<{ eventoId: string }>();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ContaEvento | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentFormRow[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const contasQuery = useQuery({
    queryKey: ['evento-contas-pendentes', eventoId],
    queryFn: () => api.get<ContaEvento[]>(`/api/eventos/${eventoId}/contas-pendentes`),
    enabled: Boolean(eventoId),
  });
  const receber = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('Selecione uma conta pendente');
      return api.post<{ conta: ContaEvento; classificacao: string }>(`/api/eventos/${eventoId}/contas-pendentes/${selected.id}/pagamentos`, {
        pagamentos: paymentForm.map((row) => ({ forma: toPaymentForma(row), valor: parseCurrencyInput(row.valor) })),
      });
    },
    onSuccess: async ({ conta, classificacao }) => {
      const total = paymentForm.reduce((sum, row) => sum + parseCurrencyInput(row.valor), 0);
      setSuccess(`${formatCurrency(total)} recebido de ${conta.cliente.nome}. ${conta.saldo > 0 ? `Saldo restante: ${formatCurrency(conta.saldo)}.` : 'Conta quitada.'}${classificacao === 'FORA_DO_CAIXA' ? ' Recebimento registrado fora de um caixa aberto.' : ''}`);
      setSelected(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['evento-contas-pendentes', eventoId] }),
        queryClient.invalidateQueries({ queryKey: ['evento-caixa', eventoId] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', eventoId] }),
        queryClient.invalidateQueries({ queryKey: ['resumo-executivo', eventoId] }),
        queryClient.invalidateQueries({ queryKey: ['cervejaria-dashboard'] }),
      ]);
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Não foi possível registrar o recebimento.'),
  });

  if (contasQuery.isLoading) return <Loading />;
  const contas = contasQuery.data ?? [];
  const totalPendente = contas.reduce((sum, conta) => sum + conta.saldo, 0);

  return (
    <div className="space-y-4 pb-4">
      <PageHeader title="Contas pendentes" subtitle="Saldos de comandas deste evento que aguardam recebimento." backTo="/comandas" backLabel="Comandas" />
      {error && <div className="alert-error" role="alert">{error}</div>}
      {success && <div className="alert-success" role="status">{success}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div className="metric-card"><p className="metric-value">{contas.length}</p><p className="text-sm text-ink-muted">Contas abertas</p></div>
        <div className="metric-card"><p className="metric-value text-orange-dark">{formatCurrency(totalPendente)}</p><p className="text-sm text-ink-muted">Saldo pendente</p></div>
      </div>
      {contasQuery.isError && <div className="alert-error">Não foi possível carregar as contas pendentes.</div>}
      {!contasQuery.isError && contas.length === 0 && <EmptyState icon="💳" title="Nenhuma conta pendente" description="As contas em aberto deste evento aparecerão aqui." />}
      <div className="space-y-3">
        {contas.map((conta) => (
          <article key={conta.id} className="card space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><h2 className="truncate text-lg font-bold">{conta.cliente.nome}</h2><p className="text-sm text-ink-muted">Comanda {conta.comanda.numero ?? '—'} · {new Date(conta.comanda.fechadaEm ?? conta.createdAt).toLocaleDateString('pt-BR')}</p></div>
              <strong className="shrink-0 text-lg tabular-nums text-brand-600">{formatCurrency(conta.saldo)}</strong>
            </div>
            <ul className="space-y-1 text-sm text-ink-muted">{conta.comanda.itens.map((item, index) => <li key={`${conta.id}-${index}`}>{item.quantidade}× {item.nome || 'Item'}</li>)}</ul>
            <div className="flex items-center justify-between gap-3 border-t border-line pt-3 text-sm"><span>Original {formatCurrency(conta.valorOriginal)} · recebido {formatCurrency(conta.recebido)}</span><button type="button" className="touch-btn-primary touch-btn-sm" onClick={() => { setSelected(conta); setPaymentForm(createDefaultPaymentForm(conta.saldo)); setError(''); setSuccess(''); }}>Registrar recebimento</button></div>
          </article>
        ))}
      </div>
      <PaymentFormModal
        open={Boolean(selected)} onClose={() => setSelected(null)} title="Receber conta pendente"
        totalLabel={`Saldo de ${selected?.cliente.nome ?? 'cliente'}`} total={selected?.saldo ?? 0}
        paymentForm={paymentForm} setPaymentForm={setPaymentForm} allowPartial
        onConfirm={() => receber.mutate()} isPending={receber.isPending}
        confirmMessage="O recebimento será associado ao caixa aberto deste evento. Se o evento estiver encerrado, será registrado fora de um caixa aberto."
      />
    </div>
  );
}
