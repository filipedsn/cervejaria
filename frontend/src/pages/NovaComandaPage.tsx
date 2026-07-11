import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { formatPhone } from '../lib/phone';
import type { Cliente } from '../types';
import { useEvento } from '../contexts/EventoContext';
import { PageHeader } from '../components/PageHeader';

export function NovaComandaPage() {
  const navigate = useNavigate();
  const { evento } = useEvento();
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [search, setSearch] = useState('');
  const [clienteSugerido, setClienteSugerido] = useState<Cliente | null>(null);
  const [nomeReferenciaTelefone, setNomeReferenciaTelefone] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: suggestions } = useQuery({
    queryKey: ['clientes', search],
    queryFn: () => api.get<Cliente[]>(`/api/clientes?q=${encodeURIComponent(search)}`),
    enabled: search.length >= 2,
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSelect = (cliente: Cliente) => {
    setNome(cliente.nome);
    setTelefone(cliente.telefone ? formatPhone(cliente.telefone) : '');
    setClienteSugerido(cliente);
    setNomeReferenciaTelefone(cliente.telefone ? cliente.nome : null);
    setSearch('');
    setShowSuggestions(false);
  };

  const handleNomeChange = (value: string) => {
    setNome(value);
    setSearch(value);
    setShowSuggestions(true);
    if (clienteSugerido && value.trim() !== clienteSugerido.nome.trim()) {
      setClienteSugerido(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!evento) return;
    setError('');
    setLoading(true);
    try {
      const comanda = await api.post<{ id: string }>('/api/comandas', {
        eventoId: evento.id,
        clienteNome: nome,
        clienteTelefone: telefone ? formatPhone(telefone) : null,
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

        <div className="relative">
          <label className="label">Nome do cliente</label>
          <input
            ref={inputRef}
            className="input"
            value={nome}
            onChange={(e) => handleNomeChange(e.target.value)}
            placeholder="Digite o nome..."
            required
            autoComplete="off"
          />
          {showSuggestions && suggestions && suggestions.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-surface rounded-xl border border-line overflow-hidden shadow-xl">
              {suggestions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="w-full text-left px-4 py-3 hover:bg-surface-lighter border-b border-line last:border-0"
                  onClick={() => handleSelect(c)}
                >
                  <span className="font-medium">{c.nome}</span>
                  {c.telefone && (
                    <span className="text-ink-faint ml-2 text-sm">{formatPhone(c.telefone)}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="label">Telefone (opcional)</label>
          <input
            className="input"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={telefone}
            onChange={(e) => {
              const formatted = formatPhone(e.target.value);
              setTelefone(formatted);
              if (!formatted) setNomeReferenciaTelefone(null);
            }}
            placeholder="(11) 99999-9999"
          />
          <p className="text-xs text-ink-faint mt-1">
            Usado para identificar clientes recorrentes e ranking. Se o telefone já existir, o nome da comanda será o que você digitar.
          </p>
          {telefone && nomeReferenciaTelefone && nome.trim() !== nomeReferenciaTelefone.trim() && (
            <p className="text-xs text-amber-700 mt-1">
              Telefone de &quot;{nomeReferenciaTelefone}&quot; — a comanda usará &quot;{nome.trim()}&quot;.
            </p>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" className="touch-btn-secondary flex-1" onClick={() => navigate('/comandas')}>
            Cancelar
          </button>
          <button type="submit" className="touch-btn-primary flex-1" disabled={loading || !nome.trim()}>
            {loading ? 'Abrindo...' : 'Abrir Comanda'}
          </button>
        </div>
      </form>
    </div>
  );
}
