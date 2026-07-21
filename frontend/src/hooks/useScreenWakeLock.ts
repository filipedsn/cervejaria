import { useEffect } from 'react';
import { acquireScreenWakeLock, setScreenWakeLockEnabled } from '../lib/screen-wake-lock';

export function useScreenWakeLock(active: boolean) {
  useEffect(() => {
    void setScreenWakeLockEnabled(active);

    const reacquire = () => {
      if (active && document.visibilityState === 'visible') {
        void acquireScreenWakeLock();
      }
    };

    document.addEventListener('visibilitychange', reacquire);
    window.addEventListener('focus', reacquire);
    window.addEventListener('pageshow', reacquire);
    document.addEventListener('pointerdown', reacquire, { passive: true });

    return () => {
      document.removeEventListener('visibilitychange', reacquire);
      window.removeEventListener('focus', reacquire);
      window.removeEventListener('pageshow', reacquire);
      document.removeEventListener('pointerdown', reacquire);
      void setScreenWakeLockEnabled(false);
    };
  }, [active]);
}
