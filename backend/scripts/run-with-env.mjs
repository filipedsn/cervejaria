import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, '..');

function parseEnvFile(content) {
  const vars = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

const envName = process.argv[2];
const command = process.argv[3];
const args = process.argv.slice(4);

if (!envName || !command) {
  console.error('Uso: node scripts/run-with-env.mjs <development|production> <comando> [args...]');
  process.exit(1);
}

const envFile = path.join(backendRoot, `.env.${envName}`);
if (!fs.existsSync(envFile)) {
  console.error(`Arquivo nao encontrado: ${envFile}`);
  process.exit(1);
}

const fileVars = parseEnvFile(fs.readFileSync(envFile, 'utf8'));
const childEnv = {
  ...process.env,
  ...fileVars,
  NODE_ENV: envName === 'production' ? 'production' : 'development',
};

const resolvedCommand =
  process.platform === 'win32' && command === 'npx' ? 'npx.cmd' : command;

const child = spawn(resolvedCommand, args, {
  cwd: backendRoot,
  env: childEnv,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 1));
