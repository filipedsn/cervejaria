import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  hideHeaderClose?: boolean;
  closeOnBackdrop?: boolean;
  compact?: boolean;
  wide?: boolean;
  extraWide?: boolean;
  hideHeader?: boolean;
  noBodyScroll?: boolean;
  /** Night Tap shell for the public portal (keeps staff modals on the default theme). */
  tone?: 'default' | 'night';
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  hideHeaderClose,
  closeOnBackdrop = true,
  compact = false,
  wide = false,
  extraWide = false,
  hideHeader = false,
  noBodyScroll = false,
  tone = 'default',
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusFirst = () => {
      const first = dialog?.querySelector<HTMLElement>(focusableSelector);
      (first ?? dialog)?.focus({ preventScroll: true });
    };
    const frame = window.requestAnimationFrame(focusFirst);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <div
        className="overlay-backdrop"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal
        aria-labelledby="modal-title"
        tabIndex={-1}
        className={`relative ${
          tone === 'night'
            ? 'modal-tone-night border-slate-600/40 sm:rounded-2xl'
            : extraWide
              ? 'bg-gradient-to-br from-surface via-surface to-brand-950/30 border-brand-500/35 sm:rounded-3xl'
              : 'bg-surface border-line sm:rounded-2xl'
        } rounded-t-3xl w-full ${compact ? 'max-w-lg' : extraWide ? 'max-w-lg sm:max-w-6xl' : wide ? 'max-w-lg sm:max-w-4xl' : 'max-w-lg sm:max-w-2xl'} max-h-[92dvh] flex flex-col overflow-hidden border sm:mx-4 animate-slide-up shadow-xl`}
      >
        <div className="flex justify-center pt-3 pb-1 sm:hidden shrink-0">
          <div className={`w-10 h-1 rounded-full ${tone === 'night' ? 'bg-slate-500/70' : 'bg-line-soft'}`} aria-hidden />
        </div>
        {!hideHeader && <div className="shrink-0 px-4 sm:px-6 pt-2 sm:pt-6">
          <div
            className={`flex items-center gap-3 ${compact ? 'mb-2' : 'mb-4'} ${hideHeaderClose ? '' : 'justify-between'}`}
          >
            <h2 id="modal-title" className={`text-lg sm:text-xl font-bold leading-tight ${tone === 'night' ? 'text-slate-50' : 'text-ink'}`}>
              {title}
            </h2>
            {!hideHeaderClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar"
                className={`shrink-0 min-h-12 min-w-12 flex items-center justify-center text-2xl rounded-xl ${
                  tone === 'night' ? 'text-slate-300 active:bg-slate-800' : 'text-ink-muted active:bg-surface-lighter'
                }`}
              >
                ×
              </button>
            )}
          </div>
        </div>}
        <div
          className={`flex-1 min-h-0 ${noBodyScroll ? 'overflow-hidden' : 'overflow-y-auto'} ${extraWide ? 'px-5 sm:px-10' : compact ? 'px-4 sm:px-5' : 'px-4 sm:px-6'} ${
            footer ? 'pb-4' : 'pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6'
          }`}
        >
          {children}
        </div>
        {footer && (
          <div
            className={`shrink-0 px-4 ${
              extraWide ? 'sm:px-10 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]' : compact ? 'sm:px-5 pt-2 pb-3' : 'sm:px-6 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]'
            } border-t space-y-2 ${tone === 'night' ? 'modal-tone-night-footer border-slate-600/40' : 'border-line bg-surface'}`}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
