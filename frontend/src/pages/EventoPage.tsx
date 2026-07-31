import { useState, useEffect } from 'react';

import { useNavigate, Link } from 'react-router-dom';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api, formatTime, ApiError } from '../lib/api';

import type { Evento, EventosResponse, Trailer } from '../types';
import { formatTrailerLabel } from '../types';

import { useEvento } from '../contexts/EventoContext';

import { Loading } from '../components/Loading';

import { Modal } from '../components/Modal';
import { ModalFormFooter } from '../components/ModalFormFooter';

import { AgendaWeekStrip } from '../components/AgendaWeekStrip';

import { ReabrirEventoButton } from '../components/ReabrirEventoButton';

import { ExcluirEventoButton, canExcluirEvento } from '../components/ExcluirEventoButton';
import { ReverterEventoButton } from '../components/ReverterEventoButton';

import { reabrirPrazoExpirado } from '../lib/evento-utils';

import { VerRankingButton } from '../components/VerRankingButton';
import { PortalQrButton } from '../components/PortalQrButton';

import { VerResumoExecutivoButton } from '../components/VerResumoExecutivoButton';

import { EventoResumoKpis } from '../components/EventoResumoKpis';

import { EditarCardapioEventoButton } from '../components/EditarCardapioEventoButton';

import {
  EventoCardapioFormFields,
  defaultEventoCardapioForm,
  buildCardapioCreatePayload,
  type EventoCardapioFormState,
} from '../components/EventoCardapioFormFields';

import { IconPlus } from '../components/NavIcons';

import { useAuth } from '../contexts/AuthContext';

import { getSocket } from '../lib/socket';

import {

  EventoFormFields,

  buildUpdatePayload,

  defaultEventoForm,

  eventoToForm,

  isSerieEvento,

  todayString,

  type EventoFormState,

} from '../components/EventoFormFields';

import {

  buildAgendaDays,

  findOpenSessoesOnDate,

  getAgendaDayForDate,

  formatAgendaHeading,

  formatAgendaDateShort,

  isAgendaEmpty,

  type AgendaDay,

  type AgendaItem,

} from '../lib/evento-agenda';

import { StatusBadge, eventoStatusVariant } from '../components/StatusBadge';



const DIAS_RECORRENCIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;

const WEEKS_FUTURE = 12;

const EVENTO_PENDENTE_ENCERRAMENTO_MSG =
  'Existem eventos pendentes de encerramento. Finalize-os para iniciar um novo evento.';

function isEventoPendenteEncerramentoError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  const msg = err.message;
  return (
    msg === 'Já existe uma sessão nesta data para esta agenda.' ||
    msg.startsWith('Este trailer já possui o evento')
  );
}



function formatTimeRange(evento: Pick<Evento, 'horaInicio' | 'horaFim'>) {

  const start = formatTime(evento.horaInicio);

  const end = evento.horaFim ? formatTime(evento.horaFim) : null;

  return end ? `${start} - ${end}` : start;

}



function formatEventoMeta(evento: Pick<Evento, 'horaInicio' | 'horaFim' | 'local'>) {

  return `${formatTimeRange(evento)} • ${evento.local}`;

}



function formatTodaySectionLabel(dateKey: string) {

  const d = new Date(`${dateKey}T12:00:00`);

  const day = d.getDate();

  const month = d.toLocaleDateString('pt-BR', { month: 'long' });

  return `Hoje, ${day} de ${month.charAt(0).toUpperCase()}${month.slice(1)}`;

}



function EditEventoButton({
  onClick,
  className,
  primary = false,
  orange = false,
}: {
  onClick: () => void;
  className?: string;
  primary?: boolean;
  orange?: boolean;
}) {

  const variant = orange
    ? 'touch-btn-orange touch-btn-sm px-4'
    : primary
      ? 'touch-btn-primary touch-btn-sm px-4'
      : 'btn-outline-light touch-btn-sm';

  return (

    <button

      type="button"

      className={`${variant} ${className ?? ''}`}

      onClick={onClick}

    >

      Editar

    </button>

  );

}



