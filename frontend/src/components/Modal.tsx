import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  hideHeaderClose?: boolean;
}

export function Modal({ open, onClose, title, children, footer, hideHeaderClose }: ModalProps) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      <div className="overlay-backdrop" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal
        aria-labelledby="modal-title"
        className="relative bg-surface rounded-t-3xl sm:rounded-2xl w-full max-w-lg sm:max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden border border-line sm:mx-4 animate-slide-up shadow-xl"
      >
        <div className="flex justify-center pt-3 pb-1 sm:hidden shrink-0">
          <div className="w-10 h-1 rounded-full bg-line" aria-hidden />
        </div>
        <div className="shrink-0 px-4 sm:px-6 pt-2 sm:pt-6">
          <div
            className={`flex items-center gap-3 mb-4 ${hideHeaderClose ? '' : 'justify-between'}`}
          >
            <h2 id="modal-title" className="text-lg sm:text-xl font-bold leading-tight text-ink">
              {title}
            </h2>
            {!hideHeaderClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar"
                className="shrink-0 min-h-12 min-w-12 flex items-center justify-center text-2xl text-ink-muted rounded-xl active:bg-surface-lighter"
              >
                ×
              </button>
            )}
          </div>
        </div>
        <div
          className={`flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 ${
            footer ? 'pb-4' : 'pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6'
          }`}
        >
          {children}
        </div>
        {footer && (
          <div className="shrink-0 px-4 sm:px-6 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-line bg-surface space-y-2">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
