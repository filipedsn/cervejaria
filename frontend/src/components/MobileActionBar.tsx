import type { ReactNode } from 'react';

/** Barra fixa acima da navegação inferior — ações primárias em telas operacionais */
export function MobileActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="mobile-action-bar">
      <div className="mobile-action-bar-inner">{children}</div>
    </div>
  );
}
