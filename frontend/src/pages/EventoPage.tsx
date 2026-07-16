import { useState, useEffect } from 'react';

import { useNavigate } from 'react-router-dom';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api, formatTime, formatCurrency, ApiError } from '../lib/api';

import type { Evento, EventoDashboard, EventosResponse, Trailer } from '../types';
import { formatTrailerLabel } from '../types';

import { useEvento } from '../contexts/EventoContext';

import { Loading } from '../components/Loading';

import { Modal } from '../components/Modal';

import { AgendaWeekStrip } from '../components/AgendaWeekStrip';

import { ReabrirEventoButton } from '../components/ReabrirEventoButton';

import { ExcluirEventoButton, canExcluirEvento } from '../components/ExcluirEventoButton';

import { reabrirPrazoExpirado } from '../lib/evento-utils';

import { VerRankingButton } from '../components/VerRankingButton';

import { VerResumoExecutivoButton } from '../components/VerResumoExecutivoButton';

import { EventoMontagemTaps } from '../components/EventoMontagemTaps';

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

  isAgendaEmpty,

  type AgendaDay,

  type AgendaItem,

} from '../lib/evento-agenda';

import { StatusBadge, eventoStatusVariant } from '../components/StatusBadge';



const DIAS_RECORRENCIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;

const WEEKS_FUTURE = 12;



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



function EditEventoButton({ onClick, className }: { onClick: () => void; className?: string }) {

  return (

    <button

      type="button"

      className={`btn-outline-light touch-btn-sm ${className ?? ''}`}

      onClick={onClick}

    >

      Editar

    </button>

  );

}



function HeroStatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/15 border border-white/20 px-3 py-2.5 min-w-0">
      <p className="text-[11px] text-white/70 leading-tight">{label}</p>
      <p className="text-lg font-bold mt-1 truncate">{value}</p>
    </div>
  );
}

function EventoHeroResumo({ eventoId }: { eventoId: string }) {
  const queryClient = useQueryClient();

  const { data: dashboard } = useQuery({
    queryKey: ['dashboard', eventoId],
    queryFn: () => api.get<EventoDashboard>(`/api/eventos/${eventoId}/dashboard`),
  });

  useEffect(() => {
    const socket = getSocket();
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', eventoId] });
    };
    socket.on('comanda:created', invalidate);
    socket.on('comanda:closed', invalidate);
    socket.on('item:added', invalidate);
    socket.on('item:removed', invalidate);
    socket.on('pedido:confirmed', invalidate);
    return () => {
      socket.off('comanda:created', invalidate);
      socket.off('comanda:closed', invalidate);
      socket.off('item:added', invalidate);
      socket.off('item:removed', invalidate);
      socket.off('pedido:confirmed', invalidate);
    };
  }, [eventoId, queryClient]);

  const resumo = dashboard?.resumo;

  return (
    <div className="grid grid-cols-2 gap-2">
      <HeroStatCell
        label="Comandas abertas"
        value={resumo ? String(resumo.comandasAbertas) : '—'}
      />
      <HeroStatCell
        label="Comandas fechadas"
        value={resumo ? String(resumo.comandasFechadas) : '—'}
      />
      <HeroStatCell
        label="Vendas avulsas"
        value={resumo ? String(resumo.vendasAvulsas) : '—'}
      />
      <HeroStatCell
        label="Receita avulsa"
        value={resumo ? formatCurrency(resumo.receitaAvulsa) : '—'}
      />
      <HeroStatCell
        label="Valor aberto"
        value={resumo ? formatCurrency(resumo.valorAberto) : '—'}
      />
      <HeroStatCell
        label="Valor fechado"
        value={resumo ? formatCurrency(resumo.valorFechado) : '—'}
      />
    </div>
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

      <EventoHeroResumo eventoId={evento.id} />

      <div className="flex gap-2">

        <button type="button" className="btn-hero-white flex-1 min-w-0" onClick={onComandas}>

          Continuar comandas

        </button>

        <EditarCardapioEventoButton eventoId={evento.id} eventoAberto iconOnly />

        <VerRankingButton eventoId={evento.id} iconOnly />

      </div>

      {canExcluirEvento(evento) && (
        <ExcluirEventoButton
          eventoId={evento.id}
          eventoNome={evento.nome}
          eventoAberto
          compact
          className="w-full"
        />
      )}

    </div>

  );

}



