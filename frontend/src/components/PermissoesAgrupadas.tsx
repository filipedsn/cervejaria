import { useEffect, useId, useRef, type ReactNode } from 'react';

const PERMISSOES_UI = [
  ['cash.open', 'Abrir caixa', 'Inicia um turno de caixa.'],
  ['cash.close', 'Fechar caixa', 'Encerra o turno de caixa. Exige também Visualizar valores do caixa.'],
  ['cash.values.read', 'Visualizar valores do caixa', 'Mostra totais, movimentos e resumo financeiro do turno.'],
  ['cash.movement.write', 'Registrar suprimento e sangria', 'Lança entradas e retiradas no caixa. Corrigir movimentos exige também Visualizar valores do caixa.'],
  ['payment.receive', 'Receber pagamentos', 'Registra pagamentos em comandas e vendas.'],
  ['debt.receive', 'Receber dívidas', 'Registra recebimentos de contas pendentes.'],
  ['command.close', 'Fechar comandas', 'Encerra comandas. Para receber, exige também Receber pagamentos.'],
  ['discount.apply', 'Aplicar descontos', 'Aplica desconto em comanda e venda avulsa.'],
  ['command.item.cancel', 'Cancelar itens', 'Remove itens e reduz quantidades, inclusive pelo fluxo de cancelamento da cozinha.'],
  ['command.item.cancel.delivered', 'Cancelar item já entregue', 'Retira da cobrança em comanda aberta. Exige também Cancelar itens; o tratamento de estoque é escolhido no cancelamento.'],
  ['command.cancel', 'Cancelar comanda inteira', 'Cancela a comanda inteira; concessao individual exige autorizacao explicita.'],
  ['kitchen.cancel', 'Cancelar pedidos da cozinha', 'Solicita cancelamento de pedido; exige também estorno de venda.'],
  ['sale.refund', 'Estornar venda', 'Estorna venda paga no cancelamento do pedido. Exige também Cancelar pedidos da cozinha.'],
  ['dashboard.read', 'Visualizar dashboard', 'Acessa os painéis consolidados financeiros.'],
  ['event.dashboard.read', 'Visualizar painel do evento', 'Acessa indicadores e valores do evento.'],
  ['reports.read', 'Visualizar relatórios', 'Acessa relatórios financeiros e exportações CSV.'],
  ['command.operate', 'Abrir comandas e lançar itens', 'Abre comandas, inclui itens e aumenta quantidades; não concede consulta, fechamento, pagamento ou cancelamento.'],
  ['command.read', 'Consultar comandas', 'Lê listas e detalhes operacionais sem permitir abertura ou lançamento.'],
  ['kitchen.read', 'Consultar fila da cozinha', 'Lê a fila e os itens sem permitir transições de preparo/entrega.'],
  ['kitchen.operate', 'Avançar preparo e entrega', 'Transiciona pedidos; cancelamento e estorno continuam separados.'],
  ['inventory.read', 'Consultar estoque', 'Lê saldos do ponto de venda sem registrar movimentações.'],
  ['inventory.adjust', 'Movimentar estoque manualmente', 'Registra entradas, saídas, ajustes e inventário. Vendas autorizadas podem baixar estoque automaticamente.'],
  ['catalog.shift.manage', 'Manter cardápio e preços do turno', 'Escolhe o cardápio do turno e ajusta seu preço operacional. Não altera catálogo ou preços globais.'],
  ['catalog.manage', 'Manter catálogo e cardápios globais', 'Edita produtos, preços, disponibilidade, opcionais, cardápios modelo e preço global.'],
  ['clients.manage', 'Administrar clientes', 'Consulta a lista administrativa e cria/edita clientes; merge e exclusão seguem exclusivos do dono.'],
  ['taps.operate', 'Montar e operar Taps', 'Monta, troca, remove ou ativa Taps no turno e em evento; configuração do cadastro segue exclusiva do dono.'],
  ['agenda.manage', 'Administrar agendas', 'Cria e edita agendas e ocorrências e gera ocorrências futuras.'],
  ['event.menu.manage', 'Configurar cardápio do evento', 'Seleciona produtos ou cardápio de um evento; não concede manutenção do catálogo geral.'],
] as const;


