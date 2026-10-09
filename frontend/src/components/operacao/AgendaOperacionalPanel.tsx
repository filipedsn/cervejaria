import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';

type Agenda = { id: string; nome: string; diaSemana: number; horaInicio: string; horaFim: string | null; local: string | null; ativa: boolean };
type Ocorrencia = { id: string; agendaId: string | null; nome: string; data: string; horaInicio?: string | null; horaFim: string | null; local: string | null; status: 'PROGRAMADA' | 'ABERTA' | 'FECHADA' | 'CANCELADA'; agenda: { nome: string; frequencia: 'SEMANAL'; diaSemana: number } | null };
type AgendaPayload = { nome: string; diaSemana: number; horaInicio: string };
type OperacaoAgenda =
  | { tipo: 'salvar-agenda'; id: string | null; payload: AgendaPayload | (AgendaPayload & { ativa: true }) }
  | { tipo: 'criar-avulsa'; payload: { nome: string; data: string } }
  | { tipo: 'gerar'; agendaId: string; inicio: string; fim: string };
type Formulario = 'recorrencia' | 'avulsa' | 'gerar' | null;

const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const statusLabel: Record<Ocorrencia['status'], string> = { PROGRAMADA: 'Programada', ABERTA: 'Aberta', FECHADA: 'Fechada', CANCELADA: 'Cancelada' };

function dataLocal(diasDelta = 0) {
  const data = new Date();
  data.setDate(data.getDate() + diasDelta);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}
function dataPt(value: string) { return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }); }

