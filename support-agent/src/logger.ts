import fs from 'node:fs';
import path from 'node:path';

import { config } from './config.js';

type Level = 'info' | 'warn' | 'error';

function write(level: Level, message: string, fields?: Record<string, unknown>): void {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} ${message}${
    fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : ''
  }`;
  if (level === 'error') console.error(line);
  else console.log(line);

  try {
    fs.mkdirSync(path.dirname(config.logFile), { recursive: true });
    fs.appendFileSync(config.logFile, `${line}\n`, 'utf8');
  } catch {
    // log em arquivo e best-effort; o console e a fonte garantida
  }
}

export const log = {
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
};
