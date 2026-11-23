import { useEffect, useState } from 'react';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { formatCurrencyInputFromNumber, parseCurrencyInput } from '../../lib/currency';
import {
  NOME_GRUPO_COMBO_FECHADO,
  precoBaseCombo,
  precoMaximoCombo,
  type ComposicaoCombo,
} from '../../lib/combo';
import { Modal } from '../Modal';
import { CurrencyInput } from '../CurrencyInput';
import { IconPlus, IconTrash } from '../NavIcons';

export type ProdutoParaCombo = {
  id: string;
  nome: string;
  categoria: string | null;
  categoriaPdvId?: string | null;
  precoUnit: string | number;
};

type OpcaoForm = { produtoId: string; precoNoCombo: string; quantidade: number };
type EscolhaForm = {
  chave: string;
  nome: string;
  /** Quantos o cliente escolhe (ou 0 = pode pular). */
  quantos: number;
  opcional: boolean;
  somenteCardapioTurno: boolean;
  opcoes: OpcaoForm[];
};

const LIMITE_QUANTIDADE = 20;
let proximaChave = 0;
const novaChave = () => `escolha-${++proximaChave}`;
const escolhaVazia = (): EscolhaForm => ({
  chave: novaChave(),
  nome: '',
  quantos: 1,
  opcional: false,
  somenteCardapioTurno: false,
  opcoes: [],
});
const categoriaDe = (produto: ProdutoParaCombo) => produto.categoria?.trim() || 'Outros';

function Stepper({ valor, min, max, onChange, rotulo, sufixo = '' }: {
  valor: number;
  min: number;
  max: number;
  onChange: (valor: number) => void;
  rotulo: string;
  sufixo?: string;
}) {
  return (
    <div className="inline-flex shrink-0 items-center rounded-xl border border-line bg-surface" role="group" aria-label={rotulo}>
      <button type="button" className="flex min-h-10 min-w-10 items-center justify-center rounded-l-xl text-lg font-bold text-ink-muted active:bg-surface-lighter disabled:opacity-30" disabled={valor <= min} aria-label={`Diminuir ${rotulo}`} onClick={() => onChange(valor - 1)}>−</button>
      <span className="min-w-8 text-center font-bold tabular-nums" aria-live="polite">{valor}{sufixo}</span>
      <button type="button" className="flex min-h-10 min-w-10 items-center justify-center rounded-r-xl text-lg font-bold text-ink active:bg-surface-lighter disabled:opacity-30" disabled={valor >= max} aria-label={`Aumentar ${rotulo}`} onClick={() => onChange(valor + 1)}>+</button>
    </div>
  );
}

