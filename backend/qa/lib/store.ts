import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPORTS_DIR = path.resolve(__dirname, '../../../reports');
export const QA_DIR = path.join(REPORTS_DIR, 'qa');
export const WORKERS_DIR = path.join(QA_DIR, 'workers');
export const CONTEXT_PATH = path.join(QA_DIR, 'context.json');
export const SUITE_PATH = path.join(QA_DIR, 'suite.json');
export const HTML_PATH = path.join(REPORTS_DIR, 'qa-report.html');

export function ensureDirs() {
  mkdirSync(WORKERS_DIR, { recursive: true });
}

/** Remove worker artifacts from prior runs (stale comandaId breaks CONC-01). */
export function clearWorkerResults() {
  if (!existsSync(WORKERS_DIR)) return;
  for (const f of readdirSync(WORKERS_DIR)) {
    if (f.endsWith('.json')) rmSync(path.join(WORKERS_DIR, f));
  }
}

export function writeJson(file: string, data: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf-8')) as T;
}

export function readWorkerResults<T>(): T[] {
  if (!existsSync(WORKERS_DIR)) return [];
  return readdirSync(WORKERS_DIR)
    .filter((f) => f.startsWith('worker-') && f.endsWith('.json'))
    .map((f) => readJson<T>(path.join(WORKERS_DIR, f)));
}

export function readPortalWorkerResults<T>(): T[] {
  if (!existsSync(WORKERS_DIR)) return [];
  return readdirSync(WORKERS_DIR)
    .filter((f) => f.startsWith('portal-worker-') && f.endsWith('.json'))
    .map((f) => readJson<T>(path.join(WORKERS_DIR, f)));
}
