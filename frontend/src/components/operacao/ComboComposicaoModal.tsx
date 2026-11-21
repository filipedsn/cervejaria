import { useEffect, useState } from 'react';
import { api, ApiError, formatCurrency } from '../../lib/api';
import { formatCurrencyInputFromNumber, parseCurrencyInput } from '../../lib/currency';
import { precoBaseCombo, precoMaximoCombo, type ComboGrupoModo, type ComboGrupoPrecoModo, type ComposicaoCombo } from '../../lib/combo';
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
type GrupoForm = {
  chave: string;
  nome: string;
  minimo: number;
  maximo: number;
  somenteCardapioTurno: boolean;
  faixa: boolean;
  modo: ComboGrupoModo;
  categoria: string;
  categoriaPdvId: string;
  precoModo: ComboGrupoPrecoModo;
  precoFixo: string;
  opcoes: OpcaoForm[];
};

const LIMITE_QUANTIDADE = 20;
let proximaChave = 0;
const novaChave = () => `grupo-${++proximaChave}`;
const grupoVazio = (): GrupoForm => ({
  chave: novaChave(),
  nome: '',
  minimo: 1,
  maximo: 1,
  somenteCardapioTurno: false,
  faixa: false,
  modo: 'LISTA',
  categoria: '',
  categoriaPdvId: '',
  precoModo: 'FIXO',
  precoFixo: formatCurrencyInputFromNumber(0),
  opcoes: [],
});
const categoriaDe = (produto: ProdutoParaCombo) => produto.categoria?.trim() || 'Outros';

function produtosDaCategoria(produtos: ProdutoParaCombo[], grupo: GrupoForm): ProdutoParaCombo[] {
  if (!grupo.categoria && !grupo.categoriaPdvId) return [];
  return produtos.filter((produto) => {
    if (grupo.categoriaPdvId && produto.categoriaPdvId) return produto.categoriaPdvId === grupo.categoriaPdvId;
    return categoriaDe(produto) === grupo.categoria;
  });
}

function opcoesParaCalculo(grupo: GrupoForm, produtos: ProdutoParaCombo[]) {
  if (grupo.modo === 'CATEGORIA') {
    const precoFixo = parseCurrencyInput(grupo.precoFixo);
    return produtosDaCategoria(produtos, grupo).map((produto) => ({
      precoNoCombo: grupo.precoModo === 'FIXO' ? precoFixo : Number(produto.precoUnit) || 0,
      quantidade: 1,
    }));
  }
  return grupo.opcoes.map((opcao) => ({ precoNoCombo: parseCurrencyInput(opcao.precoNoCombo), quantidade: opcao.quantidade }));
}

function resumoRegra(grupo: GrupoForm): string {
  if (grupo.minimo === 0) return grupo.maximo === 1 ? 'Opcional: o cliente pode escolher 1' : `Opcional: o cliente pode escolher até ${grupo.maximo}`;
  if (grupo.minimo === grupo.maximo) return `O cliente escolhe ${grupo.minimo}`;
  return `O cliente escolhe de ${grupo.minimo} a ${grupo.maximo}`;
}

function validarGrupo(grupo: GrupoForm, produtos: ProdutoParaCombo[]): string | null {
  if (!grupo.nome.trim()) return 'Dê um nome para esta pergunta.';
  if (grupo.modo === 'CATEGORIA') {
    if (!grupo.categoria.trim() && !grupo.categoriaPdvId) return 'Escolha a categoria.';
    if (grupo.categoria === 'Chope') return 'A categoria Chope não pode entrar em combo.';
    if (grupo.precoModo === 'FIXO' && !(parseCurrencyInput(grupo.precoFixo) >= 0)) return 'Informe o preço fixo.';
    const daCategoria = produtosDaCategoria(produtos, grupo);
    if (daCategoria.length === 0) return 'Essa categoria não tem produtos ativos.';
    if (grupo.maximo > daCategoria.length) return `A regra permite escolher ${grupo.maximo}, mas a categoria tem só ${daCategoria.length} produto(s).`;
    return null;
  }
  if (grupo.opcoes.length === 0) return 'Adicione ao menos um produto.';
  if (grupo.maximo > grupo.opcoes.length) return `A regra permite escolher ${grupo.maximo}, mas há só ${grupo.opcoes.length} produto(s).`;
  return null;
}

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

