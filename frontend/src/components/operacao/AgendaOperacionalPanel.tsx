import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { Modal } from '../Modal';

type Agenda = { id: string; nome: string; diaSemana: number; horaInicio: string; horaFim: string | null; local: string | null; ativa: boolean; archivedAt?: string | null; _count: { ocorrencias: number } };
type Confirmation = { kind: 'discard'; navigation?: boolean; restoring?: boolean } | { kind: 'cancel'; item: Ocorrencia } | { kind: 'restore'; item: Ocorrencia; requestId: string } | { kind: 'stop'; agendaId: string } | { kind: 'archive'; agendaId: string };
type Ocorrencia = { id: string; agendaId: string | null; nome: string; data: string; horaInicio?: string | null; horaFim?: string | null; local?: string | null; status: 'PROGRAMADA' | 'ABERTA' | 'FECHADA' | 'CANCELADA'; podeEditar: boolean; podeCancelar: boolean; podeRestaurar?: boolean; bloqueio: string | null; bloqueioRestauracao?: string | null };
type Draft = { requestId: string; nome: string; data: string; horaInicio: string; horaFim: string; local: string; repetirSemanalmente: boolean; agendaId?: string; ocorrenciaId?: string; fim: string; gerarDatas: boolean };
type RestoreDraft = { item: Ocorrencia; requestId: string; data: string; horaInicio: string; horaFim: string };
const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const estados = { PROGRAMADA: 'Programada', ABERTA: 'Aberta', FECHADA: 'Fechada', CANCELADA: 'Cancelada' };
const statusColor = { PROGRAMADA: 'text-brand-600', ABERTA: 'text-success', FECHADA: 'text-ink-muted', CANCELADA: 'text-danger' };
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function localDate(key: string) { return new Date(`${key}T12:00:00`); }
function labelDate(key: string) { return localDate(key).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }); }
function monthRange(key: string) { const date = localDate(key); return { inicio: dateKey(new Date(date.getFullYear(), date.getMonth(), 1)), fim: dateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0)) }; }

