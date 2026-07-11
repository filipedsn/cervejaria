const DISMISS_KEY = 'quiver-tap-pwa-safari-hint';

/** App aberto pelo ícone na tela inicial (sem barra do Safari). */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    ('standalone' in window.navigator &&
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

export function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function wasInstallBannerDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstallBanner(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* storage indisponível */
  }
}

/** iPhone no Safari (não standalone) — barra com IP ainda visível. */
export function shouldShowInstallBanner(): boolean {
  return isIos() && !isStandalone() && !wasInstallBannerDismissed();
}
