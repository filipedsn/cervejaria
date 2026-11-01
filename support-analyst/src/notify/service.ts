import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { TelegramConfig } from '../config.js';
import { sanitizeFreeText } from '../privacy/sanitize.js';
import { scrubPersonalData } from './privacy.js';
import { TelegramClient, type TelegramSender } from './telegram.js';

const HOUR_MS = 3_600_000;
const MAX_PENDING = 50;
const MAX_ATTEMPTS = 10;

export const RATE_LIMIT_NOTICE = '[ANALISTA] Limite de mensagens por hora atingido; as próximas ficam só no outbox local até a janela liberar.';

type Pending = { kind: string; detectorId?: string; text: string; attempts: number };
type NotifyState = { sentAt: string[]; pending: Pending[]; rateLimitNoticeAt?: string };
type OutboxEntry = { kind: string; detectorId?: string; text: string; sent: boolean; dryRun: boolean; error?: string; attempt?: number; suppressedByRateLimit?: boolean };

/** Every message (sent, dry-run or suppressed) is appended to the local outbox. */
export class NotificationService {
  readonly outboxPath: string;
  private readonly statePath: string;
  private readonly client?: TelegramSender;
  private readonly now: () => Date;

  constructor(private readonly options: { config: TelegramConfig; runtimeDir: string; client?: TelegramSender; now?: () => Date }) {
    const dir = join(options.runtimeDir, 'notifications');
    this.outboxPath = join(dir, 'outbox.jsonl');
    this.statePath = join(dir, 'state.json');
    this.now = options.now ?? (() => new Date());
    this.client = options.client ?? (this.mode === 'on' && options.config.botToken && options.config.chatId
      ? new TelegramClient(options.config.botToken, options.config.chatId)
      : undefined);
  }

  get mode(): 'on' | 'dry-run' | 'off' {
    const config = this.options.config;
    if (!config.enabled) return 'off';
    return config.dryRun ? 'dry-run' : 'on';
  }

  async send(kind: string, text: string, detectorId?: string): Promise<void> {
    const clean = scrubPersonalData(sanitizeFreeText(text, 3900));
    if (this.mode !== 'on' || !this.client) {
      await this.appendOutbox({ kind, detectorId, text: clean, sent: false, dryRun: true });
      return;
    }
    const state = await this.loadState();
    if (!this.allow(state)) {
      await this.appendOutbox({ kind, detectorId, text: clean, sent: false, dryRun: false, suppressedByRateLimit: true });
      await this.sendRateNoticeOnce(state);
      await this.saveState(state);
      return;
    }
    await this.deliver(state, { kind, detectorId, text: clean, attempts: 0 });
    await this.saveState(state);
  }

  async flushPending(): Promise<void> {
    if (this.mode !== 'on' || !this.client) return;
    const state = await this.loadState();
    const queue = state.pending;
    state.pending = [];
    for (const item of queue) {
      if (!this.allow(state)) { state.pending.push(item); continue; }
      await this.deliver(state, item);
    }
    await this.saveState(state);
  }

  private allow(state: NotifyState): boolean {
    const cutoff = this.now().getTime() - HOUR_MS;
    state.sentAt = state.sentAt.filter((at) => Date.parse(at) > cutoff);
    return state.sentAt.length < this.options.config.maxPerHour;
  }

  private async sendRateNoticeOnce(state: NotifyState): Promise<void> {
    const last = state.rateLimitNoticeAt ? Date.parse(state.rateLimitNoticeAt) : 0;
    if (this.now().getTime() - last < HOUR_MS) return;
    state.rateLimitNoticeAt = this.now().toISOString();
    const result = await this.client!.send(RATE_LIMIT_NOTICE);
    await this.appendOutbox({ kind: 'RATE_LIMIT', text: RATE_LIMIT_NOTICE, sent: result.sent, dryRun: false, error: result.error });
  }

  private async deliver(state: NotifyState, item: Pending): Promise<void> {
    const result = await this.client!.send(item.text);
    if (result.sent) state.sentAt.push(this.now().toISOString());
    else if (item.attempts + 1 < MAX_ATTEMPTS && state.pending.length < MAX_PENDING) state.pending.push({ ...item, attempts: item.attempts + 1 });
    await this.appendOutbox({ kind: item.kind, detectorId: item.detectorId, text: item.text, sent: result.sent, dryRun: false, error: result.error, attempt: item.attempts + 1 });
  }

  private async appendOutbox(entry: OutboxEntry): Promise<void> {
    await mkdir(dirname(this.outboxPath), { recursive: true });
    await appendFile(this.outboxPath, `${JSON.stringify({ at: this.now().toISOString(), ...entry })}\n`, 'utf8');
  }

  private async loadState(): Promise<NotifyState> {
    try {
      const value = JSON.parse(await readFile(this.statePath, 'utf8')) as Partial<NotifyState>;
      return {
        sentAt: Array.isArray(value.sentAt) ? value.sentAt.filter((at): at is string => typeof at === 'string') : [],
        pending: Array.isArray(value.pending) ? value.pending : [],
        rateLimitNoticeAt: typeof value.rateLimitNoticeAt === 'string' ? value.rateLimitNoticeAt : undefined,
      };
    } catch {
      return { sentAt: [], pending: [] };
    }
  }

  private async saveState(state: NotifyState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const temp = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temp, this.statePath);
  }
}
