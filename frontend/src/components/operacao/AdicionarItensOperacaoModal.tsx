import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '../Modal';
import { GradeProdutos } from './GradeProdutos';
import { ResumoCarrinho } from './ResumoCarrinho';
import { IconChefHat, IconClipboard, IconPackage, IconPlus } from '../NavIcons';
import { api, formatCurrency } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  classificarGrupoProdutoOperacao,
  isChopeOperacao,
  normalizeCategoriaProduto,
  limiteQuantidadeProdutoNoCarrinho,
  podeIncrementarQuantidadeProduto,
  totalCarrinho,
  type LinhaCarrinho,
  type ProdutoOperacao,
  type SaldoEstoque,
  type TapsTurnoResposta,
} from '../../lib/operacao';

type Config = {
  quantidade?: number;
  tapId?: string;
  volumeMl?: number;
  precoUnit?: number;
  paraViagem?: boolean;
  observacao?: string;
  opcionais?: { opcionalId: string; nome: string; precoAdicional: number; quantidade: number }[];
};

const IconHash = IconPackage;
type AbaItens = string;
const ABA_TAP_CHOPE = '__tap_chope__';

export function AdicionarItensOperacaoModal({
  open,
  onClose,
  pontoVendaId,
  sessaoCaixaId,
  tapsEnabled,
  produtos,
  linhas,
  onSelecionar,
  onAlterar,
  onConfirm,
  isPending,
  error,
  successMessage,
  saldos,
  controlaEstoque,
  confirmLabel = 'Adicionar itens',
}: {
  open: boolean;
  onClose: () => void;
  pontoVendaId: string;
  sessaoCaixaId?: string;
  tapsEnabled: boolean;
  produtos: ProdutoOperacao[];
  linhas: LinhaCarrinho[];
  onSelecionar: (produto: ProdutoOperacao, configuracao?: Config) => void;
  onAlterar: (produtoId: string, delta: number, tapId?: string, volumeMl?: number) => void;
  onConfirm: () => void;
  isPending: boolean;
  error?: string;
  successMessage?: string;
  saldos?: Map<string, SaldoEstoque>;
  controlaEstoque: boolean;
  confirmLabel?: string;
}) {
  const { canPermission } = useAuth();
  const [produto, setProduto] = useState<ProdutoOperacao | null>(null);
  const [aba, setAba] = useState<AbaItens>('comidas');
  const [quantidade, setQuantidadeState] = useState(1);
  const quantidadeProdutoNoCarrinho = (item: ProdutoOperacao) => linhas
    .filter((linha) => linha.produto.id === item.id && !isChopeOperacao(linha.produto))
    .reduce((soma, linha) => soma + linha.quantidade, 0);
  const setQuantidade = (atualizar: number | ((atual: number) => number)) => {
    setQuantidadeState((atual) => {
      const proxima = typeof atualizar === 'function' ? atualizar(atual) : atualizar;
      if (!produto) return proxima;
      const limite = limiteQuantidadeProdutoNoCarrinho(
        produto,
        saldos,
        controlaEstoque,
        quantidadeProdutoNoCarrinho(produto),
      );
      if (limite === null) return proxima;
      if (limite <= 0) return atual;
      if (proxima > atual && !podeIncrementarQuantidadeProduto(atual, limite)) return atual;
      return Math.max(1, Math.min(proxima, limite));
    });
  };
  const [tapId, setTapId] = useState('');
  const [produtoMontadoSelecionado, setProdutoMontadoSelecionado] = useState<string | null | undefined>();
  const [montagemAlterada, setMontagemAlterada] = useState(false);
  const [volumeMl, setVolumeMl] = useState<number | undefined>();
  const [paraViagemItem, setParaViagemItem] = useState(false);
  const [observacao, setObservacao] = useState('');
  const [opcionais, setOpcionais] = useState<Record<string, number>>({});

  const contextoTapRef = useRef(`${pontoVendaId}:${sessaoCaixaId ?? ''}`);
  const { data: tapsData, isLoading: carregandoTaps, isFetching: atualizandoTaps, error: erroCarregarTaps, refetch: recarregarTaps } = useQuery({
    queryKey: ['operacao-caixa-taps', pontoVendaId, sessaoCaixaId ?? ''],
    queryFn: () => api.get<TapsTurnoResposta>(`/api/operacao/caixa/taps?pontoVendaId=${encodeURIComponent(pontoVendaId)}${sessaoCaixaId ? `&sessaoCaixaId=${encodeURIComponent(sessaoCaixaId)}` : ''}`),
    enabled: open && tapsEnabled && Boolean(pontoVendaId),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: open ? 15_000 : false,
  });
  const { data: categoriasComanda } = useQuery({
    queryKey: ['comanda-categorias-ordem'],
    queryFn: () => api.get<{ ordem: string[]; catalogoCanonico?: boolean }>('/api/produtos/categorias-comanda/ordem'),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const ordemInicial = categoriasComanda?.ordem ?? ['chope', 'comidas', 'bebidas', 'outros'];

  useEffect(() => {
    const contextoAtual = `${pontoVendaId}:${sessaoCaixaId ?? ''}`;
    if (contextoTapRef.current === contextoAtual) return;
    contextoTapRef.current = contextoAtual;
    setTapId('');
    setProdutoMontadoSelecionado(undefined);
    setVolumeMl(undefined);
    setProduto(null);
    setMontagemAlterada(false);
  }, [pontoVendaId, sessaoCaixaId]);

  useEffect(() => {
    if (!open) return;
    const disponiveis = new Set<string>(['comidas', 'bebidas', 'outros']);
    if (tapsEnabled) disponiveis.add('chope');
    setAba((ordemInicial.find((categoria) => disponiveis.has(categoria)) ?? 'comidas') as AbaItens);
  }, [open, tapsEnabled, categoriasComanda?.ordem]);

  const produtoEhChope = produto ? isChopeOperacao(produto) : false;
  const tapsAtivas = (tapsData?.taps ?? []).filter((tap) => tap.ativo);
  const tapsDoProduto = produtoEhChope
    ? tapsAtivas.filter((tap) => tap.chopeAtual?.id === produto?.id)
    : [];
  const tapSelecionado = tapsAtivas.find((tap) => tap.id === tapId) ?? null;
  const produtoDoTap = tapSelecionado?.chopeAtual
    ? produtos.find((item) => item.id === tapSelecionado.chopeAtual!.id && item.ativo && isChopeOperacao(item)) ?? null
    : null;
  const precosPorVolumeNoCardapio = produtoDoTap
    ? produtos
        .filter((item) => item.id === produtoDoTap.id && item.ativo && (item.volumeMl ?? 0) > 1)
        .map((item) => ({ volumeMl: item.volumeMl!, preco: Number(item.precoEfetivo ?? item.precoUnit) }))
    : [];
  const volumesDoTap = precosPorVolumeNoCardapio.length
    ? [...new Map(precosPorVolumeNoCardapio.map((item) => [item.volumeMl, item])).values()].sort((a, b) => a.volumeMl - b.volumeMl)
    : (produtoDoTap?.precos ?? [])
        .filter((preco) => preco.volumeMl > 1)
        .map((preco) => ({ volumeMl: preco.volumeMl, preco: Number(preco.preco) }))
        .sort((a, b) => a.volumeMl - b.volumeMl);
  const volumeDoTapSelecionado = volumesDoTap.find((item) => item.volumeMl === volumeMl);
  const precoSelecionado = produtoEhChope
    ? Number(volumeDoTapSelecionado?.preco ?? 0)
    : Number(produto?.precoEfetivo ?? produto?.precoUnit ?? 0);
  useEffect(() => {
    if (!open || !tapsData || !tapId || produtoMontadoSelecionado === undefined) return;
    const tapAtual = tapsData.taps.find((tap) => tap.id === tapId && tap.ativo);
    const produtoMontadoAtual = tapAtual?.chopeAtual?.id ?? null;
    const turnoDiferente = Boolean(sessaoCaixaId && tapsData.sessaoCaixaId && tapsData.sessaoCaixaId !== sessaoCaixaId);
    if (turnoDiferente || !tapAtual || produtoMontadoAtual !== produtoMontadoSelecionado
      || (produto && (produto.id !== produtoMontadoAtual || !produtoDoTap))) {
      setTapId('');
      setProdutoMontadoSelecionado(undefined);
      setVolumeMl(undefined);
      setProduto(null);
      setMontagemAlterada(true);
      return;
    }
    if (volumeMl && !volumesDoTap.some((item) => item.volumeMl === volumeMl && item.preco > 0)) {
      setVolumeMl(undefined);
      setMontagemAlterada(true);
    }
  }, [open, tapsData, tapId, sessaoCaixaId, produtoMontadoSelecionado, produto, produtoDoTap, volumeMl, volumesDoTap]);
  const produtoIdChope = tapSelecionado?.chopeAtual?.id;
  const litrosNoCarrinhoChope = produtoIdChope
    ? linhas.filter((linha) => linha.produto.id === produtoIdChope && isChopeOperacao(linha.produto))
        .reduce((total, linha) => total + ((linha.volumeMl ?? 0) * linha.quantidade) / 1000, 0)
    : 0;
  const saldoChope = produtoIdChope ? saldos?.get(produtoIdChope) : undefined;
  const precoVolumeSelecionado = volumesDoTap.find((item) => item.volumeMl === volumeMl)?.preco ?? 0;
  const podeAdicionarChope = Boolean(
    tapSelecionado && produtoDoTap && volumeMl && volumesDoTap.some((item) => item.volumeMl === volumeMl && item.preco > 0)
      && (!controlaEstoque || !produtoDoTap.controlaEstoque || !saldos
        || (saldoChope !== undefined && litrosNoCarrinhoChope + volumeMl * quantidade / 1000 <= saldoChope.quantidade + 1e-9)),
  );

  const produtosPorCategoria = new Map<string, ProdutoOperacao[]>();
  for (const item of produtos.filter((product) => categoriasComanda?.catalogoCanonico
    ? product.formato !== 'CHOPE'
    : !isChopeOperacao(product))) {
    const category = categoriasComanda?.catalogoCanonico
      ? item.categoria?.trim() || 'Outros'
      : normalizeCategoriaProduto(item.categoria);
    produtosPorCategoria.set(category, [...(produtosPorCategoria.get(category) ?? []), item]);
  }
  const produtosBebidas = produtos.filter((item) => classificarGrupoProdutoOperacao(item) === 'bebidas');
  const produtosComidas = produtos.filter((item) => classificarGrupoProdutoOperacao(item) === 'comidas');
  const produtosOutros = produtos.filter((item) => classificarGrupoProdutoOperacao(item) === 'outros');
  const tabsLegacy = [
    ...(tapsEnabled ? [{ id: ABA_TAP_CHOPE, label: 'Chopes' }] : []),
    ...(produtosComidas.length > 0 ? [{ id: 'comidas', label: 'Comidas' }] : []),
    ...(produtosBebidas.length > 0 ? [{ id: 'bebidas', label: 'Bebidas' }] : []),
    ...(produtosOutros.length > 0 ? [{ id: 'outros', label: 'Outros' }] : []),
  ].sort((a, b) => ordemInicial.indexOf(a.id === ABA_TAP_CHOPE ? 'chope' : a.id) - ordemInicial.indexOf(b.id === ABA_TAP_CHOPE ? 'chope' : b.id));
  const tapCategoryName = produtos.find((item) => item.id === tapsAtivas.find((tap) => tap.chopeAtual)?.chopeAtual?.id)?.categoria;
  const canonicalTabs = [
    ...(tapsEnabled ? [{ id: ABA_TAP_CHOPE, label: 'Chopes (Tap)' }] : []),
    ...[...produtosPorCategoria.keys()].map((category) => ({ id: category, label: category })),
  ].sort((a, b) => {
    const priority = (tab: { id: string }) => ordemInicial.indexOf(tab.id === ABA_TAP_CHOPE
      ? (categoriasComanda?.catalogoCanonico ? tapCategoryName?.trim() : normalizeCategoriaProduto(tapCategoryName)) ?? ''
      : tab.id);
    const aIndex = priority(a) < 0 ? Number.MAX_SAFE_INTEGER : priority(a);
    const bIndex = priority(b) < 0 ? Number.MAX_SAFE_INTEGER : priority(b);
    return aIndex - bIndex || a.label.localeCompare(b.label, 'pt-BR');
  });
  const abasVisiveis: { id: AbaItens; label: string }[] = categoriasComanda?.catalogoCanonico ? canonicalTabs : tabsLegacy;
  const abaSelecionada = abasVisiveis.some((item) => item.id === aba) ? aba : abasVisiveis[0]?.id;
  const produtosDaAba = categoriasComanda?.catalogoCanonico
    ? produtosPorCategoria.get(abaSelecionada ?? '') ?? []
    : abaSelecionada === 'bebidas' ? produtosBebidas : abaSelecionada === 'comidas' ? produtosComidas : produtosOutros;

  const selecionar = (item: ProdutoOperacao) => {
    setProduto(item);
    setQuantidade(1);
    setTapId('');
    setProdutoMontadoSelecionado(undefined);
    setMontagemAlterada(false);
    setVolumeMl(undefined);
    setParaViagemItem(false);
    setObservacao('');
    setOpcionais({});
    api.get<Array<{ opcional: { id: string; nome: string; preco: number | string } }>>(`/api/operacao/produtos/${item.id}/opcionais`)
      .then((vinculos) => {
        const opcoes = vinculos.map(({ opcional }) => ({ id: opcional.id, nome: opcional.nome, precoAdicional: Number(opcional.preco) }));
        setProduto((atual) => atual?.id === item.id ? { ...atual, gruposOpcionais: opcoes.length ? [{ id: 'opcionais', nome: 'Opcionais', obrigatorio: false, maximo: 99, opcoes }] : [] } : atual);
      })
      .catch(() => undefined);
  };

  const confirmar = () => {
    if (!produto) return;
    const limite = limiteQuantidadeProdutoNoCarrinho(
      produto,
      saldos,
      controlaEstoque,
      quantidadeProdutoNoCarrinho(produto),
    );
    if (limite !== null && quantidade > limite) return;
    const tapDeVenda = tapsAtivas.find((tap) => tap.id === tapId);
    if (produtoEhChope && (!tapDeVenda || tapDeVenda.chopeAtual?.id !== produto.id || !tapsDoProduto.some((tap) => tap.id === tapId) || !volumeMl || !(precoSelecionado > 0))) return;
    const opcoes = produto.gruposOpcionais?.flatMap((grupo) => grupo.opcoes.filter((opcao) => opcionais[opcao.id]).map((opcao) => ({ opcionalId: opcao.id, nome: opcao.nome, precoAdicional: Number(opcao.precoAdicional), quantidade: opcionais[opcao.id] }))) ?? [];
    onSelecionar(produto, {
      quantidade,
      tapId: produtoEhChope ? tapId : undefined,
      volumeMl: produtoEhChope ? volumeMl : undefined,
      precoUnit: produtoEhChope ? precoSelecionado : undefined,
      paraViagem: produtoEhChope ? false : paraViagemItem,
      observacao: produtoEhChope ? undefined : observacao.trim() || undefined,
      opcionais: produtoEhChope ? [] : opcoes,
    });
    setProduto(null);
  };

  const adicionarChopeNaLista = () => {
    if (!podeAdicionarChope || !tapSelecionado || !produtoDoTap || !volumeMl) return;
    const preco = volumesDoTap.find((item) => item.volumeMl === volumeMl)?.preco;
    if (!preco) return;
    onSelecionar(produtoDoTap, { quantidade, tapId: tapSelecionado.id, volumeMl, precoUnit: preco });
    setVolumeMl(undefined);
    setQuantidade(1);
    setObservacao('');
  };

  const selecionarTap = (tapIdNovo: string) => {
    const tap = tapsAtivas.find((item) => item.id === tapIdNovo);
    setTapId(tap?.id ?? '');
    setProdutoMontadoSelecionado(tap ? tap.chopeAtual?.id ?? null : undefined);
    setVolumeMl(undefined);
    setQuantidadeState(1);
    setMontagemAlterada(false);
  };

  const quantidadesNoCarrinho = new Map<string, number>();
  for (const linha of linhas) {
    const estoqueConsumido = isChopeOperacao(linha.produto)
      ? ((linha.volumeMl ?? 0) * linha.quantidade) / 1000
      : linha.quantidade;
    quantidadesNoCarrinho.set(linha.produto.id, (quantidadesNoCarrinho.get(linha.produto.id) ?? 0) + estoqueConsumido);
  }
  const limiteQuantidadeSelecionada = produto && !produtoEhChope
    ? limiteQuantidadeProdutoNoCarrinho(produto, saldos, controlaEstoque, quantidadeProdutoNoCarrinho(produto))
    : null;

  const footer = <><div>{linhas.length > 0 && <div className="space-y-3"><div className="max-h-32 overflow-y-auto"><ResumoCarrinho linhas={linhas} onAlterar={onAlterar} saldos={saldos} controlaEstoque={controlaEstoque} /></div><div className="flex items-baseline justify-between"><span className="text-sm text-ink-faint">Itens selecionados</span><span className="text-xl font-bold">{formatCurrency(totalCarrinho(linhas))}</span></div></div>}</div><button type="button" className="touch-btn-primary w-full" disabled={!linhas.length || isPending} onClick={onConfirm}>{isPending ? 'Salvando...' : confirmLabel}</button><button type="button" className="touch-btn-orange w-full" onClick={onClose} disabled={isPending}>Voltar</button></>;

  return <>
    <Modal open={open} onClose={onClose} title="Adicionar item" hideHeaderClose footer={footer}>
      <div className="space-y-4">
        {error && <div className="alert-error text-sm">{error}</div>}
        {successMessage && <div className="alert-success text-sm">{successMessage}</div>}
        {abasVisiveis.length > 0 ? <div className="segmented-control grid" style={{ gridTemplateColumns: `repeat(${abasVisiveis.length}, minmax(0, 1fr))` }}>
          {abasVisiveis.map((item) => (
            <button key={item.id} type="button" className={`segmented-control-btn ${abaSelecionada === item.id ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`} onClick={() => setAba(item.id)}>
              {item.label}
            </button>
          ))}
        </div> : <p className="rounded-xl border border-line bg-surface-lighter p-3 text-sm text-ink-muted">Nenhum item disponível para adicionar.</p>}
        {abaSelecionada === ABA_TAP_CHOPE && tapsEnabled ? (
          <div className="space-y-5">
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Escolha a Tap</h3>
              {carregandoTaps ? <p role="status" className="text-sm text-ink-muted">Carregando taps do turno...</p>
                : erroCarregarTaps ? <div role="alert" className="space-y-2 rounded-xl border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-200">
                  <p>Não foi possível carregar as taps: {erroCarregarTaps instanceof Error ? erroCarregarTaps.message : 'erro inesperado'}</p>
                  <button type="button" className="touch-btn-secondary" onClick={() => void recarregarTaps()} disabled={atualizandoTaps}>{atualizandoTaps ? 'Atualizando...' : 'Tentar novamente'}</button>
                </div>
                : !tapsData ? <p role="status" className="text-sm text-ink-muted">Carregando taps do turno...</p>
                : tapsAtivas.length === 0 ? <div className="space-y-2 rounded-xl border border-line bg-surface-lighter p-3 text-sm text-ink-muted">
                  <p>Nenhuma tap ativa está configurada neste ponto de venda.</p>
                  {canPermission('taps.operate') ? <a className="font-semibold text-brand-500 underline" href="/operacao/caixa">Abrir montagem de taps</a> : <p>Peça ao responsável pela operação para configurar as taps.</p>}
                </div>
                : !tapsAtivas.some((tap) => tap.chopeAtual) ? <div className="space-y-2 rounded-xl border border-line bg-surface-lighter p-3 text-sm text-ink-muted">
                  <p>Há {tapsAtivas.length} taps configuradas, mas nenhuma tem chope montado neste turno.</p>
                  {canPermission('taps.operate') ? <a className="font-semibold text-brand-500 underline" href="/operacao/caixa">Abrir montagem de taps</a> : <p>Peça ao responsável pela operação para montar um chope.</p>}
                </div>
                : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {tapsAtivas.map((tap) => {
                    const selecionada = tapSelecionado?.id === tap.id;
                    const nomeTap = tap.nome?.trim() || `Tap ${tap.numero}`;
                    return <button key={tap.id} type="button" aria-pressed={selecionada} aria-label={`Selecionar Tap ${tap.numero}, ${nomeTap}${tap.chopeAtual ? `, chope ${tap.chopeAtual.nome}` : ', sem chope montado'}`} className={`flex min-h-28 min-w-0 flex-col items-start gap-1 rounded-xl border p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${selecionada ? 'border-amber-400 bg-amber-400/10 text-ink' : 'border-line bg-surface text-ink-muted'}`} onClick={() => selecionarTap(tap.id)}>
                      <span className="font-bold">Tap {String(tap.numero).padStart(2, '0')}</span>
                      <span className="w-full break-words text-sm font-semibold">{nomeTap}</span>
                      <span className="w-full break-words text-xs text-ink-muted">{tap.chopeAtual?.nome ?? 'Sem chope montado'}</span>
                      {selecionada && <span className="mt-auto rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-semibold">Tap selecionada</span>}
                    </button>;
                  })}
                </div>}
            </section>
            {montagemAlterada && <p role="alert" className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">A montagem ou os preços desta Tap mudaram. A seleção anterior foi limpa; escolha novamente.</p>}
            {tapSelecionado && !tapSelecionado.chopeAtual && <p role="status" className="rounded-xl border border-line bg-surface-lighter p-3 text-sm text-ink-muted">Tap {tapSelecionado.numero} está ativa, mas não tem chope montado neste turno.</p>}
            {tapSelecionado?.chopeAtual && !produtoDoTap && <p role="status" className="rounded-xl border border-line bg-surface-lighter p-3 text-sm text-ink-muted">{tapSelecionado.chopeAtual.nome} está inativo ou não está disponível no cardápio efetivo deste turno.</p>}
            {tapSelecionado && produtoDoTap && <>
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Volume</h3>
                {volumesDoTap.length === 0 || !volumesDoTap.some((item) => item.preco > 0) ? <p role="status" className="text-sm text-ink-muted">Este chope não tem volume com preço elegível no cardápio deste turno.</p> : <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {volumesDoTap.filter((opcao) => opcao.preco > 0).map((opcao) => <button key={opcao.volumeMl} type="button" aria-pressed={volumeMl === opcao.volumeMl} className={`rounded-xl border px-3 py-3 text-center ${volumeMl === opcao.volumeMl ? 'border-brand-500 bg-brand-600 text-white' : 'border-line bg-surface text-ink-muted'}`} onClick={() => { setVolumeMl(opcao.volumeMl); setMontagemAlterada(false); }}>
                    <span className="block font-semibold">{opcao.volumeMl} ml</span><span className="text-xs">{formatCurrency(opcao.preco)}</span>
                  </button>)}
                </div>}
              </section>
              {volumeMl && precoVolumeSelecionado > 0 && <div className="rounded-xl border border-line bg-surface-lighter p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="break-words font-semibold">{produtoDoTap.nome} ({volumeMl} ml)</p><p className="break-words text-sm text-ink-muted">Tap {tapSelecionado.numero}{tapSelecionado.nome ? ` · ${tapSelecionado.nome}` : ''} · {formatCurrency(precoVolumeSelecionado)} cada</p></div>
                  <div className="text-right"><p className="text-xs text-ink-faint">Total</p><p className="font-bold text-brand-400">{formatCurrency(precoVolumeSelecionado * quantidade)}</p></div>
                </div>
                {linhas.length > 0 && <p className="mt-2 border-t border-line pt-2 text-xs text-ink-faint">Novo total da comanda: {formatCurrency(totalCarrinho(linhas) + precoVolumeSelecionado * quantidade)}</p>}
              </div>}
              <section className="flex items-center justify-between gap-4">
                <span className="font-semibold text-ink-muted">Quantidade</span>
                <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface px-3 py-2">
                  <button type="button" aria-label="Diminuir quantidade" className="min-h-10 min-w-10 rounded-xl bg-surface-lighter text-xl font-bold" onClick={() => setQuantidade((atual) => Math.max(1, atual - 1))}>−</button>
                  <span className="min-w-8 text-center text-2xl font-bold">{quantidade}</span>
                  <button type="button" aria-label="Aumentar quantidade" className="min-h-10 min-w-10 rounded-xl bg-brand-600 text-xl font-bold text-white" onClick={() => setQuantidade((atual) => atual + 1)}>+</button>
                </div>
              </section>
              {saldoChope && <p className="text-xs text-ink-faint">Disponível: {Math.max(0, saldoChope.quantidade - litrosNoCarrinhoChope).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} L</p>}
              <button type="button" className="touch-btn-secondary w-full" disabled={!podeAdicionarChope} onClick={adicionarChopeNaLista}>Adicionar chope à lista</button>
            </>}
          </div>
        ) : (
          <GradeProdutos
            produtos={produtosDaAba}
            onSelecionar={selecionar}
            saldos={saldos}
            controlaEstoque={controlaEstoque}
            quantidadesNoCarrinho={quantidadesNoCarrinho}
          />
        )}
      </div>
    </Modal>
    <Modal open={Boolean(produto)} onClose={() => { setProduto(null); setTapId(''); setProdutoMontadoSelecionado(undefined); setVolumeMl(undefined); }} title="" hideHeaderClose footer={<><button type="button" className="touch-btn-primary w-full flex items-center justify-center gap-2" disabled={produtoEhChope && (!tapId || !volumeMl || !(precoSelecionado > 0) || !tapsDoProduto.some((tap) => tap.id === tapId))} onClick={confirmar}><IconPlus className="h-5 w-5" />Adicionar item</button><button type="button" className="touch-btn-orange w-full flex items-center justify-center gap-2" onClick={() => { setProduto(null); setTapId(''); setProdutoMontadoSelecionado(undefined); setVolumeMl(undefined); }}>Voltar</button></>}>
      {produto && <div className="space-y-6 rounded-2xl border border-line bg-surface-lighter p-5 sm:p-7">
        <h2 className="text-2xl sm:text-3xl font-bold text-ink">{produto.nome}{produtoEhChope && (produto.volumeMl ?? 0) > 1 ? ` (${produto.volumeMl} ml)` : ''}</h2>
        {limiteQuantidadeSelecionada !== null && <p className="text-sm text-ink-muted">Disponível para esta comanda: {limiteQuantidadeSelecionada} un</p>}
        {produtoEhChope && <section className="space-y-3 border-b border-line pb-5"><div><h3 className="text-lg font-bold">Tap e volume</h3><p className="text-sm text-ink-muted">Escolha a Tap com este chope montado e o volume da venda.</p></div>{tapsDoProduto.length === 0 ? <p className="rounded-xl border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-800">Nenhuma Tap ativa está montada com este chope neste turno.</p> : <select className="input" aria-label="Tap selecionada" value={tapId} onChange={(e) => { const tap = tapsDoProduto.find((item) => item.id === e.target.value); setTapId(tap?.id ?? ''); setProdutoMontadoSelecionado(tap?.chopeAtual?.id ?? undefined); setVolumeMl(undefined); setMontagemAlterada(false); }}><option value="">Selecione a Tap</option>{tapsDoProduto.map((tap) => <option key={tap.id} value={tap.id}>Tap {tap.numero}{tap.nome ? ` — ${tap.nome}` : ''}</option>)}</select>}{volumesDoTap.length === 0 || !volumesDoTap.some((item) => item.preco > 0) ? <p role="status" className="text-sm text-ink-muted">Este chope não tem volume com preço elegível no cardápio deste turno.</p> : null}<div className="grid grid-cols-2 gap-2">{volumesDoTap.filter((preco) => preco.preco > 0).map((preco) => <button key={preco.volumeMl} type="button" aria-pressed={volumeMl === preco.volumeMl} disabled={!tapId || !tapsDoProduto.some((tap) => tap.id === tapId)} className={`rounded-xl border px-3 py-3 text-left disabled:cursor-not-allowed disabled:opacity-50 ${volumeMl === preco.volumeMl ? 'border-brand-500 bg-brand-500/10' : 'border-line bg-surface'}`} onClick={() => setVolumeMl(preco.volumeMl)}><span className="block font-semibold">{preco.volumeMl} ml</span><span className="text-sm text-ink-muted">{formatCurrency(Number(preco.preco))}</span></button>)}</div>{montagemAlterada && <p role="alert" className="text-sm text-amber-700">A montagem ou os preços desta Tap mudaram. Escolha a Tap e o volume novamente.</p>}</section>}
        {!produtoEhChope && <section className="space-y-3 border-b border-line pb-5"><div className="mb-3 flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-400"><IconChefHat className="h-6 w-6" /></span><div><h3 className="text-lg font-bold">Opcionais</h3><p className="text-sm text-ink-muted">Selecione os opcionais que desejar</p></div></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{produto.gruposOpcionais?.flatMap((grupo) => grupo.opcoes).map((opcao) => <label key={opcao.id} className="flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 transition-colors has-[:checked]:border-brand-500 has-[:checked]:bg-brand-500/10"><span className="flex items-center gap-3"><input className="h-5 w-5 accent-brand-500" type="checkbox" checked={Boolean(opcionais[opcao.id])} onChange={() => setOpcionais((atual) => atual[opcao.id] ? Object.fromEntries(Object.entries(atual).filter(([id]) => id !== opcao.id)) : { ...atual, [opcao.id]: 1 })} /><span className="font-semibold">{opcao.nome}</span></span><span className="text-sm text-ink-muted">{Number(opcao.precoAdicional) > 0 ? `+${formatCurrency(Number(opcao.precoAdicional))}` : 'Grátis'}</span></label>)}</div></section>}
        <section className="flex items-center justify-between gap-4 border-b border-line pb-5"><div className="flex items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-400"><IconHash className="h-6 w-6" /></span><div><h3 className="text-lg font-bold">Quantidade</h3><p className="text-sm text-ink-muted">Escolha a quantidade deste item</p></div></div><div className="flex items-center gap-4 rounded-2xl border border-line bg-surface px-3 py-2"><button type="button" className="min-h-10 min-w-10 rounded-xl bg-surface-lighter text-xl font-bold" onClick={() => setQuantidade((v) => Math.max(1, v - 1))}>−</button><span className="min-w-8 text-center text-2xl font-bold">{quantidade}</span><button type="button" className="min-h-10 min-w-10 rounded-xl bg-brand-600 text-xl font-bold text-white" onClick={() => setQuantidade((v) => v + 1)}><IconPlus className="mx-auto h-5 w-5" /></button></div></section>
        {!produtoEhChope && <><section><div className="mb-3 flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-400"><IconChefHat className="h-6 w-6" /></span><div><h3 className="text-lg font-bold">Para viagem</h3><p className="text-sm text-ink-muted">A cozinha deve embalar este item</p></div></div><label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-4 py-3"><input type="checkbox" className="h-5 w-5 accent-brand-500" checked={paraViagemItem} onChange={(e) => setParaViagemItem(e.target.checked)} /><span className="font-semibold">Marcar item para viagem</span></label></section>
        <section><div className="mb-3 flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-400"><IconClipboard className="h-6 w-6" /></span><div><h3 className="text-lg font-bold">Observação do item</h3><p className="text-sm text-ink-muted">Adicione alguma observação, se necessário</p></div></div><textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={280} rows={2} placeholder="Ex.: sem cebola" className="w-full rounded-2xl border border-line bg-surface px-4 py-3" /></section></>}
      </div>}
    </Modal>
  </>;
}
