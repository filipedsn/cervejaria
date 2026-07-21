let wakeLock: WakeLockSentinel | null = null;
let wantActive = false;

async function releaseWakeLock() {
  if (!wakeLock) return;
  try {
    await wakeLock.release();
  } catch {
    // ignore
  }
  wakeLock = null;
}

export async function acquireScreenWakeLock(): Promise<boolean> {
  if (!wantActive || !('wakeLock' in navigator)) return false;
  if (document.visibilityState !== 'visible') return false;

  try {
    await releaseWakeLock();
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      if (wantActive) void acquireScreenWakeLock();
    });
    return true;
  } catch {
    return false;
  }
}

export async function setScreenWakeLockEnabled(enabled: boolean): Promise<void> {
  wantActive = enabled;
  if (!enabled) {
    await releaseWakeLock();
    return;
  }
  await acquireScreenWakeLock();
}

export function isScreenWakeLockWanted(): boolean {
  return wantActive;
}
