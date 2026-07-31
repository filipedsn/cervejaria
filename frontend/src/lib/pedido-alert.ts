const STORAGE_KEY = 'quiver:pedido-alert-enabled';
const REPEAT_INTERVAL_MS = 10_000;
const ALERT_PEAK_GAIN = 0.75;

let audioContext: AudioContext | null = null;
let audioUnlocked = false;
const playedIds = new Set<string>();
let repeatTimer: ReturnType<typeof setInterval> | null = null;
let pendingPedidoCount = 0;

export function isPedidoAlertEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === '1';
}

export function stopPedidoAlertRepeat() {
  if (repeatTimer) {
    clearInterval(repeatTimer);
    repeatTimer = null;
  }
}

export function setPedidoAlertEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  if (enabled) {
    localStorage.setItem(STORAGE_KEY, '1');
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
  stopPedidoAlertRepeat();
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    audioContext = new Ctx();
  }
  return audioContext;
}

export function isPedidoAlertAudioLocked(): boolean {
  const ctx = getAudioContext();
  if (!ctx) return true;
  return ctx.state !== 'running';
}

export async function ensurePedidoAlertAudioRunning(): Promise<boolean> {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    audioUnlocked = ctx.state === 'running';
    return audioUnlocked;
  } catch {
    audioUnlocked = false;
    return false;
  }
}

export async function unlockPedidoAlertAudio(): Promise<boolean> {
  return ensurePedidoAlertAudioRunning();
}

function beep(frequency: number, durationMs: number, delayMs: number) {
  try {
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== 'running') return;

    const start = ctx.currentTime + delayMs / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = frequency;
    osc.type = 'square';
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(ALERT_PEAK_GAIN, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
    osc.start(start);
    osc.stop(start + durationMs / 1000);
  } catch {
    // Falha de áudio não deve derrubar a UI.
  }
}

function vibrateAlert() {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([160, 100, 160, 100, 160]);
    }
  } catch {
    // ignore
  }
}

function playBeeps() {
  beep(880, 140, 0);
  beep(1100, 140, 200);
  beep(880, 180, 400);
}

/**
 * Toca sem consultar a preferencia de alerta de pedidos do cliente. Serve a
 * quem tem a propria chave de preferencia, como a tela de cozinha do quiosque.
 */
export async function playAlertaAgora(): Promise<boolean> {
  vibrateAlert();
  const ok = await ensurePedidoAlertAudioRunning();
  if (!ok) return false;
  playBeeps();
  return true;
}

export async function playPedidoAlertChime(): Promise<boolean> {
  if (!isPedidoAlertEnabled()) return false;
  return playAlertaAgora();
}

export async function playPedidoAlert(pedidoId: string): Promise<boolean> {
  if (!isPedidoAlertEnabled()) return false;
  if (playedIds.has(pedidoId)) return false;
  playedIds.add(pedidoId);
  return playPedidoAlertChime();
}

export async function playPedidoAlertPreview(): Promise<void> {
  const ok = await ensurePedidoAlertAudioRunning();
  if (!ok) return;
  playBeeps();
}

function startPedidoAlertRepeat(onTick?: () => void) {
  if (repeatTimer) return;
  repeatTimer = setInterval(() => {
    if (pendingPedidoCount <= 0 || !isPedidoAlertEnabled()) {
      stopPedidoAlertRepeat();
      return;
    }
    onTick?.();
    void playPedidoAlertChime();
  }, REPEAT_INTERVAL_MS);
}

export function syncPedidoAlertPendingCount(
  count: number,
  options?: { playNow?: boolean; onRepeatTick?: () => void },
) {
  pendingPedidoCount = Math.max(0, count);

  if (pendingPedidoCount <= 0 || !isPedidoAlertEnabled()) {
    stopPedidoAlertRepeat();
    return;
  }

  if (options?.playNow) {
    void playPedidoAlertChime();
  }

  startPedidoAlertRepeat(options?.onRepeatTick);
}

export function seedPedidoAlertSeenIds(ids: string[]) {
  for (const id of ids) playedIds.add(id);
}

export function markPedidoAlertSeen(pedidoId: string) {
  playedIds.add(pedidoId);
}