export function AgendaOperacionalPanel() {
  const today = dateKey(new Date());
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(today);
  const [view, setView] = useState<'Mês' | 'Lista'>('Mês');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<Ocorrencia | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [restoreDraft, setRestoreDraft] = useState<RestoreDraft | null>(null);
  const [baseline, setBaseline] = useState('');
  const [error, setError] = useState('');
  const submitLock = useRef(false);
  const resumeFocusIndex = useRef<number | null>(null);
  const navigationPrompted = useRef(false);
  const queryClient = useQueryClient();
  const { inicio, fim } = monthRange(month);
  const query = useQuery({ queryKey: ['operacao-agenda-ocorrencias', 'gestao', inicio, fim], queryFn: () => api.get<{ agendas: Agenda[]; ocorrencias: Ocorrencia[] }>(`/api/operacao/agenda/ocorrencias?inicio=${inicio}&fim=${fim}`) });
  const agendas = query.data?.agendas ?? [];
  const archivedQuery = useQuery({ queryKey: ['operacao-agenda-arquivadas'], queryFn: () => api.get<{ agendas: Agenda[] }>('/api/operacao/agenda/agendas/arquivadas'), enabled: rulesOpen && showArchived });
  const displayedRules = showArchived ? archivedQuery.data?.agendas ?? [] : agendas;
  const ocorrencias = query.data?.ocorrencias ?? [];
  const byDay = useMemo(() => {
    const result = new Map<string, Ocorrencia[]>();
    for (const item of ocorrencias) result.set(item.data, [...(result.get(item.data) ?? []), item]);
    return result;
  }, [ocorrencias]);
  const visibleDays = view === 'Mês' ? [[selected, byDay.get(selected) ?? []] as const] : [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const mutation = useMutation({
    mutationFn: (operation: { path: string; body: unknown; restoreItem?: Ocorrencia }) => api.post(operation.path, operation.body),
    onSuccess: (_result, operation) => { const saved = operation.body as Partial<Draft>; if (operation.restoreItem) { const item = operation.restoreItem; const updated = { ...item, data: String(saved.data), horaInicio: String(saved.horaInicio), horaFim: String(saved.horaFim), status: 'PROGRAMADA' as const, podeEditar: true, podeCancelar: true, podeRestaurar: false, bloqueio: null, bloqueioRestauracao: null }; setDetail(updated); setMonth(updated.data); setSelected(updated.data); setRestoreDraft(null); setNotice('Agendamento restaurado.'); } else { if (saved.requestId && saved.data) { setMonth(saved.data); setSelected(saved.data); } if (operation.path.endsWith('/arquivar')) setNotice('Repetição removida da lista. As datas existentes foram preservadas.'); setDraft(null); setDetail(null); } setError(''); void queryClient.invalidateQueries({ queryKey: ['operacao-agenda-ocorrencias'] }); void queryClient.invalidateQueries({ queryKey: ['operacao-agenda-arquivadas'] }); },
    onError: (err, operation) => {
      if (operation.restoreItem) { const body = operation.body as RestoreDraft; setRestoreDraft({ item: operation.restoreItem, requestId: body.requestId, data: body.data, horaInicio: body.horaInicio ?? '', horaFim: body.horaFim ?? '' }); setDetail(null); }
      if (err instanceof ApiError && err.body?.code === 'AGENDA_HORARIO_CONFLITO' && err.body.details && typeof err.body.details === 'object') {
        const conflict = (err.body.details as { conflito?: { nome?: string; data?: string; horaInicio?: string | null; horaFim?: string | null } }).conflito;
        if (conflict?.nome && conflict.data && conflict.horaInicio && conflict.horaFim) {
          const date = conflict.data.split('-').reverse().join('/');
          setError(`Conflito com ${conflict.nome} em ${date}, das ${conflict.horaInicio.slice(0, 5)} às ${conflict.horaFim.slice(0, 5)}.`);
          return;
        }
      }
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar. Tente novamente.');
    },
    onSettled: () => { submitLock.current = false; },
  });
  function write(path: string, body: unknown, restoreItem?: Ocorrencia) { if (submitLock.current) return; submitLock.current = true; setError(''); mutation.mutate({ path, body, restoreItem }); }
  function ask(value: Confirmation) { const nodes = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button:not(:disabled), [role="dialog"] input:not(:disabled), [role="dialog"] select:not(:disabled), [role="dialog"] summary')]; resumeFocusIndex.current = nodes.indexOf(document.activeElement as HTMLElement); setConfirmation(value); }
  function closeDraft() { if (mutation.isPending) return; if (draft && JSON.stringify(draft) !== baseline) { ask({ kind: 'discard' }); return; } setDraft(null); setError(''); }
  function refuseConfirmation() { if (confirmation?.kind === 'discard' && confirmation.navigation && blocker.state === 'blocked') blocker.reset(); setConfirmation(null); }
  function acceptConfirmation() {
    if (!confirmation || mutation.isPending) return;
    const selectedConfirmation = confirmation; setConfirmation(null);
    if (selectedConfirmation.kind === 'discard') { if (selectedConfirmation.restoring && restoreDraft) { setDetail(restoreDraft.item); setRestoreDraft(null); } else setDraft(null); setError(''); if (selectedConfirmation.navigation && blocker.state === 'blocked') blocker.proceed(); }
    else if (selectedConfirmation.kind === 'cancel') write(`/api/operacao/agenda/ocorrencias/${encodeURIComponent(selectedConfirmation.item.id)}/cancelar`, {});
    else if (selectedConfirmation.kind === 'restore') { const item = selectedConfirmation.item; const body = { requestId: selectedConfirmation.requestId!, data: item.data, horaInicio: item.horaInicio ?? null, horaFim: item.horaFim ?? null }; write(`/api/operacao/agenda/ocorrencias/${encodeURIComponent(item.id)}/restaurar`, body, item); }
    else write(`/api/operacao/agenda/agendas/${encodeURIComponent(selectedConfirmation.agendaId)}/${selectedConfirmation.kind === 'archive' ? 'arquivar' : 'interromper'}`, {});
  }
  function openDraft(values: Partial<Draft> = {}) {
    const next = { requestId: crypto.randomUUID(), nome: '', data: selected, horaInicio: '18:00', horaFim: '', local: '', repetirSemanalmente: false, fim, gerarDatas: true, ...values };
    setDetail(null); setRulesOpen(false); setError(''); setDraft(next); setBaseline(JSON.stringify(next));
  }
  function openRule(agenda: Agenda) {
    const date = localDate(selected); date.setDate(date.getDate() + (agenda.diaSemana - date.getDay() + 7) % 7);
    const data = dateKey(date); const end = monthRange(data).fim;
    openDraft({ nome: agenda.nome, data, fim: end, horaInicio: agenda.horaInicio, horaFim: agenda.horaFim ?? '', local: agenda.local ?? '', repetirSemanalmente: true, agendaId: agenda.id, gerarDatas: agenda.ativa });
  }
  function navigate(offset: number) {
    const date = localDate(month); const next = dateKey(new Date(date.getFullYear(), date.getMonth() + offset, 1));
    setMonth(next); setSelected(next);
  }
  function cancel(item: Ocorrencia) {
    ask({ kind: 'cancel', item });
  }
  function restore(item: Ocorrencia) { ask({ kind: 'restore', item, requestId: crypto.randomUUID() }); }
  function closeRestoreDraft() { if (mutation.isPending || !restoreDraft) return; if (restoreDraft.data !== restoreDraft.item.data || restoreDraft.horaInicio !== (restoreDraft.item.horaInicio ?? '') || restoreDraft.horaFim !== (restoreDraft.item.horaFim ?? '')) { ask({ kind: 'discard', restoring: true }); return; } setRestoreDraft(null); setError(''); setDetail(restoreDraft.item); }
  function stop(agendaId: string) {
    ask({ kind: 'stop', agendaId });
  }
  const rule = agendas.find((agenda) => agenda.id === draft?.agendaId);
  const originalDraft = useMemo(() => { try { return baseline ? JSON.parse(baseline) as Draft : null; } catch { return null; } }, [baseline]);
  const preserveIncompleteLegacyTime = Boolean(draft && originalDraft && (!originalDraft.horaInicio || !originalDraft.horaFim) && draft.horaInicio === originalDraft.horaInicio && draft.horaFim === originalDraft.horaFim && ((draft.ocorrenciaId && draft.data === originalDraft.data) || (draft.agendaId && !draft.gerarDatas && localDate(draft.data).getDay() === localDate(originalDraft.data).getDay())));
  const detailRule = agendas.find((agenda) => agenda.id === detail?.agendaId);
  const first = localDate(inicio); const length = localDate(fim).getDate();
  const cells = Array.from({ length: Math.ceil((first.getDay() + length) / 7) * 7 }, (_, index) => index - first.getDay() + 1);
  const modalOpen = Boolean(draft || detail || restoreDraft || rulesOpen || confirmation);
  const dirty = Boolean((draft && JSON.stringify(draft) !== baseline) || (restoreDraft && (restoreDraft.data !== restoreDraft.item.data || restoreDraft.horaInicio !== (restoreDraft.item.horaInicio ?? '') || restoreDraft.horaFim !== (restoreDraft.item.horaFim ?? ''))));
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state !== 'blocked') { navigationPrompted.current = false; return; }
    if (mutation.isPending) { blocker.reset(); return; }
    if (!navigationPrompted.current) { navigationPrompted.current = true; ask({ kind: 'discard', navigation: true }); }
  }, [blocker, mutation.isPending]);
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => { const nodes = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button:not(:disabled), [role="dialog"] input:not(:disabled), [role="dialog"] select:not(:disabled), [role="dialog"] summary')]; const index = confirmation ? 0 : resumeFocusIndex.current; (index !== null && index >= 0 ? nodes[index] ?? nodes[0] : document.querySelector<HTMLElement>('[role="dialog"] input, [role="dialog"] button'))?.focus(); if (!confirmation) resumeFocusIndex.current = null; }, 0);
    return () => { clearTimeout(timer); document.body.style.overflow = overflow; previous?.focus(); };
  }, [modalOpen, confirmation, draft?.requestId, restoreDraft?.requestId, detail?.id, rulesOpen]);
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !mutation.isPending) { if (confirmation) refuseConfirmation(); else if (restoreDraft) closeRestoreDraft(); else if (draft) closeDraft(); else { setDetail(null); setRulesOpen(false); setError(''); } }
      if (event.key === 'Tab') {
        const nodes = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button:not(:disabled), [role="dialog"] input:not(:disabled), [role="dialog"] select:not(:disabled), [role="dialog"] summary')];
        if (!document.activeElement?.closest('[role="dialog"]')) { event.preventDefault(); nodes[0]?.focus(); }
        else if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
      }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  return <section aria-label="Calendário de agendamentos" className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1">
      <button type="button" className="touch-btn-secondary !px-3" onClick={() => { setMonth(today); setSelected(today); }}>Hoje</button>
      <div className="flex items-center gap-1"><button type="button" className="min-h-11 min-w-11 rounded-lg border border-line" aria-label="Mês anterior" onClick={() => navigate(-1)}>‹</button><button type="button" className="min-h-11 min-w-11 rounded-lg border border-line" aria-label="Próximo mês" onClick={() => navigate(1)}>›</button></div>
      <span className="min-w-0 flex-1 text-base font-semibold" aria-live="polite">{first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span>
      </div>
      <div className="flex w-full items-center justify-between gap-2 sm:w-auto">
      <div className="flex rounded-xl border border-line p-1" role="group" aria-label="Visualização">{(['Mês', 'Lista'] as const).map((option) => <button key={option} type="button" aria-pressed={view === option} className={`min-h-11 rounded-lg px-4 text-sm font-medium ${view === option ? 'bg-brand-600 text-white' : 'text-ink-muted'}`} onClick={() => setView(option)}>{option}</button>)}</div>
      <button type="button" className="touch-btn-primary flex-1 !px-3 text-sm sm:flex-none sm:text-base" onClick={() => openDraft()}>+ Novo agendamento</button>
      </div>
    </div>
    <div className="flex items-center justify-between gap-3 text-sm text-ink-muted"><span>{ocorrencias.length} agendamento{ocorrencias.length === 1 ? '' : 's'} no mês</span><button type="button" className="min-h-11 rounded-lg px-3 underline underline-offset-4" onClick={() => { setError(''); setShowArchived(false); setRulesOpen(true); }}>Repetições ({agendas.length})</button></div>
    {notice && !rulesOpen && <p role="status" className="rounded-xl bg-success-soft p-3 text-sm text-ink">{notice}</p>}
    {query.isError && <div role="alert" className="alert-error flex flex-wrap items-center gap-3"><span>Não foi possível carregar a agenda.</span><button type="button" className="touch-btn-secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>Tentar novamente</button></div>}
    {query.isFetching && <p role="status" className="text-sm text-ink-faint">Carregando agendamentos…</p>}
    {view === 'Mês' && <div className="rounded-2xl border border-line bg-surface p-2 sm:p-4">
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-ink-muted" aria-hidden="true">{['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((day) => <span key={day} className="py-2">{day}</span>)}</div>
      <div className="grid grid-cols-7 gap-1" aria-label="Dias do mês">{cells.map((day, index) => {
        if (day < 1 || day > length) return <div key={`empty-${index}`} aria-hidden="true" />;
        const key = `${inicio.slice(0, 8)}${String(day).padStart(2, '0')}`; const count = byDay.get(key)?.length ?? 0;
        return <button key={key} type="button" aria-label={`${labelDate(key)}, ${count} agendamentos`} aria-pressed={selected === key} className={`flex min-h-12 min-w-0 flex-col items-center justify-center rounded-xl text-sm sm:min-h-20 ${selected === key ? 'bg-brand-600 text-white' : key === today ? 'border border-brand-600 bg-brand-600/10' : 'hover:bg-surface-lighter'}`} onClick={() => setSelected(key)}><span>{day}</span><span className={`mt-1 h-1.5 w-1.5 rounded-full ${count ? selected === key ? 'bg-white' : 'bg-brand-600' : 'bg-transparent'}`} aria-hidden="true" /></button>;
      })}</div>
    </div>}
    {!query.isError && !query.isLoading && <div className="space-y-4">
      {view === 'Lista' && visibleDays.length === 0 && <p className="py-8 text-center text-sm text-ink-muted">Nenhum agendamento neste mês.</p>}
      {visibleDays.map(([day, items]) => <section key={day} aria-label={labelDate(day)} className="space-y-2"><h3 className="text-sm font-semibold text-ink-muted">{labelDate(day)}</h3>{items.length === 0 ? <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-muted">Nenhum agendamento neste dia.</p> : <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">{items.map((item) => <li key={item.id}><button type="button" className="flex min-h-16 w-full items-center gap-3 p-3 text-left hover:bg-surface-lighter" onClick={() => { setError(''); setDetail(item); }}><span className="w-12 shrink-0 text-sm text-ink-muted">{item.horaInicio || '—'}</span><span className="min-w-0 flex-1"><strong className="block break-words">{item.nome}</strong><span className={`text-sm ${statusColor[item.status]}`}>{estados[item.status]}{item.agendaId ? ' · Semanal' : ''}</span></span><span className="text-ink-faint" aria-hidden="true">›</span></button></li>)}</ul>}</section>)}
    </div>}
    <Modal open={rulesOpen && !confirmation} title={showArchived ? 'Repetições arquivadas' : 'Repetições'} onClose={() => { if (!mutation.isPending) setRulesOpen(false); }} footer={<button type="button" className="touch-btn-orange w-full" disabled={mutation.isPending} onClick={() => { setRulesOpen(false); setShowArchived(false); }}>Voltar</button>}>
      <p className="mb-4 text-sm text-ink-muted">Regras semanais. Somente as datas já agendadas aparecem no calendário.</p>
      <button type="button" className="touch-btn-secondary mb-3" onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Voltar à lista' : 'Ver arquivadas'}</button>
      {error && <div role="alert" className="alert-error mb-3">{error}</div>}
      {notice && <p role="status" className="mb-3 text-sm text-success">{notice}</p>}
      {query.isError && <p className="text-sm text-danger">Não foi possível carregar as repetições.</p>}
      {showArchived && archivedQuery.isLoading && <p role="status">Carregando arquivadas…</p>}
      {showArchived && archivedQuery.isError && <div role="alert" className="alert-error">Não foi possível carregar as arquivadas.<button type="button" className="touch-btn-secondary" onClick={() => void archivedQuery.refetch()}>Tentar novamente</button></div>}
      {!query.isError && displayedRules.length === 0 && !archivedQuery.isFetching && <p className="py-4 text-sm text-ink-muted">{showArchived ? 'Nenhuma repetição arquivada.' : 'Nenhuma repetição cadastrada.'}</p>}
      <ul className="divide-y divide-line">{displayedRules.map((agenda) => <li key={agenda.id} className="space-y-2 py-3">
        <strong className="block break-words">{agenda.nome}</strong><span className="block text-sm text-ink-muted">{dias[agenda.diaSemana]} · {agenda.horaInicio} · {agenda.ativa ? 'Ativa' : 'Inativa'}{agenda.archivedAt ? ' · Arquivada' : ''}</span>
        <span className="block text-sm text-ink-faint">{agenda._count?.ocorrencias === 0 ? 'Ainda sem datas agendadas · total em todos os períodos' : agenda._count ? `${agenda._count.ocorrencias} datas no total · todos os períodos (inclui canceladas)` : 'Contagem de datas indisponível'}</span>
        {!showArchived && <div className="flex flex-wrap gap-2"><button type="button" className="touch-btn-secondary" aria-label={`Editar repetição ${agenda.nome}`} disabled={mutation.isPending} onClick={() => openRule(agenda)}>Editar</button>{agenda.ativa && <button type="button" className="touch-btn-secondary" disabled={mutation.isPending} onClick={() => stop(agenda.id)}>Interromper repetição</button>}<button type="button" className="touch-btn-secondary" disabled={mutation.isPending} onClick={() => ask({ kind: 'archive', agendaId: agenda.id })}>Remover da lista</button></div>}
      </li>)}</ul>
    </Modal>
    <Modal open={Boolean(detail) && !confirmation && !restoreDraft} title="Agendamento" onClose={() => { if (!mutation.isPending) setDetail(null); }} footer={<button type="button" className="touch-btn-orange w-full" disabled={mutation.isPending} onClick={() => setDetail(null)}>Voltar</button>}>
      {detail && <div className="space-y-4 pb-3"><div><h3 className="text-lg font-semibold break-words">{detail.nome}</h3><p className="text-sm text-ink-muted">{labelDate(detail.data)}{detail.horaInicio ? ` · ${detail.horaInicio}${detail.horaFim ? `–${detail.horaFim}` : ''}` : ''}</p><p className={`mt-2 text-sm ${statusColor[detail.status]}`}>{estados[detail.status]}</p>{detail.local && <p className="text-sm">{detail.local}</p>}</div>
        {error && <div role="alert" className="alert-error">{error}</div>}
        {detail.bloqueio && <p className="text-sm text-ink-muted">{detail.bloqueio}</p>}
        {detail.status === 'CANCELADA' ? <div className="grid gap-2"><button type="button" className="touch-btn-primary min-h-12" disabled={detail.podeRestaurar === false || mutation.isPending} onClick={() => restore(detail)}>Restaurar agendamento</button>{detail.bloqueioRestauracao && <p className="text-sm text-ink-muted">{detail.bloqueioRestauracao}</p>}</div> : <div className="grid gap-2"><button type="button" className="touch-btn-primary" disabled={!detail.podeEditar || mutation.isPending} onClick={() => openDraft({ nome: detail.nome, data: detail.data, horaInicio: detail.horaInicio ?? '', horaFim: detail.horaFim ?? '', local: detail.local ?? '', ocorrenciaId: detail.id })}>Editar</button><button type="button" className="touch-btn-secondary text-danger" disabled={!detail.podeCancelar || mutation.isPending} onClick={() => cancel(detail)}>{detail.agendaId ? 'Cancelar este agendamento' : 'Cancelar agendamento'}</button></div>}
        {detailRule && <div className="space-y-2 border-t border-line pt-3"><p className="text-sm text-ink-muted">Repetição: {detailRule.nome} · {detailRule.ativa ? 'Ativa' : 'Inativa'}. Interromper impede novas datas e mantém os agendamentos existentes.</p><button type="button" className="touch-btn-secondary w-full" disabled={mutation.isPending} onClick={() => openRule(detailRule)}>Editar repetição</button>{detailRule.ativa && <button type="button" className="touch-btn-secondary w-full text-danger" disabled={mutation.isPending} onClick={() => stop(detailRule.id)}>Interromper a repetição</button>}</div>}
      </div>}
    </Modal>
    <Modal open={Boolean(restoreDraft) && !confirmation} title="Restaurar agendamento" onClose={closeRestoreDraft} hideHeaderClose={mutation.isPending} closeOnBackdrop={!mutation.isPending} footer={<div className="grid grid-cols-2 gap-2"><button type="button" className="touch-btn-orange min-h-12" disabled={mutation.isPending} onClick={closeRestoreDraft}>Voltar</button><button type="submit" form="restore-agendamento-form" className="touch-btn-primary min-h-12" disabled={mutation.isPending}>{mutation.isPending ? 'Restaurando…' : 'Restaurar agendamento'}</button></div>}>
      {restoreDraft && <form id="restore-agendamento-form" className="space-y-4 pb-2" onSubmit={(event) => { event.preventDefault(); write(`/api/operacao/agenda/ocorrencias/${encodeURIComponent(restoreDraft.item.id)}/restaurar`, { requestId: restoreDraft.requestId, data: restoreDraft.data, horaInicio: restoreDraft.horaInicio, horaFim: restoreDraft.horaFim }, restoreDraft.item); }}>
        <p className="text-sm text-ink-muted">A restauração altera o mesmo registro para Programada. Caixa, comandas, pagamentos e estoque não serão alterados.</p>
        {error && <div role="alert" className="alert-error">{error}</div>}
        <label className="block text-sm">Data<input type="date" className="input mt-1 min-h-11 w-full" required disabled={mutation.isPending} value={restoreDraft.data} onChange={(event) => setRestoreDraft({ ...restoreDraft, data: event.target.value })} /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm">Horário de início<input type="time" className="input mt-1 min-h-11 w-full" required disabled={mutation.isPending} value={restoreDraft.horaInicio} onChange={(event) => setRestoreDraft({ ...restoreDraft, horaInicio: event.target.value })} /></label><label className="block text-sm">Horário de término<input type="time" className="input mt-1 min-h-11 w-full" required disabled={mutation.isPending} value={restoreDraft.horaFim} onChange={(event) => setRestoreDraft({ ...restoreDraft, horaFim: event.target.value })} /></label></div>
      </form>}
    </Modal>
    <Modal open={Boolean(draft) && !confirmation} title={draft?.agendaId ? 'Editar repetição' : draft?.ocorrenciaId ? 'Editar agendamento' : 'Novo agendamento'} onClose={closeDraft} hideHeaderClose={mutation.isPending} closeOnBackdrop={!mutation.isPending} footer={<div className="grid grid-cols-2 gap-2"><button type="button" className="touch-btn-orange" disabled={mutation.isPending} onClick={closeDraft}>Voltar</button><button type="submit" form="agendamento-form" className="touch-btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Salvando…' : 'Salvar'}</button></div>}>
      {draft && <form id="agendamento-form" className="space-y-4 pb-2" onSubmit={(event) => { event.preventDefault(); const body: Record<string, unknown> = { ...draft, horaFim: draft.horaFim || null, local: draft.local || null, ...(draft.repetirSemanalmente ? {} : { fim: undefined }) }; if (preserveIncompleteLegacyTime) { delete body.horaInicio; delete body.horaFim; } write('/api/operacao/agenda/agendamentos', body); }}>
        {error && <div role="alert" className="alert-error">{error}</div>}
        <label className="block text-sm">Nome<input className="input mt-1 min-h-11 w-full" value={draft.nome} maxLength={120} required disabled={mutation.isPending} onChange={(event) => setDraft({ ...draft, nome: event.target.value })} /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block min-w-0 text-sm">{draft.repetirSemanalmente ? 'Primeira data' : 'Data'}<input type="date" className="input mt-1 min-h-11 w-full" value={draft.data} required disabled={mutation.isPending} onChange={(event) => setDraft({ ...draft, data: event.target.value })} /></label><label className="block min-w-0 text-sm">Horário de início<input type="time" className="input mt-1 min-h-11 w-full" value={draft.horaInicio} required={!preserveIncompleteLegacyTime} disabled={mutation.isPending} onChange={(event) => setDraft({ ...draft, horaInicio: event.target.value })} /></label><label className="block min-w-0 text-sm">Horário de término<input type="time" className="input mt-1 min-h-11 w-full" value={draft.horaFim} required={!preserveIncompleteLegacyTime} disabled={mutation.isPending} onChange={(event) => setDraft({ ...draft, horaFim: event.target.value })} /></label><label className="block text-sm">Local (opcional)<input className="input mt-1 min-h-11 w-full" value={draft.local} maxLength={160} disabled={mutation.isPending} onChange={(event) => setDraft({ ...draft, local: event.target.value })} /></label></div>
        {!draft.ocorrenciaId && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={draft.repetirSemanalmente} disabled={Boolean(draft.agendaId) || mutation.isPending} onChange={(event) => setDraft({ ...draft, repetirSemanalmente: event.target.checked })} />Repetir semanalmente</label>}
        {draft.repetirSemanalmente && <div className="space-y-3 rounded-xl border border-line p-3"><p className="text-sm text-ink-muted">Repetição semanal: {dias[localDate(draft.data).getDay()]} · {draft.horaInicio}.</p><label className="block text-sm">Última data da repetição<input type="date" className="input mt-1 min-h-11 w-full" value={draft.fim} min={draft.data} required disabled={mutation.isPending} onChange={(event) => setDraft({ ...draft, fim: event.target.value })} /></label>{rule && <><p className="text-sm text-ink-muted">Alterações na regra serão usadas somente em novas datas. Os agendamentos existentes serão preservados.</p>{rule.ativa ? <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={draft.gerarDatas} disabled={mutation.isPending} onChange={(event) => setDraft({ ...draft, gerarDatas: event.target.checked })} />Agendar datas neste período</label> : <p className="text-sm text-ink-muted">Repetição inativa: serão salvos somente os dados da regra. Nenhuma nova data será agendada.</p>}</>}</div>}
      </form>}
    </Modal>
    <Modal open={Boolean(confirmation)} title={confirmation?.kind === 'discard' ? 'Descartar alterações?' : confirmation?.kind === 'cancel' ? 'Cancelar agendamento?' : confirmation?.kind === 'restore' ? 'Restaurar agendamento?' : confirmation?.kind === 'stop' ? 'Interromper repetição?' : 'Remover repetição da lista?'} onClose={refuseConfirmation} hideHeaderClose footer={<div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><button type="button" className="touch-btn-orange min-h-12" onClick={refuseConfirmation}>{confirmation?.kind === 'discard' ? 'Continuar editando' : 'Voltar'}</button><button type="button" className={confirmation?.kind === 'archive' || confirmation?.kind === 'restore' ? 'touch-btn-primary min-h-12' : 'touch-btn-danger min-h-12'} onClick={acceptConfirmation}>{confirmation?.kind === 'discard' ? 'Descartar' : confirmation?.kind === 'cancel' ? 'Cancelar agendamento' : confirmation?.kind === 'restore' ? 'Restaurar agendamento' : confirmation?.kind === 'stop' ? 'Interromper repetição' : 'Remover da lista'}</button></div>}>
      <p className="pb-3 text-sm leading-relaxed text-ink-muted">{confirmation?.kind === 'discard' ? 'As alterações ainda não salvas serão descartadas. Nenhum agendamento será enviado.' : confirmation?.kind === 'cancel' ? 'Somente este agendamento será cancelado. O registro e a auditoria serão preservados; a repetição não será interrompida.' : confirmation?.kind === 'restore' ? 'O mesmo registro voltará a Programada após uma nova validação de horário. A regra semanal, comandas, pagamentos, caixa e estoque não serão alterados.' : confirmation?.kind === 'stop' ? 'Novas datas não poderão ser geradas. As datas já existentes, comandas e caixa serão mantidos.' : 'A regra será arquivada e poderá ser consultada em Ver arquivadas. Seu estado ativo/inativo será preservado. Nenhuma nova data será gerada; datas existentes, comandas, caixa, estoque e auditoria serão mantidos.'}</p>
    </Modal>
  </section>;
}