export function AgendaOperacionalPanel() {
  const queryClient = useQueryClient();
  const [inicio, setInicio] = useState(dataLocal());
  const [fim, setFim] = useState(dataLocal(90));
  const [filtroAberto, setFiltroAberto] = useState(false);
  const [agendarAberto, setAgendarAberto] = useState(false);
  const [formulario, setFormulario] = useState<Formulario>(null);
  const [nomeAgenda, setNomeAgenda] = useState('');
  const [diaSemana, setDiaSemana] = useState(6);
  const [horaAgenda, setHoraAgenda] = useState('18:00');
  const [agendaId, setAgendaId] = useState('');
  const [nomeAvulsa, setNomeAvulsa] = useState('');
  const [dataAvulsa, setDataAvulsa] = useState(dataLocal());
  const [editando, setEditando] = useState('');
  const [rascunhoOriginal, setRascunhoOriginal] = useState('');
  const [erro, setErro] = useState('');
  const agendaQuery = useQuery({
    queryKey: ['operacao-agenda-ocorrencias', 'gestao', inicio, fim],
    queryFn: () => api.get<{ agendas: Agenda[]; ocorrencias: Ocorrencia[] }>(`/api/operacao/agenda/ocorrencias?inicio=${inicio}&fim=${fim}`),
  });
  const agendas = useMemo(() => agendaQuery.data?.agendas ?? [], [agendaQuery.data]);
  const ocorrencias = agendaQuery.data?.ocorrencias ?? [];
  const grupos = useMemo(() => {
    const agrupados = new Map<string, Ocorrencia[]>();
    for (const ocorrencia of ocorrencias) agrupados.set(ocorrencia.data, [...(agrupados.get(ocorrencia.data) ?? []), ocorrencia]);
    return [...agrupados.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [ocorrencias]);
  const mutation = useMutation({
    mutationFn: async (operation: OperacaoAgenda) => {
      if (operation.tipo === 'salvar-agenda') return operation.id
        ? api.patch(`/api/operacao/agenda/agendas/${encodeURIComponent(operation.id)}`, operation.payload)
        : api.post('/api/operacao/agenda/agendas', operation.payload);
      if (operation.tipo === 'criar-avulsa') return api.post('/api/operacao/agenda/ocorrencias', operation.payload);
      return api.post(`/api/operacao/agenda/agendas/${encodeURIComponent(operation.agendaId)}/gerar`, { inicio: operation.inicio, fim: operation.fim });
    },
    onSuccess: () => {
      setErro('');
      void queryClient.invalidateQueries({ queryKey: ['operacao-agenda-ocorrencias'] });
      setFormulario(null);
      setEditando('');
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : 'Não foi possível salvar. Confira os dados e tente novamente.'),
  });
  const snapshot = () => JSON.stringify({ formulario, nomeAgenda, diaSemana, horaAgenda, agendaId, nomeAvulsa, dataAvulsa });
  const closeForm = (force = false) => {
    if (!force && rascunhoOriginal && snapshot() !== rascunhoOriginal && !window.confirm('Descartar as alterações deste formulário?')) return;
    setFormulario(null); setErro(''); setEditando('');
  };
  const openForm = (kind: Exclude<Formulario, null>, selectedAgendaId = '') => {
    setErro(''); setEditando(''); setAgendaId(selectedAgendaId);
    if (kind === 'recorrencia') { setNomeAgenda(''); setDiaSemana(6); setHoraAgenda('18:00'); }
    if (kind === 'avulsa') { setNomeAvulsa(''); setDataAvulsa(dataLocal()); }
    setFormulario(kind);
    setRascunhoOriginal(JSON.stringify({ formulario: kind, nomeAgenda: kind === 'recorrencia' ? '' : nomeAgenda, diaSemana: kind === 'recorrencia' ? 6 : diaSemana, horaAgenda: kind === 'recorrencia' ? '18:00' : horaAgenda, agendaId: selectedAgendaId, nomeAvulsa: kind === 'avulsa' ? '' : nomeAvulsa, dataAvulsa: kind === 'avulsa' ? dataLocal() : dataAvulsa }));
  };
  const editarAgenda = (agenda: Agenda) => {
    setEditando(agenda.id); setFormulario('recorrencia'); setNomeAgenda(agenda.nome); setDiaSemana(agenda.diaSemana); setHoraAgenda(agenda.horaInicio); setAgendaId(''); setErro('');
    setRascunhoOriginal(JSON.stringify({ formulario: 'recorrencia', nomeAgenda: agenda.nome, diaSemana: agenda.diaSemana, horaAgenda: agenda.horaInicio, agendaId: '', nomeAvulsa, dataAvulsa }));
  };
  const gerarDatas = (agenda: Agenda) => openForm('gerar', agenda.id);
  const submitAgenda = (event: React.FormEvent) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const id = editando || null;
    const payload = { nome: nomeAgenda.trim(), diaSemana, horaInicio: horaAgenda };
    mutation.mutate({ tipo: 'salvar-agenda', id, payload: id ? payload : { ...payload, ativa: true } });
  };
  useEffect(() => {
    if (!formulario) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !mutation.isPending) closeForm(); };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); document.body.style.overflow = originalOverflow; };
  });
  const periodo = `${dataPt(inicio)} – ${dataPt(fim)}`;

  return (
    <section className="space-y-4" aria-label="Agenda">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <button type="button" className="touch-btn-primary min-h-11" aria-expanded={agendarAberto} onClick={() => setAgendarAberto(!agendarAberto)}>+ Agendar</button>
          {agendarAberto && <div className="absolute left-0 top-full z-20 mt-2 grid min-w-56 gap-1 rounded-xl border border-line bg-surface p-2 shadow-xl">
            <button type="button" className="min-h-11 rounded-lg px-3 text-left hover:bg-surface-lighter" onClick={() => { setAgendarAberto(false); openForm('avulsa'); }}>Ocorrência avulsa</button>
            <button type="button" className="min-h-11 rounded-lg px-3 text-left hover:bg-surface-lighter" onClick={() => { setAgendarAberto(false); openForm('recorrencia'); }}>Recorrência semanal</button>
          </div>}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-ink-muted">
          <span className="break-words">Período: {periodo}</span>
          <button type="button" className="touch-btn-secondary min-h-11" aria-expanded={filtroAberto} onClick={() => setFiltroAberto(!filtroAberto)}>Filtrar período</button>
        </div>
      </div>
      {filtroAberto && <div className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2">
        <label className="text-sm">Início do período<input className="input mt-1 min-h-11 w-full" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
        <label className="text-sm">Fim do período<input className="input mt-1 min-h-11 w-full" type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></label>
      </div>}

      {agendaQuery.isError && <div className="alert-error flex flex-wrap items-center justify-between gap-3" role="alert">
        <span>Não foi possível carregar a agenda. Verifique sua conexão e tente novamente.</span>
        <button type="button" className="touch-btn-secondary min-h-11" disabled={agendaQuery.isFetching} onClick={() => void agendaQuery.refetch()}>{agendaQuery.isFetching ? 'Tentando novamente…' : 'Tentar novamente'}</button>
      </div>}

      <section aria-label="Ocorrências" className="space-y-3">
        {agendaQuery.isLoading ? <p className="py-6 text-center text-sm text-ink-faint" role="status">Carregando agenda…</p> : !agendaQuery.isError && grupos.length === 0 ? <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
          <p className="font-medium">Nenhuma ocorrência no período</p>
          <button type="button" className="touch-btn-primary mt-4 min-h-11" onClick={() => openForm('avulsa')}>Agendar ocorrência</button>
        </div> : grupos.map(([data, itens]) => <div key={data} className="space-y-2">
          <h3 className="sticky top-0 z-10 bg-canvas py-1 text-sm font-semibold text-ink-muted">{dataPt(data)}</h3>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {itens.map((item) => <li key={item.id} className="flex min-h-14 flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0"><strong className="break-words">{item.nome}</strong><p className="text-sm text-ink-faint">{item.horaInicio ? item.horaFim ? `${item.horaInicio}–${item.horaFim}` : item.horaInicio : null}{item.horaInicio ? ' · ' : ''}{statusLabel[item.status]}</p></div>
              {item.agenda && <span className="shrink-0 text-xs text-ink-faint">{item.agenda.nome}</span>}
            </li>)}
          </ul>
        </div>)}
      </section>

      <details className="rounded-xl border border-line bg-surface">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden"><span>Recorrências</span><span className="rounded-full bg-surface-lighter px-2.5 py-1 text-sm font-medium">{agendas.length}</span></summary>
        {agendaQuery.isLoading ? <p className="px-4 pb-4 text-sm text-ink-faint">Carregando recorrências…</p> : agendas.length === 0 ? <p className="px-4 pb-4 text-sm text-ink-faint">Nenhuma recorrência cadastrada.</p> : <ul className="divide-y divide-line border-t border-line">
          {agendas.map((agenda) => <li key={agenda.id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0"><strong className="break-words">{agenda.nome}</strong><p className="text-sm text-ink-faint">{dias[agenda.diaSemana]} · {agenda.horaInicio} · {agenda.ativa ? 'Ativa' : 'Inativa'}</p></div>
            <div className="flex flex-wrap gap-2"><button type="button" className="touch-btn-secondary min-h-11 flex-1 sm:flex-none" aria-label={`Editar recorrência ${agenda.nome}`} onClick={() => editarAgenda(agenda)}>Editar</button><button type="button" className="touch-btn-secondary min-h-11 flex-1 sm:flex-none" onClick={() => gerarDatas(agenda)}>Gerar datas</button></div>
          </li>)}
        </ul>}
      </details>

      {formulario && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 px-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !mutation.isPending) closeForm(); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="agenda-form-title" className="flex max-h-[min(92dvh,900px)] w-full min-w-0 flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:max-w-xl sm:rounded-2xl">
          <header className="shrink-0 border-b border-line px-4 py-3 sm:px-6"><h2 id="agenda-form-title" className="text-lg font-semibold">{formulario === 'recorrencia' ? editando ? 'Editar recorrência semanal' : 'Recorrência semanal' : formulario === 'avulsa' ? 'Ocorrência avulsa' : 'Gerar datas'}</h2></header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {erro && <div className="alert-error mb-4" role="alert">{erro}</div>}
            {agendaQuery.isError && <div className="alert-error mb-4 flex flex-wrap items-center justify-between gap-3" role="alert"><span>Não foi possível carregar a agenda.</span><button type="button" className="touch-btn-secondary min-h-11" disabled={agendaQuery.isFetching} onClick={() => void agendaQuery.refetch()}>{agendaQuery.isFetching ? 'Tentando novamente…' : 'Tentar novamente'}</button></div>}
            {formulario === 'recorrencia' && <form id="agenda-form" className="grid gap-4" onSubmit={submitAgenda}>
              <label className="text-sm">Nome<input className="input mt-1 min-h-11 w-full" value={nomeAgenda} onChange={(e) => setNomeAgenda(e.target.value)} required maxLength={120} disabled={mutation.isPending} /></label>
              <label className="text-sm">Dia da semana<select className="input mt-1 min-h-11 w-full" value={diaSemana} onChange={(e) => setDiaSemana(Number(e.target.value))} disabled={mutation.isPending}>{dias.map((dia, index) => <option key={dia} value={index}>{dia}</option>)}</select></label>
              <label className="text-sm">Horário de início<input className="input mt-1 min-h-11 w-full" type="time" value={horaAgenda} onChange={(e) => setHoraAgenda(e.target.value)} required disabled={mutation.isPending} /></label>
            </form>}
            {formulario === 'avulsa' && <form id="agenda-form" className="grid gap-4" onSubmit={(event) => { event.preventDefault(); if (!mutation.isPending) mutation.mutate({ tipo: 'criar-avulsa', payload: { nome: nomeAvulsa.trim(), data: dataAvulsa } }); }}>
              <label className="text-sm">Nome<input className="input mt-1 min-h-11 w-full" value={nomeAvulsa} onChange={(e) => setNomeAvulsa(e.target.value)} required maxLength={120} disabled={mutation.isPending} /></label>
              <label className="text-sm">Data<input className="input mt-1 min-h-11 w-full" type="date" value={dataAvulsa} onChange={(e) => setDataAvulsa(e.target.value)} required disabled={mutation.isPending} /></label>
            </form>}
            {formulario === 'gerar' && <form id="agenda-form" className="grid gap-4" onSubmit={(event) => { event.preventDefault(); if (!mutation.isPending) mutation.mutate({ tipo: 'gerar', agendaId, inicio, fim }); }}>
              <label className="text-sm">Recorrência<select className="input mt-1 min-h-11 w-full" value={agendaId} onChange={(e) => setAgendaId(e.target.value)} required disabled={mutation.isPending}><option value="">Selecione</option>{agendas.map((agenda) => <option key={agenda.id} value={agenda.id}>{agenda.nome} · {dias[agenda.diaSemana]}</option>)}</select></label>
              <p className="text-sm text-ink-muted">Período da geração: {periodo}</p>
              <p className="text-sm text-ink-faint">A geração pode ser repetida com segurança para este período.</p>
            </form>}
          </div>
          <footer className="sticky bottom-0 grid shrink-0 grid-cols-2 gap-2 border-t border-line bg-surface px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
            <button type="button" className="touch-btn-orange min-h-11" disabled={mutation.isPending} onClick={() => closeForm()}>Voltar</button>
            <button form="agenda-form" type="submit" className="touch-btn-primary min-h-11" disabled={mutation.isPending}>{mutation.isPending ? 'Salvando…' : formulario === 'recorrencia' ? editando ? 'Salvar edição' : 'Cadastrar recorrência' : formulario === 'avulsa' ? 'Cadastrar ocorrência' : 'Gerar datas'}</button>
          </footer>
        </section>
      </div>}
    </section>
  );
}