function ActiveSessionHero({

  evento,

  onComandas,

}: {

  evento: Evento;

  onComandas: () => void;

}) {

  return (

    <div className="card-hero space-y-4">

      <div className="flex items-start justify-between gap-3">

        <div className="min-w-0 flex-1">

          <p className="event-hero-live-label">Ao vivo agora</p>

          <h2 className="text-xl font-bold mt-1.5 leading-tight">{evento.nome}</h2>

          <p className="text-sm text-white/75 mt-1.5">{formatEventoMeta(evento)}</p>

          {evento.trailer && (
            <p className="text-xs text-white/60 mt-1">{formatTrailerLabel(evento.trailer)}</p>
          )}

        </div>

        <StatusBadge variant="live" />

      </div>

      <EventoResumoKpis eventoId={evento.id} variant="hero" liveUpdates />

      <div className="flex gap-2">

        <button
          type="button"
          className="touch-btn-orange flex flex-1 min-w-0 items-center justify-center min-h-12 rounded-xl font-bold"
          onClick={onComandas}
        >
          Comandas
        </button>

        <EditarCardapioEventoButton eventoId={evento.id} eventoAberto iconOnly />

        <PortalQrButton
          trailerId={evento.trailerId}
          trailer={evento.trailer}
          iconOnly
          variant="hero"
        />

        <VerRankingButton eventoId={evento.id} iconOnly />

      </div>

      {evento.status === 'ABERTO' && (
        <ReverterEventoButton
          eventoId={evento.id}
          eventoNome={evento.nome}
          isSessaoSerie={!!evento.serieId}
          compact
          className="w-full"
        />
      )}

    </div>

  );

}



