import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, api } from '../../lib/api';
import type { Cliente, ClienteListResponse } from '../../types';

export function SelecionarClienteOperacao({
  value,
  onChange,
}: {
  value: Cliente | null;
  onChange: (cliente: Cliente | null) => void;
}) {
  const [busca, setBusca] = useState('');
  const [mostrarCadastro, setMostrarCadastro] = useState(false);
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [erroCadastro, setErroCadastro] = useState('');
  const termo = busca.trim();
  const { data, isFetching } = useQuery({
    queryKey: ['clientes-operacao-seletor', termo],
    queryFn: () => api.get<ClienteListResponse>(`/api/clientes?q=${encodeURIComponent(termo)}&limit=8`),
    enabled: termo.length >= 2 && !value,
  });
  const cadastrar = useMutation({
    mutationFn: () => api.post<Cliente>('/api/clientes', { nome: nome.trim(), telefone: telefone.trim() }),
    onSuccess: (cliente) => {
      onChange(cliente);
      setBusca('');
      setNome('');
      setTelefone('');
      setErroCadastro('');
      setMostrarCadastro(false);
    },
    onError: (error) => {
      setErroCadastro(error instanceof ApiError ? error.message : 'Não foi possível cadastrar o cliente');
    },
  });

  return (
    <div className="space-y-2">
      <label className="label" htmlFor="cliente-operacao">
        Cliente <span className="font-normal text-ink-faint">(opcional)</span>
      </label>
      {value ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-400/50 bg-brand-50/40 px-3 py-3">
          <div className="min-w-0">
            <p className="font-semibold truncate">{value.nome}</p>
            <p className="text-xs text-ink-muted">{value.telefone || 'Sem telefone'}</p>
          </div>
          <button type="button" className="touch-btn-secondary touch-btn-sm shrink-0" onClick={() => onChange(null)}>
            Trocar
          </button>
        </div>
      ) : (
        <>
          <input
            id="cliente-operacao"
            className="input"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar por nome ou telefone"
          />
          {isFetching && <p className="text-xs text-ink-faint">Buscando clientes...</p>}
          {termo.length >= 2 && !isFetching && (
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              {data?.items.length ? data.items.map((cliente) => (
                <button
                  key={cliente.id}
                  type="button"
                  className="block w-full border-b border-line px-3 py-2.5 text-left last:border-b-0 hover:bg-surface-lighter"
                  onClick={() => {
                    onChange(cliente);
                    setBusca('');
                  }}
                >
                  <span className="block font-semibold">{cliente.nome}</span>
                  <span className="block text-xs text-ink-muted">{cliente.telefone || 'Sem telefone'}</span>
                </button>
              )) : (
                <p className="px-3 py-3 text-sm text-ink-muted">Nenhum cliente encontrado.</p>
              )}
            </div>
          )}
          <button
            type="button"
            className="touch-btn-secondary touch-btn-sm w-full"
            onClick={() => {
              setErroCadastro('');
              setMostrarCadastro(true);
            }}
          >
            + Cadastrar novo cliente
          </button>
          {mostrarCadastro && (
            <div className="space-y-3 rounded-xl border border-line bg-surface-lighter p-3">
              <p className="font-semibold">Novo cliente</p>
              <input
                className="input"
                value={nome}
                onChange={(event) => setNome(event.target.value)}
                placeholder="Nome completo"
                autoFocus
              />
              <input
                className="input"
                value={telefone}
                onChange={(event) => setTelefone(event.target.value)}
                placeholder="Telefone com DDD"
                inputMode="tel"
              />
              {erroCadastro && <p className="text-sm text-red-400">{erroCadastro}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="touch-btn-primary touch-btn-sm flex-1"
                  disabled={cadastrar.isPending || !nome.trim() || !telefone.trim()}
                  onClick={() => cadastrar.mutate()}
                >
                  {cadastrar.isPending ? 'Cadastrando...' : 'Cadastrar e selecionar'}
                </button>
                <button
                  type="button"
                  className="touch-btn-secondary touch-btn-sm"
                  onClick={() => setMostrarCadastro(false)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
