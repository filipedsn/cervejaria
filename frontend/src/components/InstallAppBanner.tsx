import { useEffect, useState } from 'react';
import { dismissInstallBanner, shouldShowInstallBanner } from '../lib/pwa-display';

export function InstallAppBanner({ variant = 'default' }: { variant?: 'default' | 'login' }) {
  const [visible, setVisible] = useState(shouldShowInstallBanner);

  useEffect(() => {
    if (!visible) {
      document.body.classList.remove('has-safari-hint');
      return;
    }
    document.body.classList.add('has-safari-hint');
    return () => document.body.classList.remove('has-safari-hint');
  }, [visible]);

  if (!visible) return null;

  const isLogin = variant === 'login';

  return (
    <div
      className={
        isLogin
          ? 'mb-4 rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white'
          : 'sticky top-0 z-[100] border-b border-brand-700/30 bg-brand-600 px-4 py-3 text-white shadow-md'
      }
      role="status"
    >
      <div className="mx-auto flex max-w-6xl items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Você está no Safari</p>
          <p className={`mt-1 text-xs leading-snug ${isLogin ? 'text-white/85' : 'text-white/90'}`}>
            A barra com o endereço IP é do navegador e <strong>não some nesta tela</strong>. Feche o
            Safari e abra pelo ícone <strong>Quiver Tap</strong> na tela inicial — não pela barra de
            endereços. Se já instalou, remova o atalho antigo e adicione de novo.
          </p>
        </div>
        <button
          type="button"
          aria-label="Ocultar nesta sessão"
          onClick={() => {
            dismissInstallBanner();
            setVisible(false);
          }}
          className={`shrink-0 rounded-lg px-2 py-1 text-lg leading-none ${
            isLogin ? 'text-white/80 active:bg-white/10' : 'text-white/90 active:bg-brand-700'
          }`}
        >
          ×
        </button>
      </div>
    </div>
  );
}