function LinhaItemCombo({ opcao, produto, onChange, onRemover }: {
  opcao: OpcaoForm;
  produto: ProdutoParaCombo | undefined;
  onChange: (alteracao: Partial<OpcaoForm>) => void;
  onRemover: () => void;
}) {
  const nome = produto?.nome ?? 'Produto indisponível';
  const avulso = produto ? Number(produto.precoUnit) : null;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <Stepper valor={opcao.quantidade} min={1} max={LIMITE_QUANTIDADE} sufixo="×" rotulo={`quantidade de ${nome}`} onChange={(quantidade) => onChange({ quantidade })} />
      <div className="min-w-0 flex-1 basis-36">
        <p className="break-words font-semibold leading-snug">{nome}</p>
        {avulso !== null && (
          <p className="text-xs text-ink-faint">avulso {formatCurrency(avulso)}</p>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <label className="flex flex-col items-end gap-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Neste combo</span>
          <div className="w-32 shrink-0">
            <CurrencyInput className="input text-right font-semibold" aria-label={`Preço de ${nome} neste combo`} value={opcao.precoNoCombo} onChange={(precoNoCombo) => onChange({ precoNoCombo })} />
          </div>
        </label>
        <button type="button" className="icon-btn-danger" aria-label={`Tirar ${nome}`} title="Tirar" onClick={onRemover}>
          <IconTrash className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

function SeletorProdutosCombo({ disponiveis, onAdicionar, onCancelar }: {
  disponiveis: ProdutoParaCombo[];
  onAdicionar: (produtos: ProdutoParaCombo[]) => void;
  onCancelar: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const categorias = [...new Set(disponiveis.map(categoriaDe))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const visiveis = disponiveis.filter((produto) => (!categoria || categoriaDe(produto) === categoria)
    && (!termo || produto.nome.toLocaleLowerCase('pt-BR').includes(termo)));
  const todosVisiveisMarcados = visiveis.length > 0 && visiveis.every((produto) => marcados.has(produto.id));
  const alternar = (id: string) => setMarcados((atual) => {
    const proximo = new Set(atual);
    if (proximo.has(id)) proximo.delete(id); else proximo.add(id);
    return proximo;
  });
  const alternarVisiveis = () => setMarcados((atual) => {
    const proximo = new Set(atual);
    for (const produto of visiveis) {
      if (todosVisiveisMarcados) proximo.delete(produto.id); else proximo.add(produto.id);
    }
    return proximo;
  });

  if (disponiveis.length === 0) {
    return (
      <div className="space-y-2 rounded-xl bg-surface-lighter p-3 text-sm text-ink-muted">
        <p>Todos os produtos do catálogo já estão nesta lista.</p>
        <button type="button" className="touch-btn-secondary touch-btn-sm" onClick={onCancelar}>Fechar</button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-lighter p-3">
      <input className="input" placeholder="Buscar produto" value={busca} onChange={(event) => setBusca(event.target.value)} aria-label="Buscar produto" />
      {categorias.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`touch-btn-sm ${categoria === null ? 'touch-btn-primary' : 'touch-btn-secondary'}`} onClick={() => setCategoria(null)}>Todas</button>
          {categorias.map((nome) => (
            <button key={nome} type="button" className={`touch-btn-sm ${categoria === nome ? 'touch-btn-primary' : 'touch-btn-secondary'}`} onClick={() => setCategoria(nome)}>{nome}</button>
          ))}
        </div>
      )}
      {visiveis.length > 0 && (
        <label className="flex items-center gap-2 text-sm font-semibold text-ink-muted">
          <input type="checkbox" className="h-5 w-5 accent-brand-500" checked={todosVisiveisMarcados} onChange={alternarVisiveis} />
          Selecionar todos{categoria ? ` de ${categoria}` : ' visíveis'}
        </label>
      )}
      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {visiveis.map((produto) => (
          <li key={produto.id}>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-surface">
              <span className="flex min-w-0 items-center gap-3">
                <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand-500" checked={marcados.has(produto.id)} onChange={() => alternar(produto.id)} />
                <span className="min-w-0 break-words font-semibold">{produto.nome}</span>
              </span>
              <span className="shrink-0 text-sm tabular-nums text-ink-muted">{formatCurrency(Number(produto.precoUnit) || 0)}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button type="button" className="touch-btn-secondary flex-1" onClick={onCancelar}>Cancelar</button>
        <button
          type="button"
          className="touch-btn-primary flex-1"
          disabled={marcados.size === 0}
          onClick={() => onAdicionar(disponiveis.filter((produto) => marcados.has(produto.id)))}
        >
          Adicionar{marcados.size ? ` ${marcados.size}` : ''}
        </button>
      </div>
    </div>
  );
}

function ListaItens({
  opcoes,
  produtos,
  produtoPorId,
  adicionando,
  setAdicionando,
  onChangeOpcoes,
  usaCardapio,
  somenteCardapioTurno,
  onSomenteCardapio,
}: {
  opcoes: OpcaoForm[];
  produtos: ProdutoParaCombo[];
  produtoPorId: Map<string, ProdutoParaCombo>;
  adicionando: boolean;
  setAdicionando: (v: boolean) => void;
  onChangeOpcoes: (opcoes: OpcaoForm[]) => void;
  usaCardapio: boolean;
  somenteCardapioTurno: boolean;
  onSomenteCardapio: (v: boolean) => void;
}) {
  const disponiveis = produtos.filter((produto) => !opcoes.some((opcao) => opcao.produtoId === produto.id));
  return (
    <div className="space-y-3">
      {opcoes.length > 0 ? (
        <ul className="divide-y divide-line border-t border-line">
          {opcoes.map((opcao) => (
            <LinhaItemCombo
              key={opcao.produtoId}
              opcao={opcao}
              produto={produtoPorId.get(opcao.produtoId)}
              onChange={(alteracao) => onChangeOpcoes(opcoes.map((item) => item.produtoId === opcao.produtoId ? { ...item, ...alteracao } : item))}
              onRemover={() => onChangeOpcoes(opcoes.filter((item) => item.produtoId !== opcao.produtoId))}
            />
          ))}
        </ul>
      ) : !adicionando && (
        <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-ink-muted">
          Nenhum produto ainda. Adicione os itens deste combo.
        </p>
      )}
      {adicionando ? (
        <SeletorProdutosCombo
          disponiveis={disponiveis}
          onCancelar={() => setAdicionando(false)}
          onAdicionar={(novos) => {
            onChangeOpcoes([
              ...opcoes,
              ...novos.map((produto) => ({
                produtoId: produto.id,
                precoNoCombo: formatCurrencyInputFromNumber(produto.precoUnit),
                quantidade: 1,
              })),
            ]);
            setAdicionando(false);
          }}
        />
      ) : (
        <button type="button" className="touch-btn-secondary flex w-full items-center justify-center gap-2" onClick={() => setAdicionando(true)}>
          <IconPlus className="h-4 w-4" /> Adicionar produtos
        </button>
      )}
      {usaCardapio && (
        <label className="flex cursor-pointer items-start gap-3 text-sm text-ink-muted">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-500" checked={somenteCardapioTurno} onChange={(event) => onSomenteCardapio(event.target.checked)} />
          Mostrar só os produtos que estão no cardápio do turno
        </label>
      )}
    </div>
  );
}

function validarEscolha(escolha: EscolhaForm): string | null {
  if (!escolha.nome.trim()) return 'Dê um nome para esta escolha (ex.: Bebida).';
  if (escolha.opcoes.length === 0) return 'Adicione ao menos um produto.';
  const maximo = escolha.opcional ? escolha.quantos : escolha.quantos;
  if (maximo > escolha.opcoes.length) return `O cliente escolhe ${maximo}, mas há só ${escolha.opcoes.length} produto(s).`;
  return null;
}

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
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [mostrarErros, setMostrarErros] = useState(false);
  const [comboFechado, setComboFechado] = useState(false);
  const [precoPacote, setPrecoPacote] = useState(formatCurrencyInputFromNumber(0));
  const [itensFechado, setItensFechado] = useState<OpcaoForm[]>([]);
  const [somenteCardapioFechado, setSomenteCardapioFechado] = useState(false);
  const [escolhas, setEscolhas] = useState<EscolhaForm[]>([]);
  const [adicionandoFechado, setAdicionandoFechado] = useState(false);
  const [adicionandoEscolha, setAdicionandoEscolha] = useState<string | null>(null);
  const [legadoCategoria, setLegadoCategoria] = useState(false);

  const produtoPorId = new Map(produtos.map((produto) => [produto.id, produto]));

  useEffect(() => {
    if (!open) return;
    setCarregando(true);
    setErro('');
    setMostrarErros(false);
    setAdicionandoFechado(false);
    setAdicionandoEscolha(null);
    setLegadoCategoria(false);
    api.get<ComposicaoCombo>(`/api/operacao/produtos/${comboId}/combo`)
      .then((composicao) => {
        const temCategoria = composicao.grupos.some((grupo) => grupo.modo === 'CATEGORIA');
        if (temCategoria) {
          setLegadoCategoria(true);
          setComboFechado(false);
          setPrecoPacote(formatCurrencyInputFromNumber(composicao.precoCatalogo));
          setEscolhas([]);
          setItensFechado([]);
          return;
        }
        const fechado = Boolean(composicao.comboFechado)
          || (composicao.grupos.length === 1
            && composicao.grupos[0]?.minimo === composicao.grupos[0]?.opcoes.length
            && composicao.grupos[0]?.maximo === composicao.grupos[0]?.opcoes.length
            && composicao.grupos[0]?.opcoes.length > 0);
        setComboFechado(fechado);
        setPrecoPacote(formatCurrencyInputFromNumber(composicao.precoCatalogo));
        if (fechado) {
          const grupo = composicao.grupos[0];
          setItensFechado(grupo
            ? grupo.opcoes.map((opcao) => ({
              produtoId: opcao.produtoId,
              precoNoCombo: formatCurrencyInputFromNumber(opcao.precoNoCombo),
              quantidade: opcao.quantidade,
            }))
            : []);
          setSomenteCardapioFechado(grupo?.somenteCardapioTurno ?? false);
          setEscolhas([]);
        } else if (composicao.grupos.length) {
          setEscolhas(composicao.grupos.map((grupo) => ({
            chave: novaChave(),
            nome: grupo.nome,
            quantos: Math.max(1, grupo.maximo),
            opcional: grupo.minimo === 0,
            somenteCardapioTurno: grupo.somenteCardapioTurno,
            opcoes: grupo.opcoes.map((opcao) => ({
              produtoId: opcao.produtoId,
              precoNoCombo: formatCurrencyInputFromNumber(opcao.precoNoCombo),
              quantidade: opcao.quantidade,
            })),
          })));
          setItensFechado([]);
        } else {
          setEscolhas([escolhaVazia()]);
          setItensFechado([]);
        }
      })
      .catch((error) => setErro(error instanceof ApiError ? error.message : 'Não foi possível carregar a composição'))
      .finally(() => setCarregando(false));
  }, [open, comboId]);

  const gruposCalculo = comboFechado
    ? [{
      minimo: itensFechado.length,
      maximo: itensFechado.length,
      opcoes: itensFechado.map((opcao) => ({
        precoNoCombo: parseCurrencyInput(opcao.precoNoCombo),
        quantidade: opcao.quantidade,
      })),
    }]
    : escolhas.map((escolha) => ({
      minimo: escolha.opcional ? 0 : escolha.quantos,
      maximo: escolha.quantos,
      opcoes: escolha.opcoes.map((opcao) => ({
        precoNoCombo: parseCurrencyInput(opcao.precoNoCombo),
        quantidade: opcao.quantidade,
      })),
    }));
  const somaMinima = precoBaseCombo(gruposCalculo);
  const somaMaxima = precoMaximoCombo(gruposCalculo);
  const pacote = parseCurrencyInput(precoPacote);
  const errosEscolhas = new Map(escolhas.map((escolha) => [escolha.chave, validarEscolha(escolha)]));

  const trocarTipo = (fechado: boolean) => {
    setComboFechado(fechado);
    setMostrarErros(false);
    setErro('');
    if (fechado) {
      if (itensFechado.length === 0 && escolhas[0]?.opcoes.length) {
        setItensFechado(escolhas[0].opcoes);
      }
    } else if (escolhas.length === 0) {
      setEscolhas([escolhaVazia()]);
    }
  };

  const salvar = async () => {
    setErro('');
    setMostrarErros(true);
    if (!(pacote >= 0)) return setErro('Informe o preço do combo.');

    if (comboFechado) {
      if (itensFechado.length === 0) return setErro('Adicione ao menos um produto no combo.');
      setSalvando(true);
      try {
        await api.put(`/api/operacao/produtos/${comboId}/combo`, {
          comboFechado: true,
          precoPacote: pacote,
          grupos: [{
            nome: NOME_GRUPO_COMBO_FECHADO,
            minimo: itensFechado.length,
            maximo: itensFechado.length,
            somenteCardapioTurno: somenteCardapioFechado,
            modo: 'LISTA' as const,
            opcoes: itensFechado.map((opcao) => ({
              produtoId: opcao.produtoId,
              precoNoCombo: parseCurrencyInput(opcao.precoNoCombo),
              quantidade: opcao.quantidade,
            })),
          }],
        });
        onSaved();
        onClose();
      } catch (error) {
        setErro(error instanceof ApiError ? error.message : 'Não foi possível salvar a composição');
      } finally {
        setSalvando(false);
      }
      return;
    }

    if (escolhas.length === 0) return setErro('Adicione ao menos uma escolha ao combo.');
    if ([...errosEscolhas.values()].some(Boolean)) return;
    if (!escolhas.some((escolha) => !escolha.opcional)) return setErro('Pelo menos uma escolha precisa ser obrigatória.');

    setSalvando(true);
    try {
      await api.put(`/api/operacao/produtos/${comboId}/combo`, {
        comboFechado: false,
        precoPacote: pacote,
        grupos: escolhas.map((escolha) => ({
          nome: escolha.nome.trim(),
          minimo: escolha.opcional ? 0 : escolha.quantos,
          maximo: escolha.quantos,
          somenteCardapioTurno: escolha.somenteCardapioTurno,
          modo: 'LISTA' as const,
          opcoes: escolha.opcoes.map((opcao) => ({
            produtoId: opcao.produtoId,
            precoNoCombo: parseCurrencyInput(opcao.precoNoCombo),
            quantidade: opcao.quantidade,
          })),
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

  const avisoAjuste = Math.abs(somaMinima - pacote) >= 0.01;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Combo ${comboNome}`}
      hideHeaderClose
      footer={(
        <>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-ink-muted">Preço do combo</span>
            <div className="w-36 shrink-0">
              <CurrencyInput className="input text-right text-lg font-bold" aria-label="Preço do combo" value={precoPacote} onChange={setPrecoPacote} />
            </div>
          </label>
          {!comboFechado && somaMinima !== somaMaxima && (
            <p className="text-sm text-ink-muted">
              Conforme a escolha do cliente, o valor dos itens vai de {formatCurrency(somaMinima)} a {formatCurrency(somaMaxima)}.
            </p>
          )}
          {avisoAjuste && (
            <p className="rounded-xl border border-line bg-surface-lighter px-3 py-2 text-sm text-ink-muted">
              Soma dos itens: {formatCurrency(somaMinima)} · Preço do combo: {formatCurrency(pacote)}. Na venda o sistema ajusta.
            </p>
          )}
          {erro && <div role="alert" className="alert-error text-sm">{erro}</div>}
          <button type="button" className="touch-btn-primary w-full" onClick={salvar} disabled={salvando || carregando}>
            {salvando ? 'Salvando...' : 'Salvar composição'}
          </button>
          <button type="button" className="touch-btn-orange w-full" onClick={onClose} disabled={salvando}>Fechar</button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          O cliente paga o <strong className="font-semibold text-ink">preço do combo</strong>.
          O preço de cada item serve para montar o pacote e a cozinha.
          {!comboFechado && ' Se escolher item mais caro, o valor sobe.'}
        </p>

        <div className="segmented-control" role="group" aria-label="Tipo do combo">
          <button type="button" aria-pressed={!comboFechado} className={`segmented-control-btn flex-1 px-3 ${!comboFechado ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`} onClick={() => trocarTipo(false)}>
            Com escolhas
          </button>
          <button type="button" aria-pressed={comboFechado} className={`segmented-control-btn flex-1 px-3 ${comboFechado ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`} onClick={() => trocarTipo(true)}>
            Fechado
          </button>
        </div>
        <p className="text-sm text-ink-muted">
          {comboFechado
            ? 'Sempre os mesmos itens. O cliente não escolhe.'
            : 'O cliente escolhe em cada etapa (ex.: bebida).'}
        </p>

        {carregando ? <p role="status" className="text-sm text-ink-muted">Carregando composição...</p> : legadoCategoria ? (
          <div className="space-y-3 rounded-2xl border border-line p-4">
            <p className="text-sm text-ink-muted">
              Este combo ainda usa o modo antigo por <strong className="font-semibold text-ink">categoria</strong>.
              Ele continua vendendo normalmente. Para redesenhar no modo simples, monte de novo as escolhas com lista de produtos.
            </p>
            <button
              type="button"
              className="touch-btn-secondary w-full"
              onClick={() => {
                setLegadoCategoria(false);
                setEscolhas([escolhaVazia()]);
              }}
            >
              Remontar com lista de produtos
            </button>
          </div>
        ) : comboFechado ? (
          <section className="rounded-2xl border border-line p-4 space-y-3">
            <h3 className="text-lg font-bold">Itens do combo</h3>
            <ListaItens
              opcoes={itensFechado}
              produtos={produtos}
              produtoPorId={produtoPorId}
              adicionando={adicionandoFechado}
              setAdicionando={setAdicionandoFechado}
              onChangeOpcoes={setItensFechado}
              usaCardapio={usaCardapio}
              somenteCardapioTurno={somenteCardapioFechado}
              onSomenteCardapio={setSomenteCardapioFechado}
            />
          </section>
        ) : (
          <>
            {escolhas.map((escolha, indice) => {
              const erroEscolha = mostrarErros ? errosEscolhas.get(escolha.chave) ?? null : null;
              const limite = Math.max(1, escolha.opcoes.length);
              return (
                <section key={escolha.chave} className="rounded-2xl border border-line p-4 space-y-3" aria-label={escolha.nome || `Escolha ${indice + 1}`}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <input
                        className="w-full border-b border-transparent bg-transparent py-1 text-lg font-bold text-ink placeholder:font-semibold placeholder:text-ink-faint focus:border-brand-400 focus:outline-none"
                        placeholder="Ex.: Bebida"
                        aria-label="Nome da escolha"
                        maxLength={80}
                        value={escolha.nome}
                        onChange={(event) => setEscolhas((atual) => atual.map((item) => item.chave === escolha.chave ? { ...item, nome: event.target.value } : item))}
                      />
                      <p className="text-sm text-ink-muted">
                        {escolha.opcional
                          ? `Pode pular · até ${escolha.quantos}`
                          : `Cliente escolhe ${escolha.quantos}`}
                      </p>
                    </div>
                    <button type="button" className="icon-btn-danger" aria-label="Apagar escolha" title="Apagar escolha" onClick={() => setEscolhas((atual) => atual.filter((item) => item.chave !== escolha.chave))}>
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink-muted">
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-brand-500"
                        checked={escolha.opcional}
                        onChange={(event) => setEscolhas((atual) => atual.map((item) => item.chave === escolha.chave
                          ? { ...item, opcional: event.target.checked, quantos: Math.max(1, item.quantos) }
                          : item))}
                      />
                      Pode pular esta escolha
                    </label>
                    <div className="flex items-center gap-2 text-sm text-ink-muted">
                      <span>{escolha.opcional ? 'Até' : 'Escolhe'}</span>
                      <Stepper
                        valor={escolha.quantos}
                        min={1}
                        max={limite}
                        rotulo="quantos o cliente escolhe"
                        onChange={(quantos) => setEscolhas((atual) => atual.map((item) => item.chave === escolha.chave ? { ...item, quantos } : item))}
                      />
                    </div>
                  </div>

                  <ListaItens
                    opcoes={escolha.opcoes}
                    produtos={produtos}
                    produtoPorId={produtoPorId}
                    adicionando={adicionandoEscolha === escolha.chave}
                    setAdicionando={(v) => setAdicionandoEscolha(v ? escolha.chave : null)}
                    onChangeOpcoes={(opcoes) => setEscolhas((atual) => atual.map((item) => {
                      if (item.chave !== escolha.chave) return item;
                      const quantos = Math.min(item.quantos, Math.max(1, opcoes.length || 1));
                      return { ...item, opcoes, quantos };
                    }))}
                    usaCardapio={usaCardapio}
                    somenteCardapioTurno={escolha.somenteCardapioTurno}
                    onSomenteCardapio={(somenteCardapioTurno) => setEscolhas((atual) => atual.map((item) => item.chave === escolha.chave ? { ...item, somenteCardapioTurno } : item))}
                  />
                  {erroEscolha && <p role="alert" className="text-sm font-semibold text-red-400">{erroEscolha}</p>}
                </section>
              );
            })}
            <button type="button" className="touch-btn-secondary flex w-full items-center justify-center gap-2" onClick={() => setEscolhas((atual) => [...atual, escolhaVazia()])}>
              <IconPlus className="h-4 w-4" /> Adicionar escolha
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
