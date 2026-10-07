import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';

type Agenda = { id: string; nome: string; diaSemana: number; horaInicio: string; horaFim: string | null; local: string | null; ativa: boolean };
type Ocorrencia = { id: string; agendaId: string | null; nome: string; data: string; horaInicio: string; horaFim: string | null; local: string | null; status: 'PROGRAMADA' | 'ABERTA' | 'FECHADA' | 'CANCELADA'; agenda: { nome: string; frequencia: 'SEMANAL'; diaSemana: number } | null };
type AgendaPayload = { nome: string; diaSemana: number; horaInicio: string };
type OperacaoAgenda =
  | { tipo: 'salvar-agenda'; id: string | null; payload: AgendaPayload | (AgendaPayload & { ativa: true }) }
  | { tipo: 'criar-avulsa'; payload: { nome: string; data: string } }
  | { tipo: 'gerar'; agendaId: string; inicio: string; fim: string };
const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

function dataLocal(diasDelta = 0) {
  const data = new Date();
  data.setDate(data.getDate() + diasDelta);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}
function dataPt(value: string) { return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' }); }

export function AgendaOperacionalPanel() {
  const queryClient = useQueryClient();
  const [inicio, setInicio] = useState(dataLocal());
  const [fim, setFim] = useState(dataLocal(90));
  const [nomeAgenda, setNomeAgenda] = useState('');
  const [diaSemana, setDiaSemana] = useState(6);
  const [horaAgenda, setHoraAgenda] = useState('18:00');
  const [agendaId, setAgendaId] = useState('');
  const [nomeAvulsa, setNomeAvulsa] = useState('');
  const [dataAvulsa, setDataAvulsa] = useState(dataLocal());
  const [editando, setEditando] = useState('');
  const [erro, setErro] = useState('');
  const agendaQuery = useQuery({
    queryKey: ['operacao-agenda-ocorrencias', 'gestao', inicio, fim],
    queryFn: () => api.get<{ agendas: Agenda[]; ocorrencias: Ocorrencia[] }>(`/api/operacao/agenda/ocorrencias?inicio=${inicio}&fim=${fim}`),
  });
  const agendas = useMemo(() => agendaQuery.data?.agendas ?? [], [agendaQuery.data]);
  const ocorrencias = agendaQuery.data?.ocorrencias ?? [];
  const mutation = useMutation({
    mutationFn: async (operation: OperacaoAgenda) => {
      if (operation.tipo === 'salvar-agenda') {
        return operation.id
          ? api.patch(`/api/operacao/agenda/agendas/${encodeURIComponent(operation.id)}`, operation.payload)
          : api.post('/api/operacao/agenda/agendas', operation.payload);
      }
      if (operation.tipo === 'criar-avulsa') {
        return api.post('/api/operacao/agenda/ocorrencias', operation.payload);
      }
      return api.post(`/api/operacao/agenda/agendas/${encodeURIComponent(operation.agendaId)}/gerar`, {
        inicio: operation.inicio,
        fim: operation.fim,
      });
    },
    onSuccess: (_result, operation) => {
      setErro('');
      void queryClient.invalidateQueries({ queryKey: ['operacao-agenda-ocorrencias'] });
      if (operation.tipo === 'salvar-agenda') {
        setEditando('');
        setNomeAgenda('');
      } else if (operation.tipo === 'criar-avulsa') {
        setNomeAvulsa('');
      }
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : 'Não foi possível salvar a agenda.'),
  });
  const salvarAgenda = (event: React.FormEvent) => {
    event.preventDefault();
    const id = editando || null;
    const payload = { nome: nomeAgenda.trim(), diaSemana, horaInicio: horaAgenda };
    mutation.mutate({
      tipo: 'salvar-agenda',
      id,
      payload: id ? payload : { ...payload, ativa: true },
    });
  };
  const editarAgenda = (agenda: Agenda) => {
    setEditando(agenda.id); setNomeAgenda(agenda.nome); setDiaSemana(agenda.diaSemana); setHoraAgenda(agenda.horaInicio);
  };

  return (
    <section className="card space-y-4" aria-labelledby="agenda-operacional-title">
      <div>
        <h2 id="agenda-operacional-title" className="text-base font-semibold">Agenda operacional</h2>
        <p className="mt-1 text-sm text-ink-faint">Organize datas e recorrências do PDV. A agenda não altera produtos, preços, estoque ou vendas.</p>
      </div>
      {erro && <div className="alert-error" role="alert">{erro}</div>}
      {agendaQuery.isError && (
        <div className="alert-error flex flex-wrap items-center justify-between gap-3" role="alert">
          <span>Não foi possível carregar a agenda. Verifique sua conexão e tente novamente.</span>
          <button type="button" className="touch-btn-secondary" disabled={agendaQuery.isFetching} onClick={() => void agendaQuery.refetch()}>
            {agendaQuery.isFetching ? 'Tentando novamente…' : 'Tentar novamente'}
          </button>
        </div>
      )}
      <form className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2" onSubmit={salvarAgenda}>
        <h3 className="font-medium sm:col-span-2">{editando ? 'Editar recorrência semanal' : 'Nova recorrência semanal'}</h3>
        <label className="text-sm">Nome<input className="input mt-1" value={nomeAgenda} onChange={(e) => setNomeAgenda(e.target.value)} required maxLength={120} disabled={mutation.isPending} /></label>
        <label className="text-sm">Dia da semana<select className="input mt-1" value={diaSemana} onChange={(e) => setDiaSemana(Number(e.target.value))} disabled={mutation.isPending}>{dias.map((dia, index) => <option key={dia} value={index}>{dia}</option>)}</select></label>
        <label className="text-sm">Horário de início<input className="input mt-1" type="time" value={horaAgenda} onChange={(e) => setHoraAgenda(e.target.value)} required disabled={mutation.isPending} /></label>
        <div className="flex items-end gap-2"><button className="touch-btn-primary" type="submit" disabled={mutation.isPending}>{editando ? 'Salvar edição' : 'Cadastrar recorrência'}</button>{editando && <button className="touch-btn-secondary" type="button" disabled={mutation.isPending} onClick={() => { setEditando(''); setNomeAgenda(''); }}>Cancelar edição</button>}</div>
      </form>

      <form className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-3" onSubmit={(event) => {
        event.preventDefault();
        const payload = { nome: nomeAvulsa.trim(), data: dataAvulsa };
        mutation.mutate({ tipo: 'criar-avulsa', payload });
      }}>
        <h3 className="font-medium sm:col-span-3">Ocorrência avulsa</h3>
        <label className="text-sm">Nome<input className="input mt-1" value={nomeAvulsa} onChange={(e) => setNomeAvulsa(e.target.value)} required maxLength={120} disabled={mutation.isPending} /></label>
        <label className="text-sm">Data<input className="input mt-1" type="date" value={dataAvulsa} onChange={(e) => setDataAvulsa(e.target.value)} required disabled={mutation.isPending} /></label>
        <div className="flex items-end"><button className="touch-btn-primary" type="submit" disabled={mutation.isPending}>Cadastrar ocorrência</button></div>
      </form>

      <div className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <h3 className="font-medium sm:col-span-3">Gerar ocorrências semanais</h3>
        <label className="text-sm">Recorrência<select className="input mt-1" value={agendaId} onChange={(e) => setAgendaId(e.target.value)}><option value="">Selecione</option>{agendas.map((agenda) => <option key={agenda.id} value={agenda.id}>{agenda.nome} · {dias[agenda.diaSemana]}</option>)}</select></label>
        <label className="text-sm">Período<input className="input mt-1" aria-label="Início do período" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /> <input className="input mt-1" aria-label="Fim do período" type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></label>
        <button className="touch-btn-secondary" type="button" disabled={!agendaId || mutation.isPending} onClick={() => mutation.mutate({ tipo: 'gerar', agendaId, inicio, fim })}>Gerar período</button>
      </div>

      <div className="space-y-2">
        <h3 className="font-medium">Recorrências semanais</h3>
        {agendaQuery.isLoading ? <p className="text-sm text-ink-faint">Carregando recorrências…</p> : agendas.length === 0 ? <p className="text-sm text-ink-faint">Nenhuma recorrência cadastrada.</p> : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {agendas.map((agenda) => <li key={agenda.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div><strong>{agenda.nome}</strong><p className="text-sm text-ink-faint">Semanal ({dias[agenda.diaSemana]}) · {agenda.horaInicio}{agenda.ativa ? ' · ativa' : ' · inativa'}</p></div>
              <button type="button" className="touch-btn-secondary" disabled={mutation.isPending} aria-label={`Editar recorrência ${agenda.nome}`} onClick={() => editarAgenda(agenda)}>Editar recorrência</button>
            </li>)}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Listar de<input className="input mt-1" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
        <label className="text-sm">até<input className="input mt-1" type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></label>
      </div>
      {agendaQuery.isError ? null : agendaQuery.isLoading ? <p className="text-sm text-ink-faint">Carregando agenda…</p> : ocorrencias.length === 0 ? <p className="text-sm text-ink-faint">Nenhuma ocorrência neste período.</p> : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {ocorrencias.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div><strong>{item.nome}</strong><p className="text-sm text-ink-faint">{dataPt(item.data)} · {item.agenda ? `semanal (${dias[item.agenda.diaSemana]})` : 'avulsa'} · {item.status}</p></div>
          </li>)}
        </ul>
      )}
    </section>
  );
}