function AgendaSerieCard({
  serie,
  isToday,
  pending,
  onIniciar,
  onEdit,
  onRemove,
}: {
  serie: Evento;
  isToday: boolean;
  pending: boolean;
  onIniciar: () => void;
  onEdit: () => void;
  onRemove?: () => void;
}) {

  const diaLabel =

    serie.diaSemana != null ? `Toda ${DIAS_RECORRENCIA[serie.diaSemana]}` : 'Agenda fixa';



  return (

    <div className="card space-y-3">

      <div className="flex items-start justify-between gap-3">

        <div className="min-w-0">

          <p className="text-sm font-semibold text-purple capitalize">{diaLabel}</p>

          <p className="font-bold text-lg leading-tight mt-0.5">{serie.nome}</p>

          <p className="text-sm text-ink-muted mt-1">{formatEventoMeta(serie)}</p>

        </div>

        <StatusBadge variant="series" />

      </div>

      <div className="flex flex-wrap gap-2">

        {isToday ? (

          <button

            type="button"

            className="btn-outline-light flex-1 min-w-[10rem] disabled:opacity-40"

            disabled={pending}

            onClick={onIniciar}

          >

            {pending ? 'Iniciando…' : 'Iniciar sessão'}

          </button>

        ) : (

          <p className="flex-1 text-sm text-ink-faint py-2">Agendado</p>

        )}

        <EditEventoButton onClick={onEdit} />

        {onRemove && (

          <button type="button" className="touch-btn-danger touch-btn-sm px-4" onClick={onRemove}>

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

        <div className="min-w-0">

          <p className="font-bold text-lg leading-tight">{sessao.nome}</p>

          <p className="text-sm text-ink-muted mt-1">{formatEventoMeta(sessao)}</p>

          {sessao.trailer && (
            <p className="text-xs text-ink-faint mt-1">{formatTrailerLabel(sessao.trailer)}</p>
          )}

          {sessao.serieId && (

            <p className="text-xs text-ink-faint mt-1">Sessão de agenda fixa</p>

          )}

          <EventoMontagemTaps eventoId={sessao.id} variant="card" />

        </div>

        <StatusBadge variant={eventoStatusVariant(sessao.status)} />

      </div>

      {sessao.status === 'ABERTO' && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-outline-light flex-1 min-w-[10rem]" onClick={onRetomar}>
              Continuar comandas
            </button>
            <VerRankingButton eventoId={sessao.id} fullWidth={false} />
          </div>
          <EditEventoButton onClick={onEdit} className="w-full" />
          {canExcluirEvento(sessao) && (
            <ExcluirEventoButton
              eventoId={sessao.id}
              eventoNome={sessao.nome}
              eventoAberto
            />
          )}
        </div>
      )}

      {sessao.status === 'FECHADO' && (

        <div className="space-y-2">

          <div className="flex flex-wrap gap-2">

            <ReabrirEventoButton eventoId={sessao.id} encerradoEm={sessao.encerradoEm} />

            <VerRankingButton eventoId={sessao.id} fullWidth={false} />

          </div>

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
  onIniciarSerie,
  onRetomar,
  onEdit,
  onRemoveSerie,
}: {
  item: AgendaItem;
  day: AgendaDay;
  isDono: boolean;
  iniciarPending: boolean;
  onIniciarSerie: (serieId: string) => void;
  onRetomar: (sessao: Evento) => void;
  onEdit: (evento: Evento) => void;
  onRemoveSerie?: (serie: Evento) => void;
}) {
  if (item.kind === 'serie') {
    return (
      <AgendaSerieCard
        serie={item.serie}
        isToday={day.isToday}
        pending={iniciarPending}
        onIniciar={() => onIniciarSerie(item.serie.id)}
        onEdit={() => onEdit(item.serie)}
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

    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao criar'),

  });



  const iniciarMutation = useMutation({

    mutationFn: (serieId: string) => api.post<Evento>(`/api/eventos/${serieId}/iniciar`),

    onSuccess: (sessao) => {

      queryClient.invalidateQueries({ queryKey: ['eventos'] });

      setEvento(sessao);

      navigate('/comandas');

    },

    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao iniciar sessão'),

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



  const retomarSessao = (e: Evento) => {
    setTrailer(e.trailerId);
    navigate('/comandas');
  };



  if (isLoading) return <Loading />;

  const series = data?.series ?? [];

  const sessoes = data?.sessoes ?? [];

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

  const agendaDays = buildAgendaDays(seriesFiltered, sessoesFiltered, excludedSessaoIds, WEEKS_FUTURE * 7 + 7);

  const empty = isAgendaEmpty(seriesFiltered, sessoesFiltered);

  const canRemoveSerie = (s: Evento) => !s._count?.ocorrencias || s._count.ocorrencias === 0;

  const selectedDay =
    agendaDays.find((d) => d.dateKey === selectedDateKey) ??
    getAgendaDayForDate(selectedDateKey, seriesFiltered, sessoesFiltered, excludedSessaoIds);

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

                    onIniciarSerie={(id) => iniciarMutation.mutate(id)}

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

                      onIniciarSerie={(id) => iniciarMutation.mutate(id)}

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

            <button type="submit" className="touch-btn-primary w-full min-h-14" disabled={updateMutation.isPending}>

              {updateMutation.isPending ? 'Salvando...' : 'Salvar alterações'}

            </button>

          </form>

        )}

      </Modal>

    </div>

  );

}

