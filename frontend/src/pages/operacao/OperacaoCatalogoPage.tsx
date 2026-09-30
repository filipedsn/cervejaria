import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Loading } from '../../components/Loading';
import { EmptyState } from '../../components/EmptyState';
import { MobileActionBar } from '../../components/MobileActionBar';
import { CurrencyInput } from '../../components/CurrencyInput';
import { parseCurrencyInput, formatCurrencyInputFromNumber } from '../../lib/currency';
import { useAuth } from '../../contexts/AuthContext';
import { useOperacaoContexto } from '../../hooks/useOperacaoContexto';
import { invalidateOnboardingReadiness } from '../../lib/onboarding';
import {
  CATEGORIAS_PRODUTO_OPERACAO,
  isChopeOperacao,
  normalizeCategoriaProduto,
  type CategoriaProdutoOperacao,
} from '../../lib/operacao';
import { FOOD_UNIT_ML, VOLUMES, type FormatoBebida } from '../../types';
import { CardapiosOperacaoPage } from './CardapiosOperacaoPage';
import { ProdutoOpcionaisModal } from '../../components/ProdutoOpcionaisModal';

const TABS = [
  { id: 'catalogo', label: 'Catálogo' },
  { id: 'cardapios', label: 'Cardápios salvos' },
] as const;

type TabId = (typeof TABS)[number]['id'];
type PrecoVolumeForm = { volumeMl: number; preco: string };

interface ProdutoOperacao {
  id: string;
  nome: string;
  categoria: string | null;
  precoUnit: string;
  tipo?: 'BEBIDA' | 'COMIDA';
  formato?: FormatoBebida | null;
  descricao?: string | null;
  estilo?: string | null;
  precos?: Array<{ volumeMl: number; preco: number | string }>;
  exigePreparo: boolean;
  controlaEstoque: boolean;
  ativo: boolean;
  ordem: number;
  gruposOpcionais?: unknown[];
}

const FORM_VAZIO = {
  nome: '',
  categoria: 'Bebidas' as CategoriaProdutoOperacao,
  descricao: '',
  estilo: '',
  precoUnit: '',
  precos: VOLUMES.map((volumeMl) => ({ volumeMl, preco: '' })) as PrecoVolumeForm[],
  formato: 'OUTRO' as FormatoBebida,
  exigePreparo: false,
  controlaEstoque: true,
};

const CATEGORIAS_COMIDA = new Set(['Porções', 'Lanches', 'Salgados', 'Doces e sobremesas']);