function AgendaSerieCard({
  serie,
  dateKey,
  isToday,
  pending,
  cancelPending,
  onIniciar,
  onEdit,
  onCancel,
  onRemove,
}: {
  serie: Evento;
  dateKey: string;
  isToday: boolean;
  pending: boolean;
  cancelPending: boolean;
  onIniciar: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {

  const diaLabel =

    serie.diaSemana != null ? `Toda ${DIAS_RECORRENCIA[serie.diaSemana]}` : 'Agenda fixa';



  return (

    <div className="card space-y-3">

      <div className="flex items-start justify-between gap-3">

        <div className="min-w-0">

          <p className="text-sm font-semibold text-purple capitalize">{diaLabel}</p>

          <p className="text-sm text-ink-muted mt-0.5">{formatAgendaDateShort(dateKey)}</p>

          <p className="font-bold text-lg leading-tight mt-0.5">{serie.nome}</p>

          <p className="text-sm text-ink-muted mt-1">{formatEventoMeta(serie)}</p>

        </div>

        <StatusBadge variant="series" />

      </div>

      <div className="space-y-2 pt-1">
        {isToday && (
          <button
            type="button"
            className="touch-btn-primary w-full disabled:opacity-40"
            disabled={pending || cancelPending}
            onClick={onIniciar}
          >
            {pending ? 'Iniciando…' : 'Iniciar sessão'}
          </button>
        )}

        <div className="grid grid-cols-2 gap-2">
          <EditEventoButton onClick={onEdit} orange className="w-full min-h-[3rem]" />
          <Link
            to={`/ranking/serie/${serie.id}`}
            className="touch-btn-secondary touch-btn-sm w-full inline-flex items-center justify-center min-h-[3rem]"
          >
            <span className="sm:hidden">Ranking</span>
            <span className="hidden sm:inline">Ranking da agenda</span>
          </Link>
        </div>

        <button
          type="button"
          className="touch-btn-danger w-full disabled:opacity-40"
          disabled={cancelPending || pending}
          onClick={onCancel}
        >
          {cancelPending ? 'Cancelando…' : 'Cancelar dia'}
        </button>

        {onRemove && (
          <button
            type="button"
            className="touch-btn-secondary w-full text-danger border-danger/20 active:bg-danger-soft"
            onClick={onRemove}
          >
            Remover
          </button>
        )}
      </div>

    </div>

  );

}



function AgendaSessaoCard({
  sessao,
  isDono,
  onRetomar,
  onEdit,
}: {
  sessao: Evento;
  isDono: boolean;
  onRetomar: () => void;
  onEdit: () => void;
}) {

  return (
    <div className="card space-y-3">

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-lg leading-tight">{sessao.nome}</p>
          <p className="text-sm text-ink-muted mt-1">{formatEventoMeta(sessao)}</p>
          {sessao.trailer && (
            <p className="text-xs text-ink-faint mt-1">{formatTrailerLabel(sessao.trailer)}</p>
          )}
          {sessao.serieId && (
            <p className="text-xs text-ink-faint mt-1">Sessão de agenda fixa</p>
          )}
        </div>
        <StatusBadge variant={eventoStatusVariant(sessao.status)} />
      </div>

      <EventoResumoKpis
        eventoId={sessao.id}
        variant="card"
        liveUpdates={sessao.status === 'ABERTO'}
      />

      {sessao.status === 'ABERTO' && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="touch-btn-orange flex-1 min-w-[10rem]" onClick={onRetomar}>
              Comandas
            </button>
            <VerRankingButton eventoId={sessao.id} fullWidth={false} />
          </div>
          <EditEventoButton onClick={onEdit} className="w-full" />
          <ReverterEventoButton
            eventoId={sessao.id}
            eventoNome={sessao.nome}
            isSessaoSerie={!!sessao.serieId}
          />
        </div>
      )}

      {sessao.status === 'FECHADO' && (

        <div className="space-y-2">

          <ReabrirEventoButton eventoId={sessao.id} encerradoEm={sessao.encerradoEm} />

          <VerRankingButton eventoId={sessao.id} primary />

          {reabrirPrazoExpirado(sessao.encerradoEm) && (
            <p className="text-xs text-ink-faint">
              Prazo para reabrir expirou (30 min após encerramento).
            </p>
          )}

          {isDono && <VerResumoExecutivoButton eventoId={sessao.id} />}

          <EditEventoButton onClick={onEdit} className="w-full" />

          {canExcluirEvento(sessao) && (
            <ExcluirEventoButton eventoId={sessao.id} eventoNome={sessao.nome} />
          )}

        </div>

      )}

    </div>

  );

}



function AgendaItemRow({
  item,
  day,
  isDono,
  iniciarPending,
  cancelPendingSerieId,
  cancelPendingDateKey,
  onIniciarSerie,
  onCancelAgendamento,
  onRetomar,
  onEdit,
  onRemoveSerie,
}: {
  item: AgendaItem;
  day: AgendaDay;
  isDono: boolean;
  iniciarPending: boolean;
  cancelPendingSerieId?: string;
  cancelPendingDateKey?: string;
  onIniciarSerie: (serieId: string) => void;
  onCancelAgendamento: (serie: Evento, dateKey: string) => void;
  onRetomar: (sessao: Evento) => void;
  onEdit: (evento: Evento) => void;
  onRemoveSerie?: (serie: Evento) => void;
}) {
  if (item.kind === 'serie') {
    const cancelPending =
      cancelPendingSerieId === item.serie.id && cancelPendingDateKey === item.dateKey;
    return (
      <AgendaSerieCard
        serie={item.serie}
        dateKey={item.dateKey}
        isToday={day.isToday}
        pending={iniciarPending}
        cancelPending={cancelPending}
        onIniciar={() => onIniciarSerie(item.serie.id)}
        onEdit={() => onEdit(item.serie)}
        onCancel={() => onCancelAgendamento(item.serie, item.dateKey)}
        onRemove={onRemoveSerie ? () => onRemoveSerie(item.serie) : undefined}
      />
    );
  }

  return (
    <AgendaSessaoCard
      sessao={item.sessao}
      isDono={isDono}
      onRetomar={() => onRetomar(item.sessao)}
      onEdit={() => onEdit(item.sessao)}
    />
  );
}



export function EventoPage() {

  const navigate = useNavigate();

  const queryClient = useQueryClient();

  const { evento, setEvento, setTrailer, trailerId } = useEvento();

  const { isDono } = useAuth();

  const [showNew, setShowNew] = useState(false);

  const [editingEvento, setEditingEvento] = useState<Evento | null>(null);

  const [form, setForm] = useState<EventoFormState>(() => defaultEventoForm());

  const [cardapioForm, setCardapioForm] = useState<EventoCardapioFormState>(() => defaultEventoCardapioForm());

  const [selectedDateKey, setSelectedDateKey] = useState(() => todayString());

  const [error, setError] = useState('');

  const [showPendingEventModal, setShowPendingEventModal] = useState(false);

  const [cancelAgendamentoTarget, setCancelAgendamentoTarget] = useState<{
    serie: Evento;
    dateKey: string;
  } | null>(null);

  const handleAgendaError = (err: unknown, fallback: string) => {
    if (isEventoPendenteEncerramentoError(err)) {
      setError('');
      setShowPendingEventModal(true);
      return;
    }
    setError(err instanceof ApiError ? err.message : fallback);
  };

  const { data, isLoading } = useQuery({

    queryKey: ['eventos'],

    queryFn: () => api.get<EventosResponse>('/api/eventos'),

  });

  const { data: trailers } = useQuery({

    queryKey: ['trailers'],

    queryFn: () => api.get<Trailer[]>('/api/trailers?ativo=true'),

  });

  const defaultTrailerId = trailerId ?? trailers?.[0]?.id ?? '';

  useEffect(() => {
    if (defaultTrailerId && !form.trailerId && showNew) {
      setForm((prev) => ({ ...prev, trailerId: defaultTrailerId }));
    }
  }, [defaultTrailerId, form.trailerId, showNew]);

  useEffect(() => {
    const socket = getSocket();
    const refreshAgenda = () => {
      queryClient.invalidateQueries({ queryKey: ['eventos'] });
    };
    socket.on('evento:updated', refreshAgenda);
    socket.on('evento:deleted', refreshAgenda);
    return () => {
      socket.off('evento:updated', refreshAgenda);
      socket.off('evento:deleted', refreshAgenda);
    };
  }, [queryClient]);



  const createMutation = useMutation({

    mutationFn: (payload: { evento: EventoFormState; cardapio: EventoCardapioFormState }) =>

      api.post<Evento>('/api/eventos', {

        nome: payload.evento.nome,

        local: payload.evento.local,

        horaInicio: payload.evento.horaInicio,

        horaFim: payload.evento.horaFim || undefined,

        recorrencia: payload.evento.recorrencia,

        data: payload.evento.recorrencia === 'NENHUMA' ? payload.evento.data : undefined,

        diaSemana: payload.evento.recorrencia === 'SEMANAL' ? payload.evento.diaSemana : undefined,

        abrirAgora: payload.evento.recorrencia === 'NENHUMA',

        trailerId: payload.evento.trailerId,

        ...buildCardapioCreatePayload(payload.cardapio),

      }),

    onSuccess: (created) => {

      queryClient.invalidateQueries({ queryKey: ['eventos'] });

      setShowNew(false);

      setForm(defaultEventoForm(defaultTrailerId));

      setCardapioForm(defaultEventoCardapioForm());

      setError('');

      if (created.recorrencia === 'NENHUMA' && created.status === 'ABERTO') {

        setEvento(created);

        navigate('/comandas');

      }

    },

    onError: (err) => handleAgendaError(err, 'Erro ao criar'),

  });



  const iniciarMutation = useMutation({

    mutationFn: (serieId: string) => api.post<Evento>(`/api/eventos/${serieId}/iniciar`),

    onSuccess: (sessao) => {

      queryClient.invalidateQueries({ queryKey: ['eventos'] });

      setEvento(sessao);

      navigate('/comandas');

    },

    onError: (err) => handleAgendaError(err, 'Erro ao iniciar sessão'),

  });



  const updateMutation = useMutation({

    mutationFn: ({ id, payload }: { id: string; payload: ReturnType<typeof buildUpdatePayload> }) =>

      api.patch<Evento>(`/api/eventos/${id}`, payload),

    onSuccess: (updated) => {

      queryClient.invalidateQueries({ queryKey: ['eventos'] });

      setEditingEvento(null);

      setError('');

      if (evento?.id === updated.id) {

        setEvento(updated);

      }

    },

    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao salvar'),

  });



  const deleteSerieMutation = useMutation({

    mutationFn: (id: string) => api.delete(`/api/eventos/${id}`),

    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['eventos'] }),

    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao remover agenda'),

  });

  const [cancelPending, setCancelPending] = useState<{ serieId: string; dateKey: string } | null>(null);

  const cancelAgendamentoMutation = useMutation({

    mutationFn: ({ serieId, data }: { serieId: string; data: string }) =>
      api.post<{ serieId: string; data: string }>(`/api/eventos/${serieId}/cancelar-agendamento`, { data }),

    onMutate: ({ serieId, data }) => setCancelPending({ serieId, dateKey: data }),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eventos'] });
      setError('');
      setCancelAgendamentoTarget(null);
    },

    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao cancelar agendamento'),

    onSettled: () => setCancelPending(null),

  });



  const openEdit = (target: Evento) => {

    setEditingEvento(target);

    setForm(eventoToForm(target));

    setError('');

  };



  const openNew = () => {
    setForm({ ...defaultEventoForm(defaultTrailerId), data: selectedDateKey });
    setCardapioForm(defaultEventoCardapioForm());
    setError('');
    setShowNew(true);
  };

  const confirmRemoveSerie = (s: Evento) => {

    if (confirm(`Remover agenda "${s.nome}"?`)) {

      deleteSerieMutation.mutate(s.id);

    }

  };

  const openCancelAgendamentoModal = (serie: Evento, dateKey: string) => {
    setCancelAgendamentoTarget({ serie, dateKey });
  };



  const retomarSessao = (e: Evento) => {
    setTrailer(e.trailerId);
    navigate('/comandas');
  };



  if (isLoading) return <Loading />;

  const series = data?.series ?? [];

  const sessoes = data?.sessoes ?? [];

  const agendamentoExclusoes = data?.agendamentoExclusoes ?? [];

  const filterByTrailer = (items: Evento[]) => {
    if (isDono || !trailerId) return items;
    return items.filter((item) => item.trailerId === trailerId);
  };

  const seriesFiltered = filterByTrailer(series);
  const sessoesFiltered = filterByTrailer(sessoes);

  const todayKey = todayString();

  const isSelectedToday = selectedDateKey === todayKey;

  const openSessoesToday = findOpenSessoesOnDate(sessoesFiltered, todayKey);

  const excludedSessaoIds = isSelectedToday ? openSessoesToday.map((s) => s.id) : [];

  const agendaDays = buildAgendaDays(
    seriesFiltered,
    sessoesFiltered,
    excludedSessaoIds,
    WEEKS_FUTURE * 7 + 7,
    agendamentoExclusoes,
  );

  const empty = isAgendaEmpty(seriesFiltered, sessoesFiltered);

  const canRemoveSerie = (s: Evento) => !s._count?.ocorrencias || s._count.ocorrencias === 0;

  const selectedDay =
    agendaDays.find((d) => d.dateKey === selectedDateKey) ??
    getAgendaDayForDate(
      selectedDateKey,
      seriesFiltered,
      sessoesFiltered,
      excludedSessaoIds,
      agendamentoExclusoes,
    );

  const selectedSectionLabel = isSelectedToday

    ? formatTodaySectionLabel(selectedDateKey)

    : formatAgendaHeading(selectedDateKey);

  const upcomingDays = agendaDays.filter((d) => !d.isToday && !d.isPast);

  const hasUpcoming = upcomingDays.some((d) => d.items.length > 0);



  return (

    <div className="space-y-6 pb-20">

      {error && !showNew && !editingEvento && <div className="alert-error">{error}</div>}



      {empty && (

        <div className="card text-center py-12 sm:py-16 space-y-4">

          <p className="text-5xl">📅</p>

          <p className="text-lg text-ink-soft font-medium">Agenda vazia</p>

          <p className="text-sm text-ink-faint max-w-sm mx-auto">

            Cadastre uma agenda fixa (ex: toda sexta no condomínio) ou um evento avulso com data e horário

          </p>

          <button type="button" className="touch-btn-primary w-full max-w-sm mx-auto min-h-14" onClick={openNew}>

            + Cadastrar compromisso

          </button>

        </div>

      )}



      {!empty && (

        <>

          {isSelectedToday && openSessoesToday.length > 0 && (
            <div className="space-y-3">
              {openSessoesToday.map((sessao) => (
                <ActiveSessionHero
                  key={sessao.id}
                  evento={sessao}
                  onComandas={() => {
                    setTrailer(sessao.trailerId);
                    navigate('/comandas');
                  }}
                />
              ))}
            </div>
          )}



          <AgendaWeekStrip selectedDateKey={selectedDateKey} onSelectDate={setSelectedDateKey} />

          <button
            type="button"
            className="touch-btn-orange w-full min-h-12 flex items-center justify-center gap-2"
            onClick={openNew}
          >
            <IconPlus />
            Novo compromisso
          </button>

          <section className="space-y-3">

            <h2 className="text-base font-bold text-ink">{selectedSectionLabel}</h2>



            {(!selectedDay || selectedDay.items.length === 0) &&
              !(isSelectedToday && openSessoesToday.length > 0) && (

              <p className="text-sm text-ink-faint text-center py-3">Sem compromissos nesta data</p>

            )}



            {isSelectedToday && openSessoesToday.length > 0 && selectedDay && selectedDay.items.length === 0 && (

              <p className="text-sm text-ink-faint text-center py-3">Nenhum outro evento agendado para hoje</p>

            )}



            {selectedDay && selectedDay.items.length > 0 && (

              <div className="grid gap-3">

                {selectedDay.items.map((item) => (

                  <AgendaItemRow

                    key={item.kind === 'serie' ? `serie-${item.serie.id}-${selectedDay.dateKey}` : item.sessao.id}

                    item={item}

                    day={selectedDay}

                    isDono={isDono}

                    iniciarPending={iniciarMutation.isPending}

                    cancelPendingSerieId={cancelPending?.serieId}

                    cancelPendingDateKey={cancelPending?.dateKey}

                    onIniciarSerie={(id) => iniciarMutation.mutate(id)}

                    onCancelAgendamento={openCancelAgendamentoModal}

                    onRetomar={retomarSessao}

                    onEdit={openEdit}

                    onRemoveSerie={

                      item.kind === 'serie' && canRemoveSerie(item.serie) ? confirmRemoveSerie : undefined

                    }

                  />

                ))}

              </div>

            )}



          </section>



          {hasUpcoming && isSelectedToday && (

            <section className="space-y-3">

              <h2 className="text-base font-bold text-ink">Próximos eventos</h2>

              <div className="grid gap-3">

                {upcomingDays.flatMap((day) =>

                  day.items.map((item) => (

                    <AgendaItemRow

                      key={item.kind === 'serie' ? `serie-${item.serie.id}-${day.dateKey}` : item.sessao.id}

                      item={item}

                      day={day}

                      isDono={isDono}

                      iniciarPending={iniciarMutation.isPending}

                      cancelPendingSerieId={cancelPending?.serieId}

                      cancelPendingDateKey={cancelPending?.dateKey}

                      onIniciarSerie={(id) => iniciarMutation.mutate(id)}

                      onCancelAgendamento={openCancelAgendamentoModal}

                      onRetomar={retomarSessao}

                      onEdit={openEdit}

                      onRemoveSerie={

                        item.kind === 'serie' && canRemoveSerie(item.serie) ? confirmRemoveSerie : undefined

                      }

                    />

                  )),

                )}

              </div>

            </section>

          )}

        </>

      )}



      <Modal open={showNew} onClose={() => setShowNew(false)} title="Novo compromisso">

        <form

          onSubmit={(e) => {

            e.preventDefault();

            if (cardapioForm.cardapioModo === 'salvo' && !cardapioForm.cardapioId) {
              setError('Selecione um cardápio salvo ou escolha outra opção.');
              return;
            }

            createMutation.mutate({ evento: form, cardapio: cardapioForm });

          }}

          className="space-y-4"

        >

          {error && <div className="alert-error">{error}</div>}

          <EventoFormFields form={form} setForm={setForm} trailers={trailers ?? []} />

          <EventoCardapioFormFields form={cardapioForm} setForm={setCardapioForm} />

          <button
            type="submit"
            className="touch-btn-primary w-full min-h-14"
            disabled={
              createMutation.isPending ||
              !form.trailerId ||
              (cardapioForm.cardapioModo === 'salvo' && !cardapioForm.cardapioId)
            }
          >

            {createMutation.isPending

              ? 'Salvando...'

              : form.recorrencia === 'SEMANAL'

                ? 'Salvar agenda fixa'

                : 'Criar e abrir evento'}

          </button>

        </form>

      </Modal>



      <Modal

        open={!!editingEvento}

        onClose={() => {

          setEditingEvento(null);

          setError('');

        }}

        title={editingEvento && isSerieEvento(editingEvento) ? 'Editar agenda fixa' : 'Editar evento'}

      >

        {editingEvento && (

          <form

            onSubmit={(e) => {

              e.preventDefault();

              updateMutation.mutate({

                id: editingEvento.id,

                payload: buildUpdatePayload(form, editingEvento),

              });

            }}

            className="space-y-4"

          >

            {error && <div className="alert-error">{error}</div>}

            <EventoFormFields form={form} setForm={setForm} allowRecorrenciaChange={false} showTrailer={false} />

            <ModalFormFooter
              onCancel={() => {
                setEditingEvento(null);
                setError('');
              }}
              submitLabel="Salvar alterações"
              pending={updateMutation.isPending}
            />

          </form>

        )}

      </Modal>

      <Modal
        open={!!cancelAgendamentoTarget}
        onClose={() => !cancelAgendamentoMutation.isPending && setCancelAgendamentoTarget(null)}
        title="Cancelar agendamento?"
        footer={
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              className="touch-btn-primary w-full min-h-14"
              disabled={cancelAgendamentoMutation.isPending}
              onClick={() => setCancelAgendamentoTarget(null)}
            >
              Voltar
            </button>
            <button
              type="button"
              className="touch-btn-danger w-full min-h-14"
              disabled={cancelAgendamentoMutation.isPending}
              onClick={() => {
                if (!cancelAgendamentoTarget) return;
                cancelAgendamentoMutation.mutate({
                  serieId: cancelAgendamentoTarget.serie.id,
                  data: cancelAgendamentoTarget.dateKey,
                });
              }}
            >
              {cancelAgendamentoMutation.isPending ? 'Cancelando…' : 'Cancelar dia'}
            </button>
          </div>
        }
      >
        {cancelAgendamentoTarget && (
          <p className="text-ink-soft leading-relaxed">
            Deseja cancelar o agendamento de &ldquo;{cancelAgendamentoTarget.serie.nome}&rdquo; em{' '}
            {formatAgendaDateShort(cancelAgendamentoTarget.dateKey)}?
          </p>
        )}
      </Modal>

      <Modal
        open={showPendingEventModal}
        onClose={() => setShowPendingEventModal(false)}
        title="Não foi possível iniciar"
        footer={
          <button
            type="button"
            className="touch-btn-primary w-full min-h-14"
            onClick={() => setShowPendingEventModal(false)}
          >
            Fechar
          </button>
        }
      >
        <p className="text-ink-soft leading-relaxed">{EVENTO_PENDENTE_ENCERRAMENTO_MSG}</p>
      </Modal>

    </div>

  );

}

