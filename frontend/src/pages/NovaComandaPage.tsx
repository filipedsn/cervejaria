import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../lib/api';
import { formatPhone } from '../lib/phone';
import type { Cliente, ClienteListResponse } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { PageHeader } from '../components/PageHeader';

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isPhoneValid(value: string) {
  return value.replace(/\D/g, '').length >= 10;
}

function ClienteResumo({ cliente, isNew }: { cliente: Cliente | null; isNew: boolean }) {
  if (isNew) {
    return (
      <div className="card bg-surface-lighter border-line space-y-1">
        <p className="text-sm font-semibold text-ink">Novo cliente</p>
        <p className="text-xs text-ink-muted">
          Este telefone ainda não está cadastrado. Será criado ao abrir a comanda.
        </p>
      </div>
    );
  }

  if (!cliente) return null;

  const stats = cliente.estatisticas;

  return (
    <div className="card bg-brand-50/50 border-brand-200/40 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-brand-700">Cliente cadastrado</p>
        <Link to={`/clientes/${cliente.id}`} className="text-xs font-semibold text-brand-600 hover:underline">
          Ver perfil
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div>
          <p className="text-xs text-ink-muted">Visitas</p>
          <p className="font-bold">{stats?.totalComandasFechadas ?? 0}</p>
        </div>
        <div>
          <p className="text-xs text-ink-muted">Total gasto</p>
          <p className="font-bold">{formatCurrency(stats?.totalGasto ?? cliente.totalGasto ?? 0)}</p>
        </div>
        <div>
          <p className="text-xs text-ink-muted">Última visita</p>
          <p className="font-bold text-xs mt-0.5">{formatDate(stats?.ultimaVisitaEm)}</p>
        </div>
      </div>
    </div>
  );
}

