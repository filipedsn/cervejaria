import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '../Modal';
import { GradeProdutos } from './GradeProdutos';
import { ResumoCarrinho } from './ResumoCarrinho';
import { IconChefHat, IconClipboard, IconPackage, IconPlus } from '../NavIcons';
import { api, formatCurrency } from '../../lib/api';
import {
  classificarGrupoProdutoOperacao,
  isChopeOperacao,
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
type AbaItens = 'chope' | 'bebidas' | 'comidas' | 'outros';

export function AdicionarItensOperacaoModal({
  open,
  onClose,
  pontoVendaId,
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
  const [volumeMl, setVolumeMl] = useState<number | undefined>();
  const [paraViagemItem, setParaViagemItem] = useState(false);
  const [observacao, setObservacao] = useState('');
  const [opcionais, setOpcionais] = useState<Record<string, number>>({});

  useEffect(() => {
    if (open) setAba('comidas');
  }, [open]);

  const { data: tapsData, isLoading: carregandoTaps, error: erroCarregarTaps } = useQuery({
    queryKey: ['operacao-caixa-taps', pontoVendaId],
    queryFn: () => api.get<TapsTurnoResposta>(`/api/operacao/caixa/taps?pontoVendaId=${encodeURIComponent(pontoVendaId)}`),
    enabled: open && tapsEnabled && Boolean(pontoVendaId),
  });

  const produtoEhChope = produto ? isChopeOperacao(produto) : false;
  const tapsDoProduto = produtoEhChope
    ? (tapsData?.taps ?? []).filter((tap) => tap.ativo && tap.chopeAtual?.id === produto?.id)
    : [];
  const precosChope = produtoEhChope
    ? (produto?.precos ?? []).filter((preco) => preco.volumeMl > 1).sort((a, b) => a.volumeMl - b.volumeMl)
    : [];
  const precoSelecionado = produtoEhChope
    ? Number(volumeMl === produto?.volumeMl && produto?.precoEfetivo !== undefined
      ? produto.precoEfetivo
      : precosChope.find((preco) => preco.volumeMl === volumeMl)?.preco ?? 0)
    : Number(produto?.precoEfetivo ?? produto?.precoUnit ?? 0);

  const tapsDisponiveis = (tapsData?.taps ?? []).filter((tap) => tap.ativo && tap.chopeAtual);
  const tapSelecionado = tapsDisponiveis.find((tap) => tap.id === tapId) ?? tapsDisponiveis[0] ?? null;
  const produtoDoTap = tapSelecionado?.chopeAtual
    ? produtos.find((item) => item.id === tapSelecionado.chopeAtual!.id)
      ?? {
        ...tapSelecionado.chopeAtual,
        categoria: 'Chope',
        precoUnit: String(tapSelecionado.chopeAtual.precos?.[0]?.preco ?? 0),
        exigePreparo: false,
        controlaEstoque: true,
        ativo: true,
        ordem: 0,
      }
    : null;
  const precosPorVolumeNoCardapio = produtoDoTap
    ? produtos
        .filter((item) => item.id === produtoDoTap.id && (item.volumeMl ?? 0) > 1)
        .map((item) => ({ volumeMl: item.volumeMl!, preco: Number(item.precoEfetivo ?? item.precoUnit) }))
    : [];
  const volumesDoTap = precosPorVolumeNoCardapio.length
    ? [...new Map(precosPorVolumeNoCardapio.map((item) => [item.volumeMl, item])).values()].sort((a, b) => a.volumeMl - b.volumeMl)
    : (produtoDoTap?.precos ?? tapSelecionado?.chopeAtual?.precos ?? [])
        .filter((preco) => preco.volumeMl > 1)
        .map((preco) => ({ volumeMl: preco.volumeMl, preco: Number(preco.preco) }))
        .sort((a, b) => a.volumeMl - b.volumeMl);
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

  const produtosBebidas = produtos.filter((item) => classificarGrupoProdutoOperacao(item) === 'bebidas');
  const produtosComidas = produtos.filter((item) => classificarGrupoProdutoOperacao(item) === 'comidas');
  const produtosOutros = produtos.filter((item) => classificarGrupoProdutoOperacao(item) === 'outros');
  const abasVisiveis: { id: AbaItens; label: string }[] = [
    ...(tapsEnabled && (carregandoTaps || Boolean(erroCarregarTaps) || tapsDisponiveis.length > 0)
      ? [{ id: 'chope' as const, label: 'Chopes' }]
      : []),
    ...(produtosComidas.length > 0 ? [{ id: 'comidas' as const, label: 'Comidas' }] : []),
    ...(produtosBebidas.length > 0 ? [{ id: 'bebidas' as const, label: 'Bebidas' }] : []),
    ...(produtosOutros.length > 0 ? [{ id: 'outros' as const, label: 'Outros' }] : []),
  ];
  const abaSelecionada = abasVisiveis.some((item) => item.id === aba) ? aba : abasVisiveis[0]?.id;

  const selecionar = (item: ProdutoOperacao) => {
    setProduto(item);
    setQuantidade(1);
    setTapId('');
    setVolumeMl(isChopeOperacao(item) && (item.volumeMl ?? 0) > 1 ? item.volumeMl : undefined);
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
    if (produtoEhChope && (!tapId || !volumeMl || !(precoSelecionado > 0))) return;
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
        {abaSelecionada === 'chope' && tapsEnabled ? (
          <div className="space-y-5">
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Escolha a Tap</h3>
              {carregandoTaps ? (
                <p className="text-sm text-ink-muted">Carregando Taps do turno...</p>
              ) : erroCarregarTaps ? (
                <p role="alert" className="rounded-xl border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-200">
                  NÃ£o foi possÃ­vel carregar as Taps: {erroCarregarTaps instanceof Error ? erroCarregarTaps.message : 'erro inesperado'}
                </p>
              ) : tapsData && !tapsData.trailerId ? (
                <p className="rounded-xl border border-line bg-surface-lighter p-3 text-sm text-ink-muted">Este turno estÃ¡ sem trailer vinculado. Confira o trailer selecionado ao abrir o turno.</p>
              ) : tapsDisponiveis.length === 0 ? (
                <p className="rounded-xl border border-line bg-surface-lighter p-3 text-sm text-ink-muted">O trailer deste turno não tem Tap ativa com chope montado. Confira a configuração das Taps e a montagem do chope.</p>
              ) : (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {tapsDisponiveis.map((tap) => {
                    const selecionada = tapSelecionado?.id === tap.id;
                    return <button key={tap.id} type="button" className="flex flex-col items-center gap-1" onClick={() => { setTapId(tap.id); setVolumeMl(undefined); setQuantidade(1); }}>
                      <span className={`flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border-2 text-lg font-bold ${selecionada ? 'border-amber-400 text-ink' : 'border-line text-ink-muted'}`}>
                        {String(tap.numero).padStart(2, '0')}
                      </span>
                      <span className="max-w-full truncate text-xs font-semibold text-ink-muted">{tap.chopeAtual?.nome}</span>
                    </button>;
                  })}
                </div>
              )}
            </section>
            {tapSelecionado && produtoDoTap && <>
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Volume</h3>
                {volumesDoTap.length === 0 ? <p className="text-sm text-ink-muted">Este chope não tem volumes com preço cadastrados.</p> : <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {volumesDoTap.map((opcao) => <button key={opcao.volumeMl} type="button" className={`rounded-xl border px-3 py-3 text-center ${volumeMl === opcao.volumeMl ? 'border-brand-500 bg-brand-600 text-white' : 'border-line bg-surface text-ink-muted'}`} onClick={() => setVolumeMl(opcao.volumeMl)}>
                    <span className="block font-semibold">{opcao.volumeMl} ml</span><span className="text-xs">{formatCurrency(opcao.preco)}</span>
                  </button>)}
                </div>}
              </section>
              {volumeMl && precoVolumeSelecionado > 0 && <div className="rounded-xl border border-line bg-surface-lighter p-3">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-semibold">{produtoDoTap.nome} ({volumeMl} ml)</p><p className="text-sm text-ink-muted">Tap {tapSelecionado?.numero} · {formatCurrency(precoVolumeSelecionado)} cada</p></div>
                  <div className="text-right"><p className="text-xs text-ink-faint">Total</p><p className="font-bold text-brand-400">{formatCurrency(precoVolumeSelecionado * quantidade)}</p></div>
                </div>
                {linhas.length > 0 && <p className="mt-2 border-t border-line pt-2 text-xs text-ink-faint">Novo total da comanda: {formatCurrency(totalCarrinho(linhas) + precoVolumeSelecionado * quantidade)}</p>}
              </div>}
              <section className="flex items-center justify-between gap-4">
                <span className="font-semibold text-ink-muted">Quantidade</span>
                <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface px-3 py-2">
                  <button type="button" className="min-h-10 min-w-10 rounded-xl bg-surface-lighter text-xl font-bold" onClick={() => setQuantidade((atual) => Math.max(1, atual - 1))}>−</button>
                  <span className="min-w-8 text-center text-2xl font-bold">{quantidade}</span>
                  <button type="button" className="min-h-10 min-w-10 rounded-xl bg-brand-600 text-xl font-bold text-white" onClick={() => setQuantidade((atual) => atual + 1)}>+</button>
                </div>
              </section>
              {saldoChope && <p className="text-xs text-ink-faint">Disponível: {Math.max(0, saldoChope.quantidade - litrosNoCarrinhoChope).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} L</p>}
              <button type="button" className="touch-btn-secondary w-full" disabled={!podeAdicionarChope} onClick={adicionarChopeNaLista}>Adicionar chope à lista</button>
            </>}
          </div>
        ) : (
          <GradeProdutos
            produtos={abaSelecionada === 'bebidas' ? produtosBebidas : abaSelecionada === 'comidas' ? produtosComidas : produtosOutros}
            onSelecionar={selecionar}
            saldos={saldos}
            controlaEstoque={controlaEstoque}
            quantidadesNoCarrinho={quantidadesNoCarrinho}
          />
        )}
      </div>
    </Modal>
    <Modal open={Boolean(produto)} onClose={() => setProduto(null)} title="" hideHeaderClose footer={<><button type="button" className="touch-btn-primary w-full flex items-center justify-center gap-2" disabled={produtoEhChope && (!tapId || !volumeMl)} onClick={confirmar}><IconPlus className="h-5 w-5" />Adicionar item</button><button type="button" className="touch-btn-orange w-full flex items-center justify-center gap-2" onClick={() => setProduto(null)}>Voltar</button></>}>
      {produto && <div className="space-y-6 rounded-2xl border border-line bg-surface-lighter p-5 sm:p-7">
        <h2 className="text-2xl sm:text-3xl font-bold text-ink">{produto.nome}{produtoEhChope && (produto.volumeMl ?? 0) > 1 ? ` (${produto.volumeMl} ml)` : ''}</h2>
        {limiteQuantidadeSelecionada !== null && <p className="text-sm text-ink-muted">Disponível para esta comanda: {limiteQuantidadeSelecionada} un</p>}
        {produtoEhChope && <section className="space-y-3 border-b border-line pb-5"><div><h3 className="text-lg font-bold">Tap e volume</h3><p className="text-sm text-ink-muted">Escolha o Tap com este chope montado e o volume da venda.</p></div>{tapsDoProduto.length === 0 ? <p className="rounded-xl border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-800">Nenhum Tap está montado com este chope no turno.</p> : <select className="input" value={tapId} onChange={(e) => setTapId(e.target.value)}><option value="">Selecione o Tap</option>{tapsDoProduto.map((tap) => <option key={tap.id} value={tap.id}>Tap {tap.numero}{tap.nome ? ` — ${tap.nome}` : ''}</option>)}</select>}<div className="grid grid-cols-2 gap-2">{precosChope.map((preco) => <button key={preco.volumeMl} type="button" className={`rounded-xl border px-3 py-3 text-left ${volumeMl === preco.volumeMl ? 'border-brand-500 bg-brand-500/10' : 'border-line bg-surface'}`} onClick={() => setVolumeMl(preco.volumeMl)}><span className="block font-semibold">{preco.volumeMl} ml</span><span className="text-sm text-ink-muted">{formatCurrency(Number(preco.preco))}</span></button>)}</div></section>}
        {!produtoEhChope && <section className="space-y-3 border-b border-line pb-5"><div className="mb-3 flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-400"><IconChefHat className="h-6 w-6" /></span><div><h3 className="text-lg font-bold">Opcionais</h3><p className="text-sm text-ink-muted">Selecione os opcionais que desejar</p></div></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{produto.gruposOpcionais?.flatMap((grupo) => grupo.opcoes).map((opcao) => <label key={opcao.id} className="flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 transition-colors has-[:checked]:border-brand-500 has-[:checked]:bg-brand-500/10"><span className="flex items-center gap-3"><input className="h-5 w-5 accent-brand-500" type="checkbox" checked={Boolean(opcionais[opcao.id])} onChange={() => setOpcionais((atual) => atual[opcao.id] ? Object.fromEntries(Object.entries(atual).filter(([id]) => id !== opcao.id)) : { ...atual, [opcao.id]: 1 })} /><span className="font-semibold">{opcao.nome}</span></span><span className="text-sm text-ink-muted">{Number(opcao.precoAdicional) > 0 ? `+${formatCurrency(Number(opcao.precoAdicional))}` : 'Grátis'}</span></label>)}</div></section>}
        <section className="flex items-center justify-between gap-4 border-b border-line pb-5"><div className="flex items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-400"><IconHash className="h-6 w-6" /></span><div><h3 className="text-lg font-bold">Quantidade</h3><p className="text-sm text-ink-muted">Escolha a quantidade deste item</p></div></div><div className="flex items-center gap-4 rounded-2xl border border-line bg-surface px-3 py-2"><button type="button" className="min-h-10 min-w-10 rounded-xl bg-surface-lighter text-xl font-bold" onClick={() => setQuantidade((v) => Math.max(1, v - 1))}>−</button><span className="min-w-8 text-center text-2xl font-bold">{quantidade}</span><button type="button" className="min-h-10 min-w-10 rounded-xl bg-brand-600 text-xl font-bold text-white" onClick={() => setQuantidade((v) => v + 1)}><IconPlus className="mx-auto h-5 w-5" /></button></div></section>
        {!produtoEhChope && <><section><div className="mb-3 flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-400"><IconChefHat className="h-6 w-6" /></span><div><h3 className="text-lg font-bold">Para viagem</h3><p className="text-sm text-ink-muted">A cozinha deve embalar este item</p></div></div><label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-4 py-3"><input type="checkbox" className="h-5 w-5 accent-brand-500" checked={paraViagemItem} onChange={(e) => setParaViagemItem(e.target.checked)} /><span className="font-semibold">Marcar item para viagem</span></label></section>
        <section><div className="mb-3 flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-400"><IconClipboard className="h-6 w-6" /></span><div><h3 className="text-lg font-bold">Observação do item</h3><p className="text-sm text-ink-muted">Adicione alguma observação, se necessário</p></div></div><textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={280} rows={2} placeholder="Ex.: sem cebola" className="w-full rounded-2xl border border-line bg-surface px-4 py-3" /></section></>}
      </div>}
    </Modal>
  </>;
}
