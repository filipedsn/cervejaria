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

function assertDatabaseEnvironment(name, databaseUrl) {
  if (!databaseUrl) {
    console.error('DATABASE_URL nao definida em', envFile);
    process.exit(1);
  }
  if (name === 'production') {
    if (databaseUrl.includes('cervejaria_dev')) {
      console.error('PRODUCAO: DATABASE_URL aponta para cervejaria_dev.');
      process.exit(1);
    }
    if (databaseUrl.includes(':5434')) {
      console.error('PRODUCAO: DATABASE_URL nao pode usar porta 5434 (container dev).');
      process.exit(1);
    }
    if (!/\/cervejaria(\?|$)/.test(databaseUrl)) {
      console.error('PRODUCAO: DATABASE_URL deve usar o banco cervejaria.');
      process.exit(1);
    }
  } else {
    if (!databaseUrl.includes('cervejaria_dev')) {
      console.error('DESENVOLVIMENTO: DATABASE_URL deve usar cervejaria_dev.');
      process.exit(1);
    }
    if (databaseUrl.includes('cervejaria_dev') && !databaseUrl.includes(':5434')) {
      console.error('DESENVOLVIMENTO: DATABASE_URL deve usar porta 5434 (container dev isolado).');
      process.exit(1);
    }
    if (/\/cervejaria(\?|$)/.test(databaseUrl) && !databaseUrl.includes('cervejaria_dev')) {
      console.error('DESENVOLVIMENTO: DATABASE_URL aponta para producao.');
      process.exit(1);
    }
  }
}

assertDatabaseEnvironment(envName, fileVars.DATABASE_URL);

const isPrismaMigrate =
  command === 'npx' &&
  (args[0] === 'prisma' || args[0]?.endsWith('prisma')) &&
  (args[1] === 'migrate' || args.includes('migrate'));

const databaseUrl =
  isPrismaMigrate && fileVars.MIGRATE_DATABASE_URL
    ? fileVars.MIGRATE_DATABASE_URL
    : fileVars.DATABASE_URL;

const childEnv = {
  ...process.env,
  ...fileVars,
  DATABASE_URL: databaseUrl,
  NODE_ENV: envName === 'production' ? 'production' : 'development',
};

const tsxHostShim = pathToFileURL(path.join(backendRoot, '..', 'scripts', 'node24-tsx-host.mjs')).href;
childEnv.NODE_OPTIONS = `${childEnv.NODE_OPTIONS ?? ''} --import=${tsxHostShim}`.trim();

const resolvedCommand =
  process.platform === 'win32' && command === 'npx' ? 'npx.cmd' : command;

const child = spawn(resolvedCommand, args, {
  cwd: backendRoot,
  env: childEnv,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 1));
