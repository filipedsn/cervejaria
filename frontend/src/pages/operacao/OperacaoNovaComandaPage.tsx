import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { formatPhone } from '../../lib/phone';
import { formatPersonName, formatPersonNameInput } from '../../lib/person-name';
import { PageHeader } from '../../components/PageHeader';
import { useOperacaoContexto } from '../../hooks/useOperacaoContexto';
import { usePollInterval } from '../../hooks/usePollInterval';
import type { CaixaResposta, ComandaOperacao } from '../../lib/operacao';
import type { Cliente, ClienteListResponse } from '../../types';

function isPhoneValid(value: string) { return value.replace(/\D/g, '').length >= 10; }

function ClienteResumo({ cliente, novo }: { cliente: Cliente | null; novo: boolean }) {
  if (novo) return <div className="card bg-surface-lighter border-line text-sm">Este telefone ainda não está cadastrado. Será criado ao abrir a comanda.</div>;
  if (!cliente) return null;
  return <div className="card bg-brand-50/50 border-brand-200/40 space-y-2"><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold text-brand-700">Cliente cadastrado</p><Link to={`/clientes/${cliente.id}`} className="text-xs font-semibold text-brand-600 hover:underline">Ver perfil</Link></div>{!cliente.telefone && <p className="text-xs text-warn">Cadastro legado — o telefone informado será vinculado.</p>}<div className="grid grid-cols-3 gap-2 text-center text-sm"><div><p className="text-xs text-ink-muted">Visitas</p><p className="font-bold">{cliente.estatisticas?.totalComandasFechadas ?? 0}</p></div><div><p className="text-xs text-ink-muted">Total gasto</p><p className="font-bold">{formatCurrency(cliente.estatisticas?.totalGasto ?? cliente.totalGasto ?? 0)}</p></div><div><p className="text-xs text-ink-muted">Última visita</p><p className="font-bold text-xs mt-0.5">{cliente.estatisticas?.ultimaVisitaEm ? new Date(cliente.estatisticas.ultimaVisitaEm).toLocaleDateString('pt-BR') : '—'}</p></div></div></div>;
}

