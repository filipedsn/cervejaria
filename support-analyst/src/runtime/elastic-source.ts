import type { ElasticsearchSources } from '../sources/index.js';
import type { PilotSource, PilotSourceRead } from './runtime.js';

/** Production adapter contains no write operation and only reads the approved DEV alert index. */
export class PilotElasticAlertSource implements PilotSource {
  constructor(private readonly sources: ElasticsearchSources, private readonly now: () => Date = () => new Date()) {}
  async preflight(): Promise<void> {
    const to = this.now().toISOString(); const from = new Date(this.now().getTime() - 60_000).toISOString();
    // A bounded strict _search confirms the identity and approved index exist; no write probe is used.
    await this.sources.preflightAlertSource({ from, to });
  }
  read(input: PilotSourceRead) { return this.sources.findAlertEvents({ range: { from: input.from, to: input.to }, limit: input.limit }); }
}
