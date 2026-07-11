import type { Evento, Trailer } from '../types';
import { formatTrailerLabel } from '../types';

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

export type EventoFormState = {
  nome: string;
  local: string;
  data: string;
  horaInicio: string;
  horaFim: string;
  recorrencia: 'NENHUMA' | 'SEMANAL';
  diaSemana: number;
  trailerId: string;
};

export function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function defaultEventoForm(trailerId = ''): EventoFormState {
  return {
    nome: '',
    local: '',
    data: todayString(),
    horaInicio: '18:00',
    horaFim: '',
    recorrencia: 'NENHUMA',
    diaSemana: new Date().getDay(),
    trailerId,
  };
}

export function isSerieEvento(evento: Pick<Evento, 'recorrencia' | 'serieId'>) {
  return evento.recorrencia === 'SEMANAL' && !evento.serieId;
}

export function eventoToForm(evento: Evento): EventoFormState {
  const serie = isSerieEvento(evento);
  return {
    nome: evento.nome,
    local: evento.local,
    data: evento.data ? evento.data.slice(0, 10) : todayString(),
    horaInicio: evento.horaInicio,
    horaFim: evento.horaFim ?? '',
    recorrencia: serie ? 'SEMANAL' : 'NENHUMA',
    diaSemana: evento.diaSemana ?? new Date().getDay(),
    trailerId: evento.trailerId,
  };
}

interface EventoFormFieldsProps {
  form: EventoFormState;
  setForm: React.Dispatch<React.SetStateAction<EventoFormState>>;
  allowRecorrenciaChange?: boolean;
  trailers?: Trailer[];
  showTrailer?: boolean;
}

export function EventoFormFields({
  form,
  setForm,
  allowRecorrenciaChange = true,
  trailers = [],
  showTrailer = true,
}: EventoFormFieldsProps) {
  return (
    <>
      {allowRecorrenciaChange && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`min-h-12 rounded-xl font-semibold text-sm ${
              form.recorrencia === 'NENHUMA' ? 'bg-brand-600 text-white' : 'bg-surface-lighter text-ink-muted'
            }`}
            onClick={() => setForm({ ...form, recorrencia: 'NENHUMA' })}
          >
            Evento avulso
          </button>
          <button
            type="button"
            className={`min-h-12 rounded-xl font-semibold text-sm ${
              form.recorrencia === 'SEMANAL' ? 'bg-brand-600 text-white' : 'bg-surface-lighter text-ink-muted'
            }`}
            onClick={() => setForm({ ...form, recorrencia: 'SEMANAL' })}
          >
            Repete semanal
          </button>
        </div>
      )}

      <div>
        <label className="label">Nome</label>
        <input
          className="input"
          value={form.nome}
          onChange={(ev) => setForm({ ...form, nome: ev.target.value })}
          placeholder="Ex: CIA Marítima"
          required
        />
      </div>
      <div>
        <label className="label">Local</label>
        <input
          className="input"
          value={form.local}
          onChange={(ev) => setForm({ ...form, local: ev.target.value })}
          placeholder="Ex: Condomínio Solar"
          required
        />
      </div>

      {showTrailer && (
        <div>
          <label className="label">Trailer</label>
          <select
            className="input"
            value={form.trailerId}
            onChange={(ev) => setForm({ ...form, trailerId: ev.target.value })}
            required
          >
            <option value="">Selecione o trailer</option>
            {trailers.filter((t) => t.ativo).map((tr) => (
              <option key={tr.id} value={tr.id}>
                {formatTrailerLabel(tr)}
              </option>
            ))}
          </select>
        </div>
      )}

      {form.recorrencia === 'SEMANAL' ? (
        <div>
          <label className="label">Dia da semana</label>
          <div className="grid grid-cols-7 gap-1.5">
            {DIAS_SEMANA.map((dia, idx) => (
              <button
                key={dia}
                type="button"
                className={`min-h-11 rounded-xl text-xs font-bold ${
                  form.diaSemana === idx
                    ? 'bg-brand-600 text-white'
                    : 'bg-surface-lighter text-ink-muted'
                }`}
                onClick={() => setForm({ ...form, diaSemana: idx })}
              >
                {dia}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-faint mt-2">
            Ex: toda sexta no seu condomínio, toda quarta no condomínio ao lado
          </p>
        </div>
      ) : (
        <div>
          <label className="label">Data</label>
          <input
            type="date"
            className="input"
            value={form.data}
            onChange={(ev) => setForm({ ...form, data: ev.target.value })}
            required
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Início</label>
          <input
            type="time"
            className="input"
            value={form.horaInicio}
            onChange={(ev) => setForm({ ...form, horaInicio: ev.target.value })}
            required
          />
        </div>
        <div>
          <label className="label">Fim (opcional)</label>
          <input
            type="time"
            className="input"
            value={form.horaFim}
            onChange={(ev) => setForm({ ...form, horaFim: ev.target.value })}
          />
        </div>
      </div>
    </>
  );
}

export function buildUpdatePayload(form: EventoFormState, evento: Evento) {
  const base = {
    nome: form.nome,
    local: form.local,
    horaInicio: form.horaInicio,
    horaFim: form.horaFim || null,
  };

  if (isSerieEvento(evento)) {
    return { ...base, diaSemana: form.diaSemana };
  }

  return { ...base, data: form.data };
}