export function OperacaoCatalogoPage({ modo }: { modo?: 'caixa' | 'evento' } = {}) {
  const queryClient = useQueryClient();
  const { isDono } = useAuth();
  const { contexto } = useOperacaoContexto();
  const modoAtual = modo ?? (contexto.operationMode === 'EVENTO' ? 'evento' : 'caixa');
  const usaCardapio = contexto.ativo ? (contexto.usaCardapio ?? false) : false;
  const tabs = TABS.filter((t) => t.id !== 'cardapios' || usaCardapio);
  const [tab, setTab] = useState<TabId>('catalogo');
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState<ProdutoOperacao | null>(null);
  const [form, setForm] = useState({ ...FORM_VAZIO });
  const [error, setError] = useState('');
  const [opcionaisProduto, setOpcionaisProduto] = useState<ProdutoOperacao | null>(null);

  const controlaEstoque = contexto.ativo && contexto.controlaEstoque;
  const temCozinha = contexto.ativo && contexto.temCozinha;

  const { data: produtos, isLoading } = useQuery({
    queryKey: ['operacao-produtos'],
    queryFn: () => api.get<ProdutoOperacao[]>('/api/operacao/produtos?incluirInativos=true'),
  });

  const fechar = () => {
    setShowModal(false);
    setEditando(null);
    setForm({ ...FORM_VAZIO });
    setError('');
  };

  const abrirNovo = () => {
    setEditando(null);
    setForm({ ...FORM_VAZIO });
    setError('');
    setShowModal(true);
  };

  const abrirEdicao = (produto: ProdutoOperacao) => {
    setEditando(produto);
    const produtoChope = isChopeOperacao(produto);
    const volumes = [...new Set([...VOLUMES, ...(produto.precos ?? []).map((item) => item.volumeMl).filter((volumeMl) => volumeMl > FOOD_UNIT_ML)])].sort((a, b) => a - b);
    setForm({
      nome: produto.nome,
      categoria: produtoChope ? 'Chope' : normalizeCategoriaProduto(produto.categoria),
      descricao: produto.descricao ?? '',
      estilo: produto.estilo ?? '',
      precoUnit: formatCurrencyInputFromNumber(produto.precoUnit),
      precos: volumes.map((volumeMl) => {
        const preco = produto.precos?.find((item) => item.volumeMl === volumeMl);
        return { volumeMl, preco: preco ? formatCurrencyInputFromNumber(preco.preco) : '' };
      }),
      formato: produtoChope ? 'CHOPE' : produto.formato ?? 'OUTRO',
      exigePreparo: produto.exigePreparo,
      controlaEstoque: produto.controlaEstoque,
    });
    setError('');
    setShowModal(true);
  };

  const salvar = useMutation({
    mutationFn: () => {
      // Categorias comuns organizam a exibicao; em produtos existentes nao
      // reclassificam tipo/formato ao alterar nome, preco ou categoria. A
      // classificacao so e enviada ao criar ou ao mudar para/de Chope.
      const classificacaoOriginalChope = editando ? isChopeOperacao(editando) : false;
      const classificacaoIntencional = !editando || classificacaoOriginalChope !== (form.categoria === 'Chope');
      const corpo = {
        nome: form.nome.trim(),
        categoria: form.categoria,
        ...(classificacaoIntencional
          ? {
              tipo: form.categoria === 'Chope' ? 'BEBIDA' : CATEGORIAS_COMIDA.has(form.categoria) ? 'COMIDA' : 'BEBIDA',
              formato: form.categoria === 'Chope' ? 'CHOPE' : 'OUTRO',
            }
          : {}),
        descricao: form.categoria === 'Chope' ? form.descricao.trim() || undefined : undefined,
        estilo: form.categoria === 'Chope' ? form.estilo.trim() || undefined : undefined,
        ...(form.categoria === 'Chope'
          ? { precos: form.precos.filter((preco) => parseCurrencyInput(preco.preco) > 0).map((preco) => ({ volumeMl: preco.volumeMl, preco: parseCurrencyInput(preco.preco) })) }
          : { precoUnit: parseCurrencyInput(form.precoUnit), precos: [{ volumeMl: FOOD_UNIT_ML, preco: parseCurrencyInput(form.precoUnit) }] }),
        exigePreparo: form.categoria === 'Chope' ? false : form.exigePreparo,
        controlaEstoque: form.controlaEstoque,
      };
      return editando
        ? api.put(`/api/operacao/produtos/${editando.id}`, corpo)
        : api.post('/api/operacao/produtos', corpo);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operacao-produtos'] });
      invalidateOnboardingReadiness(queryClient);
      fechar();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao salvar produto'),
  });

  const alternarAtivo = useMutation({
    mutationFn: (produto: ProdutoOperacao) =>
      api.put(`/api/operacao/produtos/${produto.id}`, { ativo: !produto.ativo }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operacao-produtos'] }),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const preco = parseCurrencyInput(form.precoUnit);
    if (!form.nome.trim()) return setError('Informe o nome do produto');
    if (form.categoria === 'Chope') {
      if (!form.precos.some((item) => parseCurrencyInput(item.preco) > 0)) return setError('Informe pelo menos um preço por volume');
    } else if (!preco || preco <= 0) return setError('Informe um preço maior que zero');
    setError('');
    salvar.mutate();
  };

  if (isLoading && tab === 'catalogo') return <Loading />;

  return (
    <div className={`space-y-4 ${isDono && tab === 'catalogo' ? 'page-with-action-bar' : 'pb-2'}`}>
      <div className="min-w-0">
        <h2 className="text-xl font-bold">Cardápio</h2>
        <p className="text-sm text-ink-faint">
          {modoAtual === 'evento'
            ? 'Catálogo de produtos e cardápios reutilizáveis em eventos.'
            : 'Catálogo de produtos e templates para os turnos de caixa.'}
        </p>
      </div>

      <div className="segmented-control">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`segmented-control-btn ${
              tab === id ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'
            }`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'cardapios' && usaCardapio && isDono && <CardapiosOperacaoPage embedded modo={modoAtual} />}
      {tab === 'cardapios' && usaCardapio && !isDono && (
        <p className="text-sm text-ink-faint text-center py-6">Somente o dono pode gerenciar cardápios salvos.</p>
      )}

      {tab === 'catalogo' && (
        <>
      <div className="min-w-0">
        <h3 className="text-base font-semibold">Catálogo</h3>
        <p className="text-sm text-ink-faint">
          Produtos vendidos por unidade, separados do catálogo de chope.
        </p>
      </div>

      {produtos?.length === 0 && (
        <EmptyState
          icon="📋"
          title="Nenhum produto ainda"
          description="Cadastre o que o operacao vende para liberar a venda rápida."
        />
      )}

      <div className="space-y-2">
        {produtos?.map((produto) => (
          <div key={produto.id} className="card-touch py-3">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                disabled={!isDono}
                onClick={() => isDono && abrirEdicao(produto)}
              >
                <p className={`font-semibold truncate ${produto.ativo ? '' : 'text-ink-faint line-through'}`}>
                  {produto.nome}
                </p>
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                  {isChopeOperacao(produto) && produto.precos?.some((preco) => preco.volumeMl > FOOD_UNIT_ML)
                    ? produto.precos.filter((preco) => preco.volumeMl > FOOD_UNIT_ML).map((preco) => (
                        <span key={preco.volumeMl}>{preco.volumeMl}ml: {formatCurrency(preco.preco)}</span>
                      ))
                    : <span>{formatCurrency(produto.precoUnit)}</span>}
                  {produto.categoria && (
                    <span>· {normalizeCategoriaProduto(produto.categoria)}</span>
                  )}
                  {temCozinha && produto.exigePreparo && (
                    <span className="rounded-full bg-orange/10 px-2 py-0.5 font-semibold text-orange">
                      cozinha
                    </span>
                  )}
                  {controlaEstoque && !produto.controlaEstoque && (
                    <span className="rounded-full bg-surface-lighter px-2 py-0.5">sem estoque</span>
                  )}
                </p>
              </button>
              {isDono && (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="touch-btn-ghost touch-btn-sm"
                    onClick={() => alternarAtivo.mutate(produto)}
                  >
                    {produto.ativo ? 'Desativar' : 'Ativar'}
                  </button>
                  <button
                    type="button"
                    className="touch-btn-ghost touch-btn-sm"
                    onClick={() => abrirEdicao(produto)}
                  >
                    Editar
                  </button>
                  <button type="button" className="touch-btn-ghost touch-btn-sm" onClick={() => setOpcionaisProduto(produto)}>Opcionais</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {isDono && (
        <MobileActionBar>
          <button type="button" className="touch-btn-primary w-full" onClick={abrirNovo} data-onboarding-target="operacao-add-product">
            + Produto
          </button>
        </MobileActionBar>
      )}

      <Modal
        open={showModal}
        onClose={fechar}
        title={editando ? `Editar — ${editando.nome}` : 'Novo produto'}
        hideHeaderClose
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="alert-error">{error}</div>}

          <div>
            <label className="label">Categoria</label>
            <div className="chip-picker" role="group" aria-label="Categoria do produto">
              {[...CATEGORIAS_PRODUTO_OPERACAO, ...(contexto.tapsEnabled ? ['Chope' as const] : [])].map((categoria) => (
                <button
                  key={categoria}
                  type="button"
                  aria-pressed={form.categoria === categoria}
                  onClick={() => setForm({ ...form, categoria, formato: categoria === 'Chope' ? 'CHOPE' : 'OUTRO', exigePreparo: categoria === 'Chope' ? false : form.exigePreparo })}
                  className={`chip-picker-btn ${
                    form.categoria === categoria
                      ? 'segmented-control-btn-active'
                      : 'segmented-control-btn-inactive'
                  }`}
                >
                  {categoria}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Nome</label>
            <input
              className="input"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              required
            />
          </div>

          {form.categoria === 'Chope' && !contexto.tapsEnabled ? (
            <p className="rounded-xl border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-800">Ative “Torneiras de chope” nas configurações para editar este produto.</p>
          ) : form.categoria === 'Chope' ? (
            <>
              <div>
                <label className="label">Descrição (opcional)</label>
                <input className="input" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Marca, origem..." />
              </div>
              <div>
                <label className="label">Estilo</label>
                <input className="input" value={form.estilo} onChange={(e) => setForm({ ...form, estilo: e.target.value })} placeholder="Pilsen, IPA, Weiss..." />
              </div>
              <div className="space-y-2">
                <label className="label">Preços por volume</label>
                {form.precos.map((item, index) => (
                  <div key={item.volumeMl} className="flex items-center gap-2">
                    <span className="w-16 text-ink-muted">{item.volumeMl}ml</span>
                    <CurrencyInput className="input flex-1" value={item.preco} onChange={(preco) => setForm((atual) => ({ ...atual, precos: atual.precos.map((linha, i) => i === index ? { ...linha, preco } : linha) }))} />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div>
              <label className="label">Preço</label>
              <CurrencyInput value={form.precoUnit} onChange={(precoUnit) => setForm({ ...form, precoUnit })} required />
            </div>
          )}

          {temCozinha && form.categoria !== 'Chope' && (
            <label className="card flex cursor-pointer items-start gap-3 py-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0 accent-brand-400"
                checked={form.exigePreparo}
                onChange={(e) => setForm({ ...form, exigePreparo: e.target.checked })}
              />
              <span className="min-w-0">
                <span className="block font-semibold">Vai para a cozinha</span>
                <span className="block text-xs text-ink-faint">
                  Gera pedido de preparo na fila, por ordem de chegada.
                </span>
              </span>
            </label>
          )}

          {controlaEstoque && (
            <label className="card flex cursor-pointer items-start gap-3 py-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0 accent-brand-400"
                checked={form.controlaEstoque}
                onChange={(e) => setForm({ ...form, controlaEstoque: e.target.checked })}
              />
              <span className="min-w-0">
                <span className="block font-semibold">Controlar estoque</span>
                <span className="block text-xs text-ink-faint">
                  Desmarque para itens sem contagem, como gelo ou copo.
                </span>
              </span>
            </label>
          )}

          <button type="submit" className="touch-btn-primary w-full" disabled={salvar.isPending || (form.categoria === 'Chope' && !contexto.tapsEnabled)}>
            {salvar.isPending ? 'Salvando...' : 'Salvar'}
          </button>
          <button type="button" className="touch-btn-orange w-full" onClick={fechar}>
            Fechar
          </button>
        </form>
      </Modal>
      {opcionaisProduto && <ProdutoOpcionaisModal open={!!opcionaisProduto} onClose={() => setOpcionaisProduto(null)} produtoId={opcionaisProduto.id} produtoNome={opcionaisProduto.nome} baseUrl="/api/operacao/produtos" />}
        </>
      )}
    </div>
  );
}