const GRUPOS = [
  ['Atendimento', ['command.read', 'command.operate', 'command.close', 'command.item.cancel', 'command.item.cancel.delivered', 'command.cancel', 'discount.apply']],
  ['Caixa e pagamentos', ['cash.open', 'cash.close', 'cash.values.read', 'cash.movement.write', 'payment.receive', 'debt.receive', 'sale.refund']],
  ['Cozinha', ['kitchen.read', 'kitchen.operate', 'kitchen.cancel']],
  ['Estoque', ['inventory.read', 'inventory.adjust']],
  ['Catálogo', ['catalog.shift.manage', 'catalog.manage', 'event.menu.manage']],
  ['Clientes', ['clients.manage']],
  ['Agenda e TAPs', ['agenda.manage', 'taps.operate']],
  ['Dashboard e relatórios', ['dashboard.read', 'event.dashboard.read', 'reports.read']],
] as const;

export function PermissoesAgrupadas({ permissions, onChange, disabled = false }: {
  permissions: string[]; onChange: (permissions: string[]) => void; disabled?: boolean;
}) {
  const id = useId();
  return <div className="space-y-3">
    <p className="text-sm text-ink-muted">Selecione os acessos e salve ao terminar. Dependências precisam ser marcadas separadamente.</p>
    {GRUPOS.map(([nome, keys]) => <details key={nome} className="rounded-xl border border-line">
      <summary className="min-h-12 cursor-pointer p-3 text-sm font-semibold text-ink">
        {nome} <span className="text-ink-muted">({keys.filter(key => permissions.includes(key)).length}/{keys.length})</span>
      </summary>
      <div className="space-y-2 p-2 pt-0">
        {PERMISSOES_UI.filter(([key]) => (keys as readonly string[]).includes(key)).map(([key, label, description]) =>
          <label key={key} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg bg-surface-lighter p-3">
            <input type="checkbox" checked={permissions.includes(key)} disabled={disabled}
              onChange={() => onChange(permissions.includes(key) ? permissions.filter(item => item !== key) : [...permissions, key])}
              aria-label={label} aria-describedby={id + '-' + key} className="mt-1 h-5 w-5 shrink-0" />
            <span className="min-w-0 break-words">
              <span className="block text-sm font-semibold text-ink">{label}</span>
              <span id={id + '-' + key} className="mt-1 block text-xs text-ink-muted">{description}</span>
            </span>
          </label>)}
      </div>
    </details>)}
  </div>;
}

// Kept local to access management: native focus containment and keyboard viewport.
export function AcessosDialog({ title, onClose, children, footer, hideCloseButton = false }: {
  title: string; onClose: () => void; children: ReactNode; footer: ReactNode; hideCloseButton?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const viewport = window.visualViewport;
    const resize = () => {
      const availableHeight = viewport?.height ?? window.innerHeight;
      const height = Math.min(availableHeight * 0.94, 860);
      dialog.style.height = height + 'px';
      dialog.style.top = ((viewport?.offsetTop ?? 0) + (availableHeight - height) / 2) + 'px';
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
      document.body.style.overflow = overflow;
      dialog.close();
      previousFocus?.focus();
    };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} aria-modal="true"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className="fixed inset-x-0 bottom-auto mx-auto my-0 w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/60">
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))]">
        <h2 id={titleId} className="text-lg font-bold">{title}</h2>
        {!hideCloseButton && <button type="button" aria-label="Fechar" onClick={onClose} className="min-h-12 min-w-12 rounded-xl text-2xl">×</button>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">{children}</div>
      <footer className="shrink-0 border-t border-line pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</footer>
    </div>
  </dialog>;
}