function OpcaoComboLinha({ opcao, produto, onChange, onRemover }: {
  opcao: OpcaoForm;
  produto: ProdutoParaCombo | undefined;
  onChange: (alteracao: Partial<OpcaoForm>) => void;
  onRemover: () => void;
}) {
  const nome = produto?.nome ?? 'Produto indisponível';
  const avulso = produto ? Number(produto.precoUnit) : null;
  const noCombo = parseCurrencyInput(opcao.precoNoCombo);
  const diferenca = avulso === null ? 0 : Math.round((avulso - noCombo) * 100) / 100;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <Stepper valor={opcao.quantidade} min={1} max={LIMITE_QUANTIDADE} sufixo="×" rotulo={`quantidade de ${nome}`} onChange={(quantidade) => onChange({ quantidade })} />
      <div className="min-w-0 flex-1 basis-36">
        <p className="break-words font-semibold leading-snug">{nome}</p>
        {avulso !== null && (
          <p className="flex flex-wrap gap-x-2 text-xs text-ink-faint">
            <span>avulso {formatCurrency(avulso)}</span>
            {diferenca > 0 && <span className="font-semibold text-emerald-400">{formatCurrency(diferenca)} a menos</span>}
            {diferenca < 0 && <span className="font-semibold text-amber-400">{formatCurrency(-diferenca)} a mais</span>}
          </p>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <div className="w-32 shrink-0">
          <CurrencyInput className="input text-right font-semibold" aria-label={`Preço de ${nome} no combo`} value={opcao.precoNoCombo} onChange={(precoNoCombo) => onChange({ precoNoCombo })} />
        </div>
        <button type="button" className="icon-btn-danger" aria-label={`Tirar ${nome} do grupo`} title="Tirar do grupo" onClick={onRemover}>
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
        <p>Todos os produtos do catálogo já estão neste grupo.</p>
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
            <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface">
              <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand-500" checked={marcados.has(produto.id)} onChange={() => alternar(produto.id)} />
              <span className="min-w-0 flex-1 break-words font-semibold">{produto.nome}</span>
              <span className="shrink-0 text-sm tabular-nums text-ink-muted">{formatCurrency(Number(produto.precoUnit) || 0)}</span>
            </label>
          </li>
        ))}
        {visiveis.length === 0 && <li className="px-2 py-3 text-sm text-ink-muted">Nenhum produto encontrado.</li>}
      </ul>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="touch-btn-secondary" onClick={onCancelar}>Cancelar</button>
        <button type="button" className="touch-btn-primary" disabled={marcados.size === 0} onClick={() => onAdicionar(disponiveis.filter((produto) => marcados.has(produto.id)))}>
          {marcados.size === 0 ? 'Adicionar' : `Adicionar ${marcados.size}`}
        </button>
      </div>
    </div>
  );
}

