import { sanitizeFreeText } from '../privacy/sanitize.js';

export type TelegramSendResult = { sent: boolean; error?: string };
export type TelegramSender = { send(text: string): Promise<TelegramSendResult> };
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Plain text only (no parse_mode); the token never leaves this class. */
export class TelegramClient implements TelegramSender {
  constructor(private readonly token: string, private readonly chatId: string, private readonly fetchImpl: FetchLike = fetch) {}

  async send(text: string): Promise<TelegramSendResult> {
    try {
      const response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return { sent: true };
      const body = await response.text().catch(() => '');
      return { sent: false, error: this.redact(`HTTP ${response.status} ${body}`) };
    } catch (error) {
      return { sent: false, error: this.redact(error instanceof Error ? error.message : String(error)) };
    }
  }

  private redact(message: string): string {
    return sanitizeFreeText(message.split(this.token).join('[REDACTED]'), 300);
  }
}
