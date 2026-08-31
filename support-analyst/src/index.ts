import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readAnalystConfig } from './config.js';
import { normalizeEvent } from './normalize/index.js';
import type { RawEventDocument } from './types.js';

const help = `Support Analyst core (TQ-SA-03)

Usage:
  support-analyst --help
  support-analyst --validate-config
  support-analyst --normalize-fixture <file>

No Elasticsearch source, polling, or network calls are implemented.`;

async function main(args: string[]): Promise<number> {
  const [command, file] = args;
  if (!command) {
    console.log('Support Analyst core initialized. Runtime Elasticsearch source not implemented in TQ-SA-03.');
    return 0;
  }
  if (command === '--help') {
    console.log(help);
    return 0;
  }
  if (command === '--validate-config') {
    const result = readAnalystConfig(process.env);
    console.log(result.ok ? 'Support Analyst configuration is structurally valid.' : `Configuration invalid: ${result.reason}`);
    return result.ok ? 0 : 2;
  }
  if (command === '--normalize-fixture' && file) {
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as RawEventDocument;
      const result = normalizeEvent(raw);
      if (!result.ok) {
        console.error(`Normalization failed: ${result.reason}`);
        return 1;
      }
      console.log(JSON.stringify(result.event, null, 2));
      return 0;
    } catch {
      console.error('Unable to read a valid JSON fixture.');
      return 2;
    }
  }
  console.error('Unsupported command. Use --help.');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

export * from './config.js';
export * from './normalize/index.js';
export * from './privacy/sanitize.js';
export type * from './types.js';
