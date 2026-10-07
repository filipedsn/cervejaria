import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type { Produto, Tap } from '../../types';
import { isChopeConfiguravelNaTap } from '../../types';
import { Loading } from '../Loading';

export function PdvTapsSection({ pontoVendaId }: { pontoVendaId: string }) {
  const queryClient = useQueryClient();
  const [numero, setNumero] = useState('');
  const [nome, setNome] = useState('');
  const [produtoId, setProdutoId] = useState('');
  const [editing, setEditing] = useState<Tap | null>(null);
  const [error, setError] = useState('');
  const { data: taps, isLoading } = useQuery({ queryKey: ['taps-pdv', pontoVendaId], queryFn: () => api.get<Tap[]>(`/api/taps?pontoVendaId=${encodeURIComponent(pontoVendaId)}`) });
  const { data: produtos } = useQuery({ queryKey: ['produtos'], queryFn: () => api.get<Produto[]>('/api/produtos') });
  const chopes = produtos?.filter((p) => p.ativo && isChopeConfiguravelNaTap(p)) ?? [];
  const save = useMutation({
    mutationFn: () => {
      const payload = { numero: Number(numero), nome: nome || undefined, produtoId, pontoVendaId };
      return editing ? api.put(`/api/taps/${editing.id}`, payload) : api.post('/api/taps', payload);
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['taps-pdv', pontoVendaId] }); setEditing(null); setNumero(''); setNome(''); setProdutoId(''); setError(''); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Não foi possível salvar o Tap.'),
  });
  const toggle = useMutation({ mutationFn: (tap: Tap) => api.patch(`/api/taps/${tap.id}/ativo`, { ativo: !tap.ativo }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['taps-pdv', pontoVendaId] }), onError: (e) => setError(e instanceof ApiError ? e.message : 'Não foi possível alterar o Tap.') });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/api/taps/${id}`), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['taps-pdv', pontoVendaId] }), onError: (e) => setError(e instanceof ApiError ? e.message : 'Não foi possível excluir o Tap.') });
  const beginEdit = (tap: Tap) => { setEditing(tap); setNumero(String(tap.numero)); setNome(tap.nome ?? ''); setProdutoId(tap.produtoId ?? ''); };

  return <section className="card space-y-4">
    <div><h3 className="font-bold">Torneiras deste PDV</h3><p className="text-sm text-ink-muted">Cadastre o catálogo de chope do caixa. A montagem de cada turno fica no histórico da sessão.</p></div>
    {error && <div className="alert-error">{error}</div>}
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <label className="label">Número<input className="input" type="number" min={1} required value={numero} onChange={(e) => setNumero(e.target.value)} /></label>
      <label className="label">Nome<input className="input" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
      <label className="label sm:col-span-2">Chope cadastrado<select className="input" required value={produtoId} onChange={(e) => setProdutoId(e.target.value)}><option value="">Selecione o chope</option>{chopes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
      <div className="sm:col-span-2 flex gap-2"><button className="touch-btn-primary touch-btn-sm" disabled={save.isPending || !produtoId}>{save.isPending ? 'Salvando…' : editing ? 'Salvar alterações' : 'Adicionar Tap'}</button>{editing && <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => { setEditing(null); setNumero(''); setNome(''); setProdutoId(''); }}>Cancelar edição</button>}</div>
    </form>
    {isLoading ? <Loading /> : <div className="space-y-2">{(taps ?? []).map((tap) => <div key={tap.id} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3"><div><strong>Tap {tap.numero}{tap.nome ? ` — ${tap.nome}` : ''}</strong><p className="text-sm text-ink-muted">{tap.produto?.nome ?? 'Sem chope'}</p></div><div className="flex gap-2"><button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => beginEdit(tap)}>Editar</button><button type="button" className="touch-btn-secondary touch-btn-sm" onClick={() => toggle.mutate(tap)}>{tap.ativo ? 'Desativar' : 'Ativar'}</button><button type="button" className="touch-btn-danger touch-btn-sm" onClick={() => remove.mutate(tap.id)}>Excluir</button></div></div>)}{!taps?.length && <p className="text-sm text-ink-faint">Nenhuma torneira cadastrada neste PDV.</p>}</div>}
  </section>;
}
