import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PANEL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = resolve(PANEL_DIR, '..');

function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const values = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

const fileEnv = loadEnvFile(join(PANEL_DIR, '.env'));
const env = (key, fallback) => process.env[key] ?? fileEnv[key] ?? fallback;

export const config = {
  host: '127.0.0.1',
  port: Number(env('OPS_PANEL_PORT', 3099)),
  repo: env('GITHUB_REPO', 'filipedsn/cervejaria'),
  deployWorkflow: 'deploy-vps.yml',
  ciCheckName: 'build-and-unit',
  prdUrl: env('PRD_URL', 'https://tap.quivercloud.com.br'),
  devApiUrl: 'http://127.0.0.1:3002',
  devWebUrl: 'http://127.0.0.1:5202',
  devContainers: ['cervejaria-db-dev', 'elasticsearch'],
  // Alias do ~/.ssh/config com a chave só leitura do painel (ops-report.sh). Vazio = só dados públicos.
  vpsSshHost: env('OPS_VPS_SSH_HOST', ''),
  auditLog: env('OPS_PANEL_AUDIT_LOG', join(ROOT, 'deploy', 'logs', 'ops-panel.log')),
  runtimeDir: join(ROOT, 'deploy', 'runtime'),
};
