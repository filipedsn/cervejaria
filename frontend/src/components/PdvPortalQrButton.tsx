import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Cliente, ClienteListResponse } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { usePublicAppOrigin } from '../hooks/usePublicAppOrigin';
import { buildPublicAppUrl } from '../lib/public-app-url';
import { IconQr } from './NavIcons';
import { Modal } from './Modal';
import { QrCodeImage } from './QrCodeImage';

type PortalQrButtonProps = {
  className?: string;
  iconOnly?: boolean;
} & (
  | { pontoVendaId: string; trailerId?: never }
  | { trailerId: string; pontoVendaId?: never }
);

export function PdvPortalQrButton({ pontoVendaId, trailerId, className, iconOnly = false }: PortalQrButtonProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'qr' | 'clients'>('qr');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, Cliente>>({});
  const [queue, setQueue] = useState<Cliente[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [shareError, setShareError] = useState('');
  const { cervejaria } = useAuth();
  const { origin } = usePublicAppOrigin();
  const clientesQuery = useInfiniteQuery({
    queryKey: ['qr-link-clientes', search],
    queryFn: ({ pageParam }) => api.get<ClienteListResponse>(`/api/clientes?q=${encodeURIComponent(search)}&ordenar=nome&page=${pageParam}&limit=100`),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.pagination.page < lastPage.pagination.pages ? lastPage.pagination.page + 1 : undefined,
    enabled: open && view === 'clients',
  });
  const clientesComTelefone = useMemo(() => (clientesQuery.data?.pages.flatMap((result) => result.items) ?? []).filter((cliente) => {
    const digits = (cliente.telefone ?? '').replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 13;
  }), [clientesQuery.data]);
  if (!cervejaria?.slug) return null;
  const isEventPortal = Boolean(trailerId);
  const targetId = trailerId ?? pontoVendaId!;
  const url = buildPublicAppUrl(`/c/${cervejaria.slug}/${isEventPortal ? 't' : 'p'}/${targetId}`, origin);
  const clientesSelecionados = Object.values(selected);
  const whatsappButtonClass = 'group inline-flex min-h-12 items-center gap-3 rounded-xl border border-emerald-400/60 bg-gradient-to-r from-emerald-950 to-emerald-900 px-4 text-sm font-semibold text-white shadow-[0_0_18px_rgba(16,185,129,0.16)] transition hover:border-emerald-300 hover:from-emerald-900 hover:to-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-50';

  const fechar = () => {
    setOpen(false);
    setView('qr');
    setSearch('');
    setSelected({});
    setQueue([]);
    setQueueIndex(0);
    setShareError('');
  };

  const abrirWhatsApp = (cliente: Cliente) => {
    const telefone = (cliente.telefone ?? '').replace(/\D/g, '');
    const telefoneComPais = telefone.startsWith('55') ? telefone : '55' + telefone;
    const contextoLink = isEventPortal
      ? 'O link abre a comanda no evento ativo deste trailer.'
      : 'O link abre a comanda neste ponto de venda enquanto o caixa estiver aberto.';
    const texto = `Oi, ${cliente.nome}! Para abrir sua comanda no ${cervejaria.nome}, acesse este link:\n${url}\n\nInforme seu nome e telefone. ${contextoLink}`;
    const janela = window.open(`https://wa.me/${telefoneComPais}?text=${encodeURIComponent(texto)}`, '_blank');
    if (!janela) {
      setShareError('O navegador bloqueou a nova aba. Permita pop-ups e tente novamente.');
      return false;
    }
    janela.opener = null;
    return true;
  };

  const alternarCliente = (cliente: Cliente) => {
    setSelected((atual) => {
      const proximo = { ...atual };
      if (proximo[cliente.id]) delete proximo[cliente.id];
      else proximo[cliente.id] = cliente;
      return proximo;
    });
  };

  const selecionarVisiveis = () => {
    setSelected((atual) => {
      const todosVisiveisSelecionados = clientesComTelefone.every((cliente) => atual[cliente.id]);
      const proximo = { ...atual };
      for (const cliente of clientesComTelefone) {
        if (todosVisiveisSelecionados) delete proximo[cliente.id];
        else proximo[cliente.id] = cliente;
      }
      return proximo;
    });
  };

  const iniciarEnvios = () => {
    if (clientesSelecionados.length === 0) return;
    const fila = [...clientesSelecionados];
    setShareError('');
    if (!abrirWhatsApp(fila[0])) return;
    setQueue(fila);
    setQueueIndex(1);
  };

  const abrirProximo = () => {
    const cliente = queue[queueIndex];
    if (!cliente) return;
    setShareError('');
    if (abrirWhatsApp(cliente)) setQueueIndex((indice) => indice + 1);
  };

  return <>
    <button
      type="button"
      className={className ?? 'touch-btn-secondary w-full inline-flex items-center justify-center gap-2'}
      onClick={() => setOpen(true)}
      aria-label={iconOnly ? 'Abrir QR Code para comandas' : undefined}
      title={iconOnly ? 'QR Code para abrir comanda' : undefined}
    >
      <IconQr className={iconOnly ? 'h-6 w-6' : 'w-4 h-4'} />
      {!iconOnly && 'QR Code para abrir comanda'}
    </button>
    <Modal open={open} onClose={fechar} wide hideHeader={view === 'clients'} title={view === 'qr' ? `QR Code — Abrir comanda no ${isEventPortal ? 'Evento' : 'Caixa'}` : 'Enviar link por WhatsApp'} footer={view === 'qr' ? <button type="button" className="touch-btn-orange w-full" onClick={fechar}>Fechar</button> : <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between"><button type="button" className="touch-btn-orange inline-flex min-h-14 min-w-[9rem] items-center justify-center gap-3 px-5" onClick={() => { setView('qr'); setShareError(''); }}>Voltar</button>{queue.length === 0 ? <button type="button" className={whatsappButtonClass + ' justify-center'} disabled={!clientesSelecionados.length} onClick={iniciarEnvios}><IconWhatsApp className="h-6 w-6" /><span>Abrir WhatsApp ({clientesSelecionados.length})</span><span aria-hidden="true" className="ml-auto text-xl text-emerald-200">›</span></button> : queueIndex < queue.length ? <button type="button" className={whatsappButtonClass} onClick={abrirProximo}><IconWhatsApp className="h-6 w-6" /><span className="max-w-56 truncate">Próximo: {queue[queueIndex].nome}</span><span aria-hidden="true" className="ml-auto text-xl text-emerald-200">›</span></button> : <button type="button" className="touch-btn-primary inline-flex min-h-14 min-w-[9rem] items-center justify-center gap-3 px-6" onClick={fechar}>Enviar</button>}</div>}>
      {view === 'qr' ? (
        <div className="grid gap-4 py-1 sm:gap-5 lg:grid-cols-[minmax(220px,.75fr)_minmax(0,1.25fr)] lg:items-center">
          <div className="mx-auto flex w-full max-w-xs items-center justify-center rounded-2xl border border-brand-600/40 bg-surface-lighter/50 p-3 sm:p-4"><QrCodeImage value={url} size={256} title={isEventPortal ? 'QR Code abrir comanda no evento' : 'QR Code abrir comanda no caixa'} /></div>
          <div className="space-y-4 sm:space-y-5">
            <div><h3 className="text-xl font-bold text-ink">Como funciona?</h3><p className="mt-2 text-base leading-relaxed text-ink-muted sm:text-lg">{isEventPortal ? 'O cliente escaneia o QR Code para abrir a comanda no evento ativo deste trailer. Ele informa nome e telefone para continuar.' : 'O cliente escaneia o QR Code para abrir a comanda. Ele informa nome e telefone; a comanda é aberta neste ponto de venda enquanto o caixa estiver aberto.'}</p></div>
            <button type="button" className={whatsappButtonClass + ' w-full'} onClick={() => { setView('clients'); setShareError(''); }}><IconWhatsApp className="h-6 w-6" /><span>Enviar link por WhatsApp</span><span aria-hidden="true" className="ml-auto text-xl text-emerald-200 transition-transform group-hover:translate-x-0.5">›</span></button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 py-1 sm:space-y-5">
          <header className="flex items-center gap-3 sm:gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 sm:h-14 sm:w-14"><IconWhatsApp className="h-8 w-8" /></span>
            <h2 id="modal-title" className="min-w-0 flex-1 text-lg font-bold text-ink sm:text-2xl">Enviar link por WhatsApp</h2>
            <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-2xl text-ink-muted hover:bg-surface-lighter hover:text-ink" aria-label="Fechar" onClick={fechar}>×</button>
          </header>
          <p className="text-sm leading-relaxed text-ink-muted sm:text-base">Selecione clientes com telefone cadastrado. O WhatsApp abrirá uma conversa por vez, com o link pronto para você revisar e enviar.</p>
          <div className="relative"><svg viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg><input className="input" style={{ paddingLeft: '3rem' }} type="search" value={search} placeholder="Buscar cliente por nome ou telefone..." onChange={(event) => { setSearch(event.target.value); setQueue([]); setQueueIndex(0); }} /></div>
          <div className="flex items-center gap-3 rounded-xl border border-brand-500/30 bg-brand-500/10 px-4 py-3"><svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 text-brand-400" fill="currentColor" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7.5 8a7.5 7.5 0 0 1 15 0v1h-15v-1Zm14-8.7a3.2 3.2 0 1 0-1.1-6.2 6.2 6.2 0 0 1 0 6.2c.3 0 .7 0 1.1 0Zm.2 2.1a6.1 6.1 0 0 1 3.3 5.6v1h-3.8v-1a9.5 9.5 0 0 0-1.5-5.1 6 6 0 0 1 2 .5Z"/></svg><span className="flex-1 font-semibold text-ink">{clientesSelecionados.length} selecionado(s)</span><button type="button" className="border-l border-brand-500/30 pl-3 text-sm font-semibold text-brand-400 hover:text-brand-300 disabled:opacity-50" onClick={selecionarVisiveis} disabled={!clientesComTelefone.length}>{clientesComTelefone.length > 0 && clientesComTelefone.every((cliente) => selected[cliente.id]) ? 'Desmarcar carregados' : 'Selecionar carregados'}</button></div>
          {clientesQuery.isLoading ? <p className="py-8 text-center text-sm text-ink-muted">Carregando clientes...</p> : clientesComTelefone.length === 0 ? <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-muted">Nenhum cliente com telefone encontrado.</p> : (
            <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
              {clientesComTelefone.map((cliente) => { const marcado = Boolean(selected[cliente.id]); const iniciais = cliente.nome.trim().split(/\s+/).slice(0, 2).map((parte) => parte[0] ?? '').join('').toUpperCase(); return <label key={cliente.id} className={'flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition sm:gap-4 sm:p-4 ' + (marcado ? 'border-brand-500 bg-brand-500/10 shadow-[0_0_16px_rgba(14,165,233,0.12)]' : 'border-line bg-surface-lighter hover:border-brand-500/40')}><input type="checkbox" className="h-5 w-5 shrink-0 accent-sky-500 sm:h-6 sm:w-6" checked={marcado} onChange={() => alternarCliente(cliente)} /><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-brand-500/60 bg-brand-500/10 text-sm font-bold text-brand-300 sm:h-14 sm:w-14 sm:text-base">{iniciais}</span><span className="min-w-0 flex-1"><strong className="block truncate text-sm text-ink sm:text-base">{cliente.nome}</strong><span className="mt-0.5 block text-sm text-ink-muted">{cliente.telefone}</span></span></label>; })}
            </div>
          )}
          {clientesQuery.hasNextPage && <button type="button" className="touch-btn-secondary w-full" disabled={clientesQuery.isFetchingNextPage} onClick={() => clientesQuery.fetchNextPage()}>{clientesQuery.isFetchingNextPage ? 'Carregando...' : 'Carregar mais clientes'}</button>}
          {shareError && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{shareError}</p>}
          {queue.length > 0 && <div className="flex items-start gap-3 rounded-2xl border border-brand-500/40 bg-brand-500/10 p-3 sm:p-4"><svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 text-brand-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></svg><p className="text-sm leading-relaxed text-ink-muted"><strong className="block text-brand-300">{Math.min(queueIndex, queue.length)} de {queue.length} conversas abertas.</strong>Revise e envie a mensagem no WhatsApp antes de abrir a próxima.</p></div>}
        </div>
      )}
    </Modal>
  </>;
}

function IconWhatsApp({ className = 'h-5 w-5' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.2 11.8a8.2 8.2 0 0 1-12.1 7.1L3 20l1.2-4.8a8.2 8.2 0 1 1 16-3.4Z"/><path d="M8.2 7.8c.2-.5.5-.5.8-.5h.5c.2 0 .4.1.5.4l.8 1.8c.1.2.1.4-.1.6l-.6.7c-.2.2-.2.4-.1.6.6 1.1 1.5 2 2.7 2.6.2.1.4.1.6-.1l.8-1c.2-.2.4-.3.7-.2l1.7.8c.3.1.4.3.4.5 0 .4-.2 1.2-.8 1.7-.6.6-1.4.8-2.1.7-1.1-.2-2.4-.7-3.9-2-1.2-1.1-2.1-2.4-2.4-3.5-.3-1.1 0-2.1.5-2.6Z"/></svg>;
}