export function OperacaoNovaComandaPage() {
  const navigate = useNavigate();
  const { contexto } = useOperacaoContexto();
  const pontoAtivo = contexto.ativo ? contexto.pontosVenda[0]?.id || '' : '';
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [nameSearch, setNameSearch] = useState('');
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null);
  const [nomeEditado, setNomeEditado] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [erro, setErro] = useState('');
  const phoneRef = useRef<HTMLInputElement>(null);
  const lastAutoPhone = useRef<string | null>(null);
  const phoneDigits = telefone.replace(/\D/g, '');
  const phoneValid = isPhoneValid(telefone);
  const pollMs = usePollInterval(30_000);

  const caixaQuery = useQuery({
    queryKey: ['operacao-caixa', pontoAtivo],
    queryFn: () => api.get<CaixaResposta>(`/api/operacao/caixa?pontoVendaId=${pontoAtivo}`),
    enabled: Boolean(pontoAtivo), refetchInterval: pollMs,
  });
  const caixaData = caixaQuery.data;
  const caixaAberto = caixaData?.sessao?.status === 'ABERTO';
  const { data: nameData } = useQuery({
    queryKey: ['clientes-search-name', nameSearch],
    queryFn: () => api.get<ClienteListResponse>(`/api/clientes?q=${encodeURIComponent(nameSearch)}&limit=8`),
    enabled: nameSearch.length >= 2,
  });
  const { data: phoneData, isFetching: phoneLoading } = useQuery({
    queryKey: ['cliente-by-phone', phoneDigits],
    queryFn: async () => (await api.get<ClienteListResponse>(`/api/clientes?q=${encodeURIComponent(phoneDigits)}&limit=1`)).items[0] ?? null,
    enabled: phoneDigits.length >= 10,
  });
  const clienteExistente = phoneValid && !phoneLoading ? phoneData ?? null : null;
  const clienteAtivo = selectedCliente ?? clienteExistente;
  const clienteNovo = phoneValid && !phoneLoading && !phoneData && !selectedCliente;
  const linkingLegacy = Boolean(selectedCliente && !selectedCliente.telefone);
  const canSubmit = Boolean(nome.trim() && !phoneLoading && (phoneValid || selectedCliente) && caixaAberto && !caixaQuery.isError);

  useEffect(() => { phoneRef.current?.focus(); }, []);
  useEffect(() => {
    if (!phoneValid || phoneLoading || !phoneData) return;
    if (!nomeEditado || lastAutoPhone.current !== phoneDigits) {
      setNome(phoneData.nome); setNomeEditado(false); lastAutoPhone.current = phoneDigits;
    }
  }, [phoneData, phoneLoading, phoneValid, phoneDigits, nomeEditado]);

  const abrir = useMutation({
    mutationFn: () => api.post<ComandaOperacao>('/api/operacao/comandas', {
      pontoVendaId: pontoAtivo,
      tipo: 'APELIDO',
      identificador: formatPersonName(nome),
      clienteNome: formatPersonName(nome),
      ...(phoneValid ? { clienteTelefone: formatPhone(telefone) } : {}),
      ...(selectedCliente ? { clienteId: selectedCliente.id } : {}),
      itens: [],
    }),
    onSuccess: (comanda) => navigate(`/operacao/comandas/${comanda.id}`),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && typeof err.body?.comandaId === 'string') return navigate(`/operacao/comandas/${err.body.comandaId}`);
      setErro(err instanceof ApiError ? err.message : 'Não foi possível abrir a comanda');
    },
  });

  const selectCliente = (cliente: Cliente) => {
    setNome(cliente.nome); setNameSearch(''); setShowSuggestions(false); setNomeEditado(false); lastAutoPhone.current = null;
    if (cliente.telefone) setTelefone(formatPhone(cliente.telefone));
    else { setSelectedCliente(cliente); setTelefone(''); phoneRef.current?.focus(); }
  };

  return <div className="space-y-4 pb-2">{caixaQuery.isError && <div role="alert" className="alert-error">Nao foi possivel consultar o caixa. Volte a tela de comandas e tente novamente.</div>}<PageHeader title="Nova comanda" backTo="/operacao/comandas" backLabel="Comandas" /><p className="text-sm text-ink-muted leading-relaxed">Abra uma comanda por apelido, mesa ou ficha. Os itens são lançados na tela seguinte.</p>{!caixaAberto && !caixaQuery.isError && pontoAtivo && <div className="alert-error">Caixa fechado. Abra o caixa na tela de comandas para continuar.</div>}<form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!canSubmit) return; setErro(''); abrir.mutate(); }}>{erro && <div className="alert-error">{erro}</div>}<div><label className="label">Telefone</label><input ref={phoneRef} className="input" type="tel" inputMode="numeric" autoComplete="tel" value={telefone} onChange={(e) => setTelefone(formatPhone(e.target.value))} placeholder="(11) 9 9999-9999" required={!selectedCliente || linkingLegacy} /><p className="text-xs text-ink-faint mt-1">Identifica ou cadastra o cliente. Se já existir, o nome será preenchido automaticamente.</p></div><div className="relative"><label className="label">Nome do cliente</label><input className="input" value={nome} onChange={(e) => { const formatted = formatPersonNameInput(e.target.value); setNome(formatted); setNameSearch(formatted); setShowSuggestions(true); setNomeEditado(true); if (selectedCliente && formatPersonName(formatted) !== formatPersonName(selectedCliente.nome)) setSelectedCliente(null); }} onFocus={() => nameSearch.length >= 2 && setShowSuggestions(true)} placeholder="Digite o nome..." required autoComplete="off" />{showSuggestions && (nameData?.items ?? []).length > 0 && <div className="absolute z-10 w-full mt-1 bg-surface rounded-xl border border-line overflow-hidden shadow-xl">{nameData!.items.map((c) => <button key={c.id} type="button" className="w-full text-left px-4 py-3 hover:bg-surface-lighter border-b border-line last:border-0" onMouseDown={(e) => e.preventDefault()} onClick={() => selectCliente(c)}><span className="font-medium">{c.nome}</span>{c.telefone && <span className="text-ink-faint ml-2 text-sm">{formatPhone(c.telefone)}</span>}</button>)}</div>}</div>{clienteAtivo && <ClienteResumo cliente={clienteAtivo} novo={false} />}{clienteNovo && <ClienteResumo cliente={null} novo />}<button type="submit" className="touch-btn-primary w-full" disabled={abrir.isPending || !canSubmit}>{abrir.isPending ? 'Abrindo...' : 'Abrir comanda'}</button><button type="button" className="touch-btn-secondary w-full" onClick={() => navigate('/operacao/comandas')}>Cancelar</button></form></div>;
}
