import { useEffect, useState } from 'react';
import { api, ApiError, formatCurrency } from '../lib/api';
import { Modal } from './Modal';
import { IconEye, IconEyeOff, IconPencil, IconTrash } from './NavIcons';

type Opcional = { id: string; nome: string; preco: number | string; ativo: boolean };
type Vinculo = { opcional: Opcional };

export function ProdutoOpcionaisModal({ open, onClose, produtoId, produtoNome, baseUrl }: { open: boolean; onClose: () => void; produtoId: string; produtoNome: string; baseUrl: string }) {
  const [catalogo, setCatalogo] = useState<Opcional[]>([]);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [novoNome, setNovoNome] = useState('');
  const [novoPreco, setNovoPreco] = useState('0');
  const [mostrarCadastro, setMostrarCadastro] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editandoNome, setEditandoNome] = useState('');
  const [editandoPreco, setEditandoPreco] = useState('0');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErro('');
    Promise.all([api.get<Opcional[]>(`${baseUrl}/opcionais`), api.get<Vinculo[]>(`${baseUrl}/${produtoId}/opcionais`)]).then(([todos, vinculados]) => { setCatalogo(todos); setSelecionados(vinculados.map((v) => v.opcional.id)); }).catch((e) => setErro(e instanceof ApiError ? e.message : 'Não foi possível carregar os opcionais'));
  }, [open, produtoId, baseUrl]);

  const criar = async () => {
    if (!novoNome.trim()) return setErro('Informe o nome do opcional');
    try { const opcional = await api.post<Opcional>(`${baseUrl}/opcionais`, { nome: novoNome.trim(), preco: Number(novoPreco) || 0 }); setCatalogo((atual) => [...atual, opcional]); setSelecionados((atual) => [...atual, opcional.id]); setNovoNome(''); setNovoPreco('0'); setMostrarCadastro(false); } catch (e) { setErro(e instanceof ApiError ? e.message : 'Não foi possível cadastrar o opcional'); }
  };
  const salvar = async () => { setSalvando(true); setErro(''); try { await api.put(`${baseUrl}/${produtoId}/opcionais`, { opcionalIds: selecionados }); onClose(); } catch (e) { setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar'); } finally { setSalvando(false); } };
  const salvarEdicao = async () => { if (!editandoId || !editandoNome.trim()) return setErro('Informe o nome do opcional'); try { const atualizado = await api.put<Opcional>(`${baseUrl}/opcionais/${editandoId}`, { nome: editandoNome.trim(), preco: Number(editandoPreco) || 0 }); setCatalogo((atual) => atual.map((item) => item.id === atualizado.id ? atualizado : item)); setEditandoId(null); } catch (e) { setErro(e instanceof ApiError ? e.message : 'Não foi possível editar o opcional'); } };
  const alternarAtivo = async (opcional: Opcional) => { try { const atualizado = await api.put<Opcional>(`${baseUrl}/opcionais/${opcional.id}`, { ativo: !opcional.ativo }); setCatalogo((atual) => atual.map((item) => item.id === atualizado.id ? atualizado : item)); if (!atualizado.ativo) setSelecionados((atual) => atual.filter((id) => id !== atualizado.id)); } catch (e) { setErro(e instanceof ApiError ? e.message : 'Não foi possível alterar o status'); } };
  const excluir = async (opcional: Opcional) => { if (!window.confirm(`Excluir o opcional "${opcional.nome}"?`)) return; try { await api.delete(`${baseUrl}/opcionais/${opcional.id}`); setCatalogo((atual) => atual.filter((item) => item.id !== opcional.id)); setSelecionados((atual) => atual.filter((id) => id !== opcional.id)); } catch (e) { setErro(e instanceof ApiError ? e.message : 'Não foi possível excluir o opcional'); } };

  return <Modal open={open} onClose={onClose} title={`Opcionais — ${produtoNome}`} footer={<><button className="touch-btn-primary w-full" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar'}</button><button className="touch-btn-orange w-full" onClick={onClose}>Cancelar</button></>}>
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">Selecione os opcionais disponíveis para este produto.</p>
      {erro && <div className="alert-error">{erro}</div>}
      <div className="space-y-2">{catalogo.map((opcional) => editandoId === opcional.id ? <div key={opcional.id} className="rounded-xl border border-brand-500 p-3 space-y-2"><input className="input w-full" value={editandoNome} onChange={(e) => setEditandoNome(e.target.value)} /><input className="input w-full" type="number" min="0" step="0.01" value={editandoPreco} onChange={(e) => setEditandoPreco(e.target.value)} /><div className="flex gap-2"><button type="button" className="touch-btn-primary flex-1" onClick={salvarEdicao}>Salvar alteração</button><button type="button" className="touch-btn-secondary flex-1" onClick={() => setEditandoId(null)}>Cancelar</button></div></div> : <div key={opcional.id} className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 ${!opcional.ativo ? 'opacity-50' : ''}`}><label className="flex cursor-pointer items-center gap-3"><input className="h-5 w-5 accent-brand-500" type="checkbox" disabled={!opcional.ativo} checked={selecionados.includes(opcional.id)} onChange={() => setSelecionados((atual) => atual.includes(opcional.id) ? atual.filter((id) => id !== opcional.id) : [...atual, opcional.id])} /><span className="font-semibold">{opcional.nome}</span></label><div className="flex items-center gap-2"><span className="text-sm text-ink-muted">{formatCurrency(Number(opcional.preco))}</span><button type="button" className="icon-btn" title="Editar" aria-label={`Editar ${opcional.nome}`} onClick={() => { setEditandoId(opcional.id); setEditandoNome(opcional.nome); setEditandoPreco(String(opcional.preco)); }}><IconPencil className="h-4 w-4" /></button><button type="button" className="icon-btn" title={opcional.ativo ? 'Desativar' : 'Ativar'} aria-label={`${opcional.ativo ? 'Desativar' : 'Ativar'} ${opcional.nome}`} onClick={() => alternarAtivo(opcional)}>{opcional.ativo ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}</button><button type="button" className="icon-btn-danger" title="Excluir" aria-label={`Excluir ${opcional.nome}`} onClick={() => excluir(opcional)}><IconTrash className="h-4 w-4" /></button></div></div>)}{catalogo.length === 0 && <p className="rounded-xl border border-line px-4 py-5 text-center text-sm text-ink-faint">Nenhum opcional cadastrado.</p>}</div>
      {!mostrarCadastro ? <button type="button" className="touch-btn-ghost w-full" onClick={() => setMostrarCadastro(true)}>+ Novo opcional</button> : <div className="rounded-xl border border-line p-3 space-y-3"><p className="font-semibold">Novo opcional</p><label className="block text-sm">Nome<input className="input mt-1 w-full" placeholder="Ex.: Queijo extra" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} /></label><label className="block text-sm">Preço<input className="input mt-1 w-full" type="number" min="0" step="0.01" value={novoPreco} onChange={(e) => setNovoPreco(e.target.value)} /></label><div className="flex gap-2"><button type="button" className="touch-btn-primary flex-1" onClick={criar}>Adicionar</button><button type="button" className="touch-btn-secondary flex-1" onClick={() => setMostrarCadastro(false)}>Cancelar</button></div></div>}
    </div>
  </Modal>;
}