export function NovaComandaPage() {
  const navigate = useNavigate();
  const { evento } = useEvento();
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [nameSearch, setNameSearch] = useState('');
  const [nomeEditadoManualmente, setNomeEditadoManualmente] = useState(false);
  const [nomeReferenciaTelefone, setNomeReferenciaTelefone] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const lastAutoFilledPhone = useRef<string | null>(null);

  const phoneDigits = telefone.replace(/\D/g, '');
  const phoneValid = isPhoneValid(telefone);

  const { data: nameSuggestionsData } = useQuery({
    queryKey: ['clientes-search-name', nameSearch],
    queryFn: () =>
      api.get<ClienteListResponse>(`/api/clientes?q=${encodeURIComponent(nameSearch)}&limit=8`),
    enabled: nameSearch.length >= 2,
  });

  const { data: phoneLookup, isFetching: phoneLookupLoading } = useQuery({
    queryKey: ['cliente-by-phone', phoneDigits],
    queryFn: async () => {
      const res = await api.get<ClienteListResponse>(
        `/api/clientes?q=${encodeURIComponent(phoneDigits)}&limit=1`,
      );
      return res.items[0] ?? null;
    },
    enabled: phoneDigits.length >= 10,
  });

  useEffect(() => {
    phoneInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!phoneValid || phoneLookupLoading) return;

    if (phoneLookup) {
      setNomeReferenciaTelefone(phoneLookup.nome);
      const shouldAutoFill =
        !nomeEditadoManualmente ||
        lastAutoFilledPhone.current !== phoneDigits;
      if (shouldAutoFill) {
        setNome(phoneLookup.nome);
        setNomeEditadoManualmente(false);
        lastAutoFilledPhone.current = phoneDigits;
      }
    } else {
      setNomeReferenciaTelefone(null);
      if (lastAutoFilledPhone.current === phoneDigits) {
        lastAutoFilledPhone.current = null;
      }
    }
  }, [phoneLookup, phoneLookupLoading, phoneValid, phoneDigits, nomeEditadoManualmente]);

  const nameSuggestions = nameSuggestionsData?.items ?? [];
  const clienteExistente = phoneValid && !phoneLookupLoading ? phoneLookup ?? null : null;
  const isNewCliente = phoneValid && !phoneLookupLoading && !phoneLookup;
  const canSubmit = nome.trim().length > 0 && phoneValid && !loading;

  const handleSelectByName = (cliente: Cliente) => {
    setNome(cliente.nome);
    setNameSearch('');
    setShowNameSuggestions(false);
    setNomeEditadoManualmente(false);
    lastAutoFilledPhone.current = null;
    if (cliente.telefone) {
      setTelefone(formatPhone(cliente.telefone));
      setNomeReferenciaTelefone(cliente.nome);
    } else {
      setTelefone('');
      setNomeReferenciaTelefone(null);
      phoneInputRef.current?.focus();
    }
  };

  const handleTelefoneChange = (value: string) => {
    const formatted = formatPhone(value);
    setTelefone(formatted);
    if (!formatted) {
      setNomeReferenciaTelefone(null);
      lastAutoFilledPhone.current = null;
    }
  };

  const handleNomeChange = (value: string) => {
    setNome(value);
    setNameSearch(value);
    setShowNameSuggestions(true);
    setNomeEditadoManualmente(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!evento || !canSubmit) return;
    setError('');
    setLoading(true);
    try {
      const comanda = await api.post<{ id: string }>('/api/comandas', {
        eventoId: evento.id,
        clienteNome: nome.trim(),
        clienteTelefone: formatPhone(telefone),
      });
      navigate(`/comandas/${comanda.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao criar comanda');
    } finally {
      setLoading(false);
    }
  };

  if (!evento) {
    navigate('/eventos');
    return null;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Nova Comanda" backTo="/comandas" backLabel="Comandas" />

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="alert-error">{error}</div>}

        <div>
          <label className="label">Telefone</label>
          <input
            ref={phoneInputRef}
            className="input"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={telefone}
            onChange={(e) => handleTelefoneChange(e.target.value)}
            placeholder="(11) 99999-9999"
            required
          />
          <p className="text-xs text-ink-faint mt-1">
            Identifica ou cadastra o cliente. Se já existir, o nome será preenchido automaticamente.
          </p>
        </div>

        <div className="relative">
          <label className="label">Nome do cliente</label>
          <input
            className="input"
            value={nome}
            onChange={(e) => handleNomeChange(e.target.value)}
            placeholder="Digite o nome..."
            required
            autoComplete="off"
          />
          <p className="text-xs text-ink-faint mt-1">
            Nome exibido na comanda. Você também pode buscar clientes cadastrados pelo nome.
          </p>
          {showNameSuggestions && nameSuggestions.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-surface rounded-xl border border-line overflow-hidden shadow-xl">
              {nameSuggestions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="w-full text-left px-4 py-3 hover:bg-surface-lighter border-b border-line last:border-0"
                  onClick={() => handleSelectByName(c)}
                >
                  <span className="font-medium">{c.nome}</span>
                  {c.telefone ? (
                    <span className="text-ink-faint ml-2 text-sm">{formatPhone(c.telefone)}</span>
                  ) : (
                    <span className="text-amber-700 ml-2 text-xs">sem telefone — informe abaixo</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {telefone && nomeReferenciaTelefone && nome.trim() !== nomeReferenciaTelefone.trim() && (
          <p className="text-xs text-amber-700">
            Telefone de &quot;{nomeReferenciaTelefone}&quot; — a comanda usará &quot;{nome.trim()}&quot;.
          </p>
        )}

        {phoneValid && !phoneLookupLoading && (
          <ClienteResumo cliente={clienteExistente} isNew={isNewCliente} />
        )}

        <div className="flex gap-3 pt-2">
          <button type="button" className="touch-btn-secondary flex-1" onClick={() => navigate('/comandas')}>
            Cancelar
          </button>
          <button type="submit" className="touch-btn-primary flex-1" disabled={!canSubmit}>
            {loading ? 'Abrindo...' : 'Abrir Comanda'}
          </button>
        </div>
      </form>
    </div>
  );
}