function GrupoComboEditor({ grupo, indice, produtos, produtoPorId, categorias, usaCardapio, erro, onChange, onRemover }: {
  grupo: GrupoForm;
  indice: number;
  produtos: ProdutoParaCombo[];
  produtoPorId: Map<string, ProdutoParaCombo>;
  categorias: Array<{ nome: string; categoriaPdvId: string }>;
  usaCardapio: boolean;
  erro: string | null;
  onChange: (alterar: (grupo: GrupoForm) => GrupoForm) => void;
  onRemover: () => void;
}) {
  const [adicionando, setAdicionando] = useState(false);
  const opcional = grupo.minimo === 0;
  const daCategoria = produtosDaCategoria(produtos, grupo);
  const limite = Math.max(1, grupo.modo === 'CATEGORIA' ? daCategoria.length : grupo.opcoes.length);
  const disponiveis = produtos.filter((produto) => !grupo.opcoes.some((opcao) => opcao.produtoId === produto.id));
  const tornarOpcional = (valor: boolean) => onChange((atual) => valor
    ? { ...atual, minimo: 0, faixa: false }
    : { ...atual, minimo: atual.faixa ? 1 : atual.maximo });
  const trocarModo = (modo: ComboGrupoModo) => onChange((atual) => ({
    ...atual,
    modo,
    opcoes: modo === 'LISTA' ? atual.opcoes : [],
    categoria: modo === 'CATEGORIA' ? atual.categoria : '',
    categoriaPdvId: modo === 'CATEGORIA' ? atual.categoriaPdvId : '',
    maximo: Math.min(atual.maximo, Math.max(1, modo === 'CATEGORIA' ? (atual.categoria ? produtosDaCategoria(produtos, { ...atual, modo }).length || 1 : 1) : atual.opcoes.length || 1)),
  }));

  return (
    <section className="rounded-2xl border border-line p-4" aria-label={grupo.nome || `Pergunta ${indice + 1}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <input
            className="w-full border-b border-transparent bg-transparent py-1 text-lg font-bold text-ink placeholder:font-semibold placeholder:text-ink-faint focus:border-brand-400 focus:outline-none"
            placeholder="Nome da pergunta, ex.: Complementos"
            aria-label="Nome da pergunta"
            maxLength={80}
            value={grupo.nome}
            onChange={(event) => onChange((atual) => ({ ...atual, nome: event.target.value }))}
          />
          <p className="text-sm text-ink-muted">{resumoRegra(grupo)}</p>
        </div>
        <button type="button" className="icon-btn-danger" aria-label={`Apagar a pergunta ${grupo.nome || indice + 1}`} title="Apagar pergunta" onClick={onRemover}>
          <IconTrash className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="segmented-control" role="group" aria-label="Como montar esta pergunta">
          {([['LISTA', 'Lista de produtos'], ['CATEGORIA', 'Categoria']] as const).map(([valor, rotulo]) => (
            <button key={valor} type="button" aria-pressed={grupo.modo === valor} className={`segmented-control-btn px-4 ${grupo.modo === valor ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`} onClick={() => trocarModo(valor)}>
              {rotulo}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="segmented-control" role="group" aria-label="A escolha é obrigatória?">
          {([[false, 'Obrigatório'], [true, 'Opcional']] as const).map(([valor, rotulo]) => (
            <button key={rotulo} type="button" aria-pressed={opcional === valor} className={`segmented-control-btn px-4 ${opcional === valor ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`} onClick={() => tornarOpcional(valor)}>
              {rotulo}
            </button>
          ))}
        </div>
        {grupo.faixa && !opcional ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span>De</span>
            <Stepper valor={grupo.minimo} min={1} max={grupo.maximo} rotulo="mínimo de escolhas" onChange={(minimo) => onChange((atual) => ({ ...atual, minimo }))} />
            <span>a</span>
            <Stepper valor={grupo.maximo} min={grupo.minimo} max={limite} rotulo="máximo de escolhas" onChange={(maximo) => onChange((atual) => ({ ...atual, maximo }))} />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <span>{opcional ? 'Até' : 'Escolhe'}</span>
            <Stepper
              valor={grupo.maximo}
              min={1}
              max={limite}
              rotulo="quantidade de escolhas"
              onChange={(maximo) => onChange((atual) => ({ ...atual, maximo, minimo: opcional ? 0 : maximo }))}
            />
          </div>
        )}
        {!opcional && (
          <button
            type="button"
            className="text-sm font-semibold text-brand-400 underline-offset-4 hover:underline"
            onClick={() => onChange((atual) => atual.faixa
              ? { ...atual, faixa: false, minimo: atual.maximo }
              : { ...atual, faixa: true, minimo: 1 })}
          >
            {grupo.faixa ? 'Número fixo' : 'Permitir faixa'}
          </button>
        )}
      </div>

      {grupo.modo === 'CATEGORIA' ? (
        <div className="mt-3 space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="font-semibold text-ink-muted">Categoria</span>
            <select
              className="input"
              aria-label="Categoria da pergunta"
              value={grupo.categoriaPdvId || grupo.categoria}
              onChange={(event) => {
                const escolhida = categorias.find((item) => item.categoriaPdvId === event.target.value || item.nome === event.target.value);
                onChange((atual) => {
                  const proximo = {
                    ...atual,
                    categoria: escolhida?.nome ?? event.target.value,
                    categoriaPdvId: escolhida?.categoriaPdvId ?? '',
                  };
                  const total = produtosDaCategoria(produtos, proximo).length;
                  const maximo = Math.min(atual.maximo, Math.max(1, total || 1));
                  return { ...proximo, maximo, minimo: Math.min(atual.minimo, maximo) };
                });
              }}
            >
              <option value="">Selecione</option>
              {categorias.filter((item) => item.nome !== 'Chope').map((item) => (
                <option key={item.categoriaPdvId || item.nome} value={item.categoriaPdvId || item.nome}>{item.nome}</option>
              ))}
            </select>
          </label>

          <div className="segmented-control" role="group" aria-label="Como precificar esta categoria">
            {([['FIXO', 'Preço fixo'], ['CATALOGO', 'Preço do catálogo']] as const).map(([valor, rotulo]) => (
              <button key={valor} type="button" aria-pressed={grupo.precoModo === valor} className={`segmented-control-btn px-4 ${grupo.precoModo === valor ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`} onClick={() => onChange((atual) => ({ ...atual, precoModo: valor }))}>
                {rotulo}
              </button>
            ))}
          </div>

          {grupo.precoModo === 'FIXO' && (
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-ink-muted">Preço de cada escolha</span>
              <div className="w-32 shrink-0">
                <CurrencyInput className="input text-right font-semibold" aria-label="Preço fixo da categoria" value={grupo.precoFixo} onChange={(precoFixo) => onChange((atual) => ({ ...atual, precoFixo }))} />
              </div>
            </label>
          )}

          {daCategoria.length > 0 ? (
            <ul className="divide-y divide-line border-t border-line">
              {daCategoria.map((produto) => {
                const preco = grupo.precoModo === 'FIXO' ? parseCurrencyInput(grupo.precoFixo) : Number(produto.precoUnit) || 0;
                return (
                  <li key={produto.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 break-words font-semibold">{produto.nome}</span>
                    <span className="shrink-0 tabular-nums text-ink-muted">{formatCurrency(preco)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-ink-muted">
              {grupo.categoria || grupo.categoriaPdvId ? 'Nenhum produto ativo nesta categoria.' : 'Escolha a categoria para ver os produtos.'}
            </p>
          )}
        </div>
      ) : (
        <>
          {grupo.opcoes.length > 0 ? (
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {grupo.opcoes.map((opcao) => (
                <OpcaoComboLinha
                  key={opcao.produtoId}
                  opcao={opcao}
                  produto={produtoPorId.get(opcao.produtoId)}
                  onChange={(alteracao) => onChange((atual) => ({ ...atual, opcoes: atual.opcoes.map((item) => item.produtoId === opcao.produtoId ? { ...item, ...alteracao } : item) }))}
                  onRemover={() => onChange((atual) => {
                    const opcoes = atual.opcoes.filter((item) => item.produtoId !== opcao.produtoId);
                    const maximo = Math.min(atual.maximo, Math.max(1, opcoes.length));
                    return { ...atual, opcoes, maximo, minimo: Math.min(atual.minimo, maximo) };
                  })}
                />
              ))}
            </ul>
          ) : !adicionando && (
            <p className="mt-3 rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-ink-muted">
              Nenhum produto ainda. Adicione os que o cliente pode escolher.
            </p>
          )}

          <div className="mt-3 space-y-3">
            {adicionando ? (
              <SeletorProdutosCombo
                disponiveis={disponiveis}
                onCancelar={() => setAdicionando(false)}
                onAdicionar={(novos) => {
                  onChange((atual) => ({
                    ...atual,
                    opcoes: [...atual.opcoes, ...novos.map((produto) => ({ produtoId: produto.id, precoNoCombo: formatCurrencyInputFromNumber(produto.precoUnit), quantidade: 1 }))],
                  }));
                  setAdicionando(false);
                }}
              />
            ) : (
              <button type="button" className="touch-btn-secondary flex w-full items-center justify-center gap-2" onClick={() => setAdicionando(true)}>
                <IconPlus className="h-4 w-4" /> Adicionar produtos
              </button>
            )}
          </div>
        </>
      )}

      <div className="mt-3 space-y-3">
        {usaCardapio && (
          <label className="flex cursor-pointer items-start gap-3 text-sm text-ink-muted">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-500" checked={grupo.somenteCardapioTurno} onChange={(event) => onChange((atual) => ({ ...atual, somenteCardapioTurno: event.target.checked }))} />
            Mostrar só os produtos que estão no cardápio do turno
          </label>
        )}
        {erro && <p role="alert" className="text-sm font-semibold text-red-400">{erro}</p>}
      </div>
    </section>
  );
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
  const [grupos, setGrupos] = useState<GrupoForm[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [mostrarErrosGrupos, setMostrarErrosGrupos] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErro('');
    setMostrarErrosGrupos(false);
    setCarregando(true);
    api.get<ComposicaoCombo>(`/api/operacao/produtos/${comboId}/combo`)
      .then((composicao) => setGrupos(composicao.grupos.length
        ? composicao.grupos.map((grupo) => {
          const modo: ComboGrupoModo = grupo.modo === 'CATEGORIA' ? 'CATEGORIA' : 'LISTA';
          return {
            chave: novaChave(),
            nome: grupo.nome,
            minimo: grupo.minimo,
            maximo: grupo.maximo,
            somenteCardapioTurno: grupo.somenteCardapioTurno,
            faixa: grupo.minimo > 0 && grupo.minimo !== grupo.maximo,
            modo,
            categoria: grupo.categoria ?? '',
            categoriaPdvId: grupo.categoriaPdvId ?? '',
            precoModo: grupo.precoModo === 'CATALOGO' ? 'CATALOGO' : 'FIXO',
            precoFixo: formatCurrencyInputFromNumber(grupo.precoFixo ?? 0),
            opcoes: modo === 'LISTA'
              ? grupo.opcoes.map((opcao) => ({ produtoId: opcao.produtoId, precoNoCombo: formatCurrencyInputFromNumber(opcao.precoNoCombo), quantidade: opcao.quantidade }))
              : [],
          };
        })
        : [grupoVazio()]))
      .catch((error) => setErro(error instanceof ApiError ? error.message : 'Não foi possível carregar a composição'))
      .finally(() => setCarregando(false));
  }, [open, comboId]);

  const produtoPorId = new Map(produtos.map((produto) => [produto.id, produto]));
  const categorias = [...produtos.reduce((mapa, produto) => {
    const nome = categoriaDe(produto);
    if (!mapa.has(nome)) mapa.set(nome, { nome, categoriaPdvId: produto.categoriaPdvId ?? '' });
    else if (!mapa.get(nome)!.categoriaPdvId && produto.categoriaPdvId) mapa.set(nome, { nome, categoriaPdvId: produto.categoriaPdvId });
    return mapa;
  }, new Map<string, { nome: string; categoriaPdvId: string }>()).values()]
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const gruposCalculo = grupos.map((grupo) => ({
    minimo: grupo.minimo,
    maximo: grupo.maximo,
    opcoes: opcoesParaCalculo(grupo, produtos),
  }));
  const minimo = precoBaseCombo(gruposCalculo);
  const maximo = precoMaximoCombo(gruposCalculo);
  const errosGrupos = new Map(grupos.map((grupo) => [grupo.chave, validarGrupo(grupo, produtos)]));

  const salvar = async () => {
    setErro('');
    setMostrarErrosGrupos(true);
    if (grupos.length === 0) return setErro('Adicione ao menos uma pergunta ao combo.');
    if ([...errosGrupos.values()].some(Boolean)) return;
    if (!grupos.some((grupo) => grupo.minimo >= 1)) return setErro('Ao menos uma pergunta precisa ser obrigatória.');
    setSalvando(true);
    try {
      await api.put(`/api/operacao/produtos/${comboId}/combo`, {
        grupos: grupos.map((grupo) => (
          grupo.modo === 'CATEGORIA'
            ? {
              nome: grupo.nome.trim(),
              minimo: grupo.minimo,
              maximo: grupo.maximo,
              somenteCardapioTurno: grupo.somenteCardapioTurno,
              modo: 'CATEGORIA' as const,
              categoria: grupo.categoria || null,
              categoriaPdvId: grupo.categoriaPdvId || null,
              precoModo: grupo.precoModo,
              precoFixo: grupo.precoModo === 'FIXO' ? parseCurrencyInput(grupo.precoFixo) : null,
              opcoes: [],
            }
            : {
              nome: grupo.nome.trim(),
              minimo: grupo.minimo,
              maximo: grupo.maximo,
              somenteCardapioTurno: grupo.somenteCardapioTurno,
              modo: 'LISTA' as const,
              opcoes: grupo.opcoes.map((opcao) => ({ produtoId: opcao.produtoId, precoNoCombo: parseCurrencyInput(opcao.precoNoCombo), quantidade: opcao.quantidade })),
            }
        )),
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
      title={`Combo ${comboNome}`}
      hideHeaderClose
      footer={(
        <>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-ink-muted">{minimo === maximo ? 'O combo sai por' : 'O combo sai de'}</span>
            <span className="text-right text-xl font-bold tabular-nums">
              {minimo === maximo ? formatCurrency(minimo) : `${formatCurrency(minimo)} a ${formatCurrency(maximo)}`}
            </span>
          </div>
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
          Monte as perguntas que o atendente faz ao cliente. Use lista de produtos ou uma categoria inteira (ex.: complementos do açaí).
        </p>
        {carregando ? <p role="status" className="text-sm text-ink-muted">Carregando composição...</p> : (
          <>
            {grupos.map((grupo, indice) => (
              <GrupoComboEditor
                key={grupo.chave}
                grupo={grupo}
                indice={indice}
                produtos={produtos}
                produtoPorId={produtoPorId}
                categorias={categorias}
                usaCardapio={usaCardapio}
                erro={mostrarErrosGrupos ? errosGrupos.get(grupo.chave) ?? null : null}
                onChange={(alterar) => setGrupos((atual) => atual.map((item) => item.chave === grupo.chave ? alterar(item) : item))}
                onRemover={() => setGrupos((atual) => atual.filter((item) => item.chave !== grupo.chave))}
              />
            ))}
            <button type="button" className="touch-btn-secondary flex w-full items-center justify-center gap-2" onClick={() => setGrupos((atual) => [...atual, grupoVazio()])}>
              <IconPlus className="h-4 w-4" /> Adicionar pergunta
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
