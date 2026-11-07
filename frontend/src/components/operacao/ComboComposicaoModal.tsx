import { useEffect, useState } from 'react';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { formatCurrencyInputFromNumber, parseCurrencyInput } from '../../lib/currency';
import { precoBaseCombo, type ComposicaoCombo } from '../../lib/combo';
import { Modal } from '../Modal';
import { CurrencyInput } from '../CurrencyInput';
import { IconTrash } from '../NavIcons';

export type ProdutoParaCombo = { id: string; nome: string; categoria: string | null; precoUnit: string | number };

type OpcaoForm = { produtoId: string; precoNoCombo: string; quantidade: number };
type GrupoForm = { chave: string; nome: string; minimo: number; maximo: number; somenteCardapioTurno: boolean; opcoes: OpcaoForm[] };

let proximaChave = 0;
const novaChave = () => `grupo-${++proximaChave}`;
const grupoVazio = (): GrupoForm => ({ chave: novaChave(), nome: '', minimo: 1, maximo: 1, somenteCardapioTurno: false, opcoes: [] });

export function ComboComposicaoModal({
  open,
  onClose,
  onSaved,
  comboId,
  comboNome,
  produtos,
  usaCardapio,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  comboId: string;
  comboNome: string;
  produtos: ProdutoParaCombo[];
  usaCardapio: boolean;
}) {
  const [grupos, setGrupos] = useState<GrupoForm[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!open) return;
    setErro('');
    setCarregando(true);
    api.get<ComposicaoCombo>(`/api/operacao/produtos/${comboId}/combo`)
      .then((composicao) => setGrupos(composicao.grupos.length
        ? composicao.grupos.map((grupo) => ({
          chave: novaChave(),
          nome: grupo.nome,
          minimo: grupo.minimo,
          maximo: grupo.maximo,
          somenteCardapioTurno: grupo.somenteCardapioTurno,
          opcoes: grupo.opcoes.map((opcao) => ({ produtoId: opcao.produtoId, precoNoCombo: formatCurrencyInputFromNumber(opcao.precoNoCombo), quantidade: opcao.quantidade })),
        }))
        : [grupoVazio()]))
      .catch((error) => setErro(error instanceof ApiError ? error.message : 'Não foi possível carregar a composição'))
      .finally(() => setCarregando(false));
  }, [open, comboId]);

  const produtoPorId = new Map(produtos.map((produto) => [produto.id, produto]));
  const categorias = [...new Set(produtos.map((produto) => produto.categoria?.trim() || 'Outros'))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const alterarGrupo = (chave: string, alteracao: Partial<GrupoForm>) =>
    setGrupos((atual) => atual.map((grupo) => grupo.chave === chave ? { ...grupo, ...alteracao } : grupo));
  const alterarOpcao = (chave: string, produtoId: string, alteracao: Partial<OpcaoForm>) =>
    setGrupos((atual) => atual.map((grupo) => grupo.chave === chave
      ? { ...grupo, opcoes: grupo.opcoes.map((opcao) => opcao.produtoId === produtoId ? { ...opcao, ...alteracao } : opcao) }
      : grupo));
  const adicionarProdutos = (chave: string, novos: ProdutoParaCombo[]) =>
    setGrupos((atual) => atual.map((grupo) => {
      if (grupo.chave !== chave) return grupo;
      const presentes = new Set(grupo.opcoes.map((opcao) => opcao.produtoId));
      const adicionados = novos.filter((produto) => !presentes.has(produto.id))
        .map((produto) => ({ produtoId: produto.id, precoNoCombo: formatCurrencyInputFromNumber(produto.precoUnit), quantidade: 1 }));
      return { ...grupo, opcoes: [...grupo.opcoes, ...adicionados] };
    }));

  const gruposCalculo = grupos.map((grupo) => ({
    minimo: grupo.minimo,
    opcoes: grupo.opcoes.map((opcao) => ({ precoNoCombo: parseCurrencyInput(opcao.precoNoCombo), quantidade: opcao.quantidade })),
  }));
  const aPartirDe = precoBaseCombo(gruposCalculo);

  const salvar = async () => {
    setErro('');
    const semNome = grupos.find((grupo) => !grupo.nome.trim());
    if (semNome) return setErro('Dê um nome para cada grupo');
    const vazio = grupos.find((grupo) => grupo.opcoes.length === 0);
    if (vazio) return setErro(`Inclua ao menos um produto em "${vazio.nome}"`);
    if (!grupos.some((grupo) => grupo.minimo >= 1)) return setErro('Ao menos um grupo precisa ser obrigatório (mínimo 1)');
    setSalvando(true);
    try {
      await api.put(`/api/operacao/produtos/${comboId}/combo`, {
        grupos: grupos.map((grupo) => ({
          nome: grupo.nome.trim(),
          minimo: grupo.minimo,
          maximo: grupo.maximo,
          somenteCardapioTurno: grupo.somenteCardapioTurno,
          opcoes: grupo.opcoes.map((opcao) => ({ produtoId: opcao.produtoId, precoNoCombo: parseCurrencyInput(opcao.precoNoCombo), quantidade: opcao.quantidade })),
        })),
      });
      onSaved();
      onClose();
    } catch (error) {
      setErro(error instanceof ApiError ? error.message : 'Não foi possível salvar a composição');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Composição — ${comboNome}`}
      hideHeaderClose
      footer={(
        <>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-ink-faint">Preço a partir de</span>
            <span className="text-xl font-bold">{formatCurrency(aPartirDe)}</span>
          </div>
          <button type="button" className="touch-btn-primary w-full" onClick={salvar} disabled={salvando || carregando}>
            {salvando ? 'Salvando...' : 'Salvar composição'}
          </button>
          <button type="button" className="touch-btn-orange w-full" onClick={onClose} disabled={salvando}>Fechar</button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          Monte os grupos de escolha. O preço do combo é a soma dos preços dentro do combo dos itens escolhidos.
          Um item fixo é um grupo com um só produto.
        </p>
        {erro && <div className="alert-error">{erro}</div>}
        {carregando ? <p role="status" className="text-sm text-ink-muted">Carregando composição...</p> : grupos.map((grupo, indice) => {
          const disponiveis = produtos.filter((produto) => !grupo.opcoes.some((opcao) => opcao.produtoId === produto.id));
          return (
            <section key={grupo.chave} className="space-y-3 rounded-xl border border-line p-3" aria-label={`Grupo ${indice + 1}`}>
              <div className="flex items-end gap-2">
                <label className="block min-w-0 flex-1 text-sm">
                  Nome do grupo
                  <input className="input mt-1 w-full" placeholder="Ex.: Escolha o churrasquinho" maxLength={80} value={grupo.nome} onChange={(event) => alterarGrupo(grupo.chave, { nome: event.target.value })} />
                </label>
                <button type="button" className="icon-btn-danger mb-1" title="Remover grupo" aria-label={`Remover grupo ${grupo.nome || indice + 1}`} onClick={() => setGrupos((atual) => atual.filter((item) => item.chave !== grupo.chave))}>
                  <IconTrash className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm">
                  Mínimo
                  <input className="input mt-1 w-full" type="number" min={0} max={grupo.maximo} value={grupo.minimo} onChange={(event) => alterarGrupo(grupo.chave, { minimo: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })} />
                </label>
                <label className="block text-sm">
                  Máximo
                  <input className="input mt-1 w-full" type="number" min={1} value={grupo.maximo} onChange={(event) => alterarGrupo(grupo.chave, { maximo: Math.max(1, Math.trunc(Number(event.target.value) || 1)) })} />
                </label>
              </div>
              <p className="text-xs text-ink-faint">
                {grupo.minimo === 0 ? 'Opcional' : 'Obrigatório'} · o cliente escolhe {grupo.minimo === grupo.maximo ? grupo.maximo : `de ${grupo.minimo} a ${grupo.maximo}`}
              </p>
              {usaCardapio && (
                <label className="flex cursor-pointer items-center gap-3 text-sm">
                  <input type="checkbox" className="h-5 w-5 accent-brand-500" checked={grupo.somenteCardapioTurno} onChange={(event) => alterarGrupo(grupo.chave, { somenteCardapioTurno: event.target.checked })} />
                  Só oferecer produtos que estão no cardápio do turno
                </label>
              )}

              <div className="space-y-2">
                {grupo.opcoes.map((opcao) => {
                  const produto = produtoPorId.get(opcao.produtoId);
                  return (
                    <div key={opcao.produtoId} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{produto?.nome ?? 'Produto indisponível'}</p>
                        {produto && <p className="text-xs text-ink-faint">Avulso: {formatCurrency(Number(produto.precoUnit))}</p>}
                      </div>
                      <input className="input w-16" type="number" min={1} max={20} aria-label={`Quantidade de ${produto?.nome ?? 'produto'}`} title="Quantidade" value={opcao.quantidade} onChange={(event) => alterarOpcao(grupo.chave, opcao.produtoId, { quantidade: Math.min(20, Math.max(1, Math.trunc(Number(event.target.value) || 1))) })} />
                      <CurrencyInput className="input w-28" aria-label={`Preço no combo de ${produto?.nome ?? 'produto'}`} value={opcao.precoNoCombo} onChange={(precoNoCombo) => alterarOpcao(grupo.chave, opcao.produtoId, { precoNoCombo })} />
                      <button type="button" className="icon-btn-danger" title="Remover" aria-label={`Remover ${produto?.nome ?? 'produto'}`} onClick={() => alterarGrupo(grupo.chave, { opcoes: grupo.opcoes.filter((item) => item.produtoId !== opcao.produtoId) })}>
                        <IconTrash className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <select className="input" aria-label="Adicionar produto ao grupo" value="" onChange={(event) => {
                  const produto = produtoPorId.get(event.target.value);
                  if (produto) adicionarProdutos(grupo.chave, [produto]);
                }}>
                  <option value="">+ Adicionar produto</option>
                  {disponiveis.map((produto) => <option key={produto.id} value={produto.id}>{produto.nome}</option>)}
                </select>
                <select className="input" aria-label="Adicionar todos de uma categoria" value="" onChange={(event) => {
                  const categoria = event.target.value;
                  if (categoria) adicionarProdutos(grupo.chave, disponiveis.filter((produto) => (produto.categoria?.trim() || 'Outros') === categoria));
                }}>
                  <option value="">+ Adicionar todos da categoria</option>
                  {categorias.map((categoria) => <option key={categoria} value={categoria}>{categoria}</option>)}
                </select>
              </div>
            </section>
          );
        })}
        {!carregando && <button type="button" className="touch-btn-ghost w-full" onClick={() => setGrupos((atual) => [...atual, grupoVazio()])}>+ Grupo</button>}
      </div>
    </Modal>
  );
}
