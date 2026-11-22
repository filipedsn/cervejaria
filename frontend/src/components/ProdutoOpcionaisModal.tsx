import { useEffect, useState } from 'react';
import { api, ApiError, formatCurrency } from '../lib/api';
import { formatCurrencyInput, formatCurrencyInputFromNumber, parseCurrencyInput } from '../lib/currency';
import { Modal } from './Modal';
import { IconEye, IconEyeOff, IconPencil, IconTrash } from './NavIcons';

type ProdutoEstoque = { id: string; nome: string; controlaEstoque: boolean };
type Opcional = {
  id: string;
  nome: string;
  preco: number | string;
  ativo: boolean;
  produtoEstoqueId?: string | null;
  produtoEstoque?: { id: string; nome: string; controlaEstoque: boolean } | null;
};
type Vinculo = { opcional: Opcional };

export function ProdutoOpcionaisModal({
  open,
  onClose,
  produtoId,
  produtoNome,
  baseUrl,
}: {
  open: boolean;
  onClose: () => void;
  produtoId: string;
  produtoNome: string;
  baseUrl: string;
}) {
  const [catalogo, setCatalogo] = useState<Opcional[]>([]);
  const [estoqueProdutos, setEstoqueProdutos] = useState<ProdutoEstoque[]>([]);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [novoNome, setNovoNome] = useState('');
  const [novoPreco, setNovoPreco] = useState('');
  const [novoEstoqueId, setNovoEstoqueId] = useState('');
  const [mostrarCadastro, setMostrarCadastro] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editandoNome, setEditandoNome] = useState('');
  const [editandoPreco, setEditandoPreco] = useState('');
  const [editandoEstoqueId, setEditandoEstoqueId] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErro('');
    Promise.all([
      api.get<Opcional[]>(`${baseUrl}/opcionais`),
      api.get<Vinculo[]>(`${baseUrl}/${produtoId}/opcionais`),
      api.get<Array<ProdutoEstoque & { ativo?: boolean; combo?: boolean }>>(baseUrl),
    ])
      .then(([todos, vinculados, produtos]) => {
        setCatalogo(todos);
        setSelecionados(vinculados.map((vinculo) => vinculo.opcional.id));
        setEstoqueProdutos(
          produtos
            .filter((produto) => produto.controlaEstoque && produto.ativo !== false && !produto.combo)
            .map((produto) => ({ id: produto.id, nome: produto.nome, controlaEstoque: true }))
            .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
        );
      })
      .catch((error) => setErro(error instanceof ApiError ? error.message : 'Não foi possível carregar os opcionais'));
  }, [open, produtoId, baseUrl]);

  const selectEstoque = (value: string, onChange: (next: string) => void, label: string) => (
    <label className="block text-sm">
      Estoque (opcional)
      <select className="input mt-1 w-full" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Sem baixa de estoque</option>
        {estoqueProdutos.map((produto) => (
          <option key={produto.id} value={produto.id}>{produto.nome}</option>
        ))}
      </select>
      <span className="mt-1 block text-xs text-ink-faint">Vincule a um produto com “controla estoque” para baixar na venda.</span>
    </label>
  );

  const criar = async () => {
    if (!novoNome.trim()) return setErro('Informe o nome do opcional');
    try {
      const opcional = await api.post<Opcional>(`${baseUrl}/opcionais`, {
        nome: novoNome.trim(),
        preco: parseCurrencyInput(novoPreco),
        produtoEstoqueId: novoEstoqueId || null,
      });
      setCatalogo((atual) => [...atual, opcional]);
      setSelecionados((atual) => [...atual, opcional.id]);
      setNovoNome('');
      setNovoPreco('');
      setNovoEstoqueId('');
      setMostrarCadastro(false);
    } catch (error) {
      setErro(error instanceof ApiError ? error.message : 'Não foi possível cadastrar o opcional');
    }
  };

  const salvar = async () => {
    setSalvando(true);
    setErro('');
    try {
      await api.put(`${baseUrl}/${produtoId}/opcionais`, { opcionalIds: selecionados });
      onClose();
    } catch (error) {
      setErro(error instanceof ApiError ? error.message : 'Não foi possível salvar');
    } finally {
      setSalvando(false);
    }
  };

  const salvarEdicao = async () => {
    if (!editandoId || !editandoNome.trim()) return setErro('Informe o nome do opcional');
    try {
      const atualizado = await api.put<Opcional>(`${baseUrl}/opcionais/${editandoId}`, {
        nome: editandoNome.trim(),
        preco: parseCurrencyInput(editandoPreco),
        produtoEstoqueId: editandoEstoqueId || null,
      });
      setCatalogo((atual) => atual.map((item) => item.id === atualizado.id ? atualizado : item));
      setEditandoId(null);
      setErro('');
    } catch (error) {
      setErro(error instanceof ApiError ? error.message : 'Não foi possível editar o opcional');
    }
  };

  const alternarAtivo = async (opcional: Opcional) => {
    try {
      const atualizado = await api.put<Opcional>(`${baseUrl}/opcionais/${opcional.id}`, { ativo: !opcional.ativo });
      setCatalogo((atual) => atual.map((item) => item.id === atualizado.id ? atualizado : item));
      if (!atualizado.ativo) setSelecionados((atual) => atual.filter((id) => id !== atualizado.id));
    } catch (error) {
      setErro(error instanceof ApiError ? error.message : 'Não foi possível alterar o status');
    }
  };

  const excluir = async (opcional: Opcional) => {
    if (!window.confirm(`Excluir o opcional "${opcional.nome}"?`)) return;
    try {
      await api.delete(`${baseUrl}/opcionais/${opcional.id}`);
      setCatalogo((atual) => atual.filter((item) => item.id !== opcional.id));
      setSelecionados((atual) => atual.filter((id) => id !== opcional.id));
    } catch (error) {
      setErro(error instanceof ApiError ? error.message : 'Não foi possível excluir o opcional');
    }
  };

  const precoInput = (label: string, value: string, onChange: (next: string) => void) => (
    <input
      className="input mt-1 w-full"
      type="text"
      inputMode="decimal"
      aria-label={label}
      placeholder="R$ 0,00"
      value={value}
      onChange={(event) => onChange(formatCurrencyInput(event.target.value))}
    />
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Opcionais — ${produtoNome}`}
      footer={(
        <>
          <button className="touch-btn-primary w-full" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
          <button className="touch-btn-orange w-full" onClick={onClose}>Cancelar</button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">Selecione os opcionais disponíveis para este produto. Pode vincular cada um a um item de estoque.</p>
        {erro && <div className="alert-error">{erro}</div>}
        <div className="space-y-2">
          {catalogo.map((opcional) => editandoId === opcional.id ? (
            <div key={opcional.id} className="space-y-2 rounded-xl border border-brand-500 p-3">
              <input className="input w-full" aria-label={`Nome de ${opcional.nome}`} value={editandoNome} onChange={(event) => setEditandoNome(event.target.value)} />
              {precoInput(`Preço de ${opcional.nome}`, editandoPreco, setEditandoPreco)}
              {selectEstoque(editandoEstoqueId, setEditandoEstoqueId, `Estoque de ${opcional.nome}`)}
              <div className="flex gap-2">
                <button type="button" className="touch-btn-primary flex-1" onClick={salvarEdicao}>Salvar alteração</button>
                <button type="button" className="touch-btn-secondary flex-1" onClick={() => setEditandoId(null)}>Cancelar</button>
              </div>
            </div>
          ) : (
            <div key={opcional.id} className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 ${!opcional.ativo ? 'opacity-50' : ''}`}>
              <label className="flex min-w-0 cursor-pointer items-center gap-3">
                <input className="h-5 w-5 shrink-0 accent-brand-500" type="checkbox" disabled={!opcional.ativo} checked={selecionados.includes(opcional.id)} onChange={() => setSelecionados((atual) => atual.includes(opcional.id) ? atual.filter((id) => id !== opcional.id) : [...atual, opcional.id])} />
                <span className="min-w-0">
                  <span className="block font-semibold">{opcional.nome}</span>
                  <span className="block text-xs text-ink-faint">
                    {opcional.produtoEstoque?.nome
                      ? `Estoque: ${opcional.produtoEstoque.nome}`
                      : 'Sem baixa de estoque'}
                  </span>
                </span>
              </label>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm text-ink-muted">{formatCurrency(Number(opcional.preco))}</span>
                <button type="button" className="icon-btn" title="Editar" aria-label={`Editar ${opcional.nome}`} onClick={() => {
                  setEditandoId(opcional.id);
                  setEditandoNome(opcional.nome);
                  setEditandoPreco(formatCurrencyInputFromNumber(opcional.preco));
                  setEditandoEstoqueId(opcional.produtoEstoqueId ?? opcional.produtoEstoque?.id ?? '');
                }}><IconPencil className="h-4 w-4" /></button>
                <button type="button" className="icon-btn" title={opcional.ativo ? 'Desativar' : 'Ativar'} aria-label={`${opcional.ativo ? 'Desativar' : 'Ativar'} ${opcional.nome}`} onClick={() => alternarAtivo(opcional)}>
                  {opcional.ativo ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
                </button>
                <button type="button" className="icon-btn-danger" title="Excluir" aria-label={`Excluir ${opcional.nome}`} onClick={() => excluir(opcional)}><IconTrash className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
          {catalogo.length === 0 && <p className="rounded-xl border border-line px-4 py-5 text-center text-sm text-ink-faint">Nenhum opcional cadastrado.</p>}
        </div>
        {!mostrarCadastro ? (
          <button type="button" className="touch-btn-ghost w-full" onClick={() => setMostrarCadastro(true)}>+ Novo opcional</button>
        ) : (
          <div className="space-y-3 rounded-xl border border-line p-3">
            <p className="font-semibold">Novo opcional</p>
            <label className="block text-sm">Nome<input className="input mt-1 w-full" placeholder="Ex.: Queijo extra" value={novoNome} onChange={(event) => setNovoNome(event.target.value)} /></label>
            <label className="block text-sm">Preço{precoInput('Preço do novo opcional', novoPreco, setNovoPreco)}</label>
            {selectEstoque(novoEstoqueId, setNovoEstoqueId, 'Estoque do novo opcional')}
            <div className="flex gap-2">
              <button type="button" className="touch-btn-primary flex-1" onClick={criar}>Adicionar</button>
              <button type="button" className="touch-btn-secondary flex-1" onClick={() => setMostrarCadastro(false)}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
