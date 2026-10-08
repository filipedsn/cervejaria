import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateInventoryEnvironment } from './inventory-pdv-unico-env.ts';
import { summarizeStockImpact } from './pdv-unico-dev-inventory-summary.mjs';
import { readPinnedBlob } from './pdv-unico-migrator-qa-manifest.mjs';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(backendRoot, '..');
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'docs/testing/pdv-unico-integrated-qa-manifest.json'), 'utf8'));
const digest = (value) => createHash('sha256').update(Buffer.from(value.toString('utf8').replaceAll('\r\n', '\n'))).digest('hex');

function envFileValue(content, expectedName) {
  const line = content.split(/\r?\n/).find((entry) => entry.trim().startsWith(`${expectedName}=`));
  if (!line) throw new Error(`${expectedName} is missing from .env.development`);
  let value = line.slice(line.indexOf('=') + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return value;
}

function run(args, env) {
  const result = spawnSync(process.execPath, args, { cwd: backendRoot, env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    const output = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.replaceAll(env.DATABASE_URL ?? '', '[DATABASE_URL REDACTED]');
    const usefulLines = output.split(/\r?\n/).filter((line) => /PrismaClient|KnownRequestError|code: 'P\d+'|column .* does not exist|relation .* does not exist|Error:|\s+at /i.test(line));
    throw new Error(`DEV inventory helper failed (${result.status}): ${usefulLines.slice(-8).join('\n').slice(-1600) || output.slice(-1600)}`);
  }
  return result.stdout ?? '';
}

// Read only the DEV file, validate exact host/port/database before any Prisma import or client generation.
const devConfigFile = process.env.PDV_DEV_CONFIG_FILE ? path.resolve(process.env.PDV_DEV_CONFIG_FILE) : path.join(backendRoot, '.env.development');
if (path.basename(devConfigFile) !== '.env.development') throw new Error('Only the explicit DEV configuration file may be read.');
const databaseUrl = envFileValue(await readFile(devConfigFile, 'utf8'), 'DATABASE_URL');
const devEnvironment = { ...process.env, NODE_ENV: 'development', DATABASE_URL: databaseUrl };
validateInventoryEnvironment(devEnvironment);
for (const name of Object.keys(devEnvironment)) if (/^PROD/i.test(name) || name === 'DIRECT_URL' || /_DATABASE_URL$/.test(name)) delete devEnvironment[name];
devEnvironment.NODE_ENV = 'development';
devEnvironment.DATABASE_URL = databaseUrl;

const schemaBytes = readPinnedBlob(manifest.devInventorySchema.commit, manifest.devInventorySchema.path);
if (digest(schemaBytes) !== manifest.devInventorySchema.sha256) throw new Error('Pinned DEV-compatible Prisma schema hash mismatch.');
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'pdv-dev-inventory-readonly-'));
if (!path.resolve(temporaryRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Refusing to use a temporary directory outside OS temp root.');
try {
  const schemaPath = path.join(temporaryRoot, 'pre-commerce-schema.prisma');
  const clientSchemaPath = path.join(temporaryRoot, 'generate-pre-commerce-schema.prisma');
  const clientDir = path.join(temporaryRoot, 'prisma-client');
  const schemaText = schemaBytes.toString('utf8');
  const generatorLine = 'provider = "prisma-client-js"';
  if (!schemaText.includes(generatorLine)) throw new Error('Pinned schema does not contain the expected Prisma client generator.');
  await writeFile(schemaPath, schemaBytes);
  await writeFile(clientSchemaPath, schemaText.replace(generatorLine, `${generatorLine}\n  output = "${clientDir.replaceAll('\\', '/')}"`));

  const generateEnv = { ...devEnvironment, DATABASE_URL: 'postgresql://inventory:inventory@127.0.0.1:5434/cervejaria_dev' };
  const generated = spawnSync(process.execPath, [path.join(backendRoot, 'node_modules/prisma/build/index.js'), 'generate', '--schema', clientSchemaPath], { cwd: backendRoot, env: generateEnv, encoding: 'utf8', windowsHide: true });
  if (generated.status !== 0) throw new Error(`Compatible DEV Prisma client generation failed: ${`${generated.stderr ?? ''}\n${generated.stdout ?? ''}`.slice(0, 1200)}`);

  const inventoryEnv = { ...devEnvironment, PDV_INVENTORY_PRISMA_CLIENT: clientDir };
  inventoryEnv.PDV_GIT_QA_ALLOWED_ROOTS = JSON.stringify([...JSON.parse(inventoryEnv.PDV_GIT_QA_ALLOWED_ROOTS ?? '[]'), clientDir]);
  inventoryEnv.PDV_QA_GENERATED_CLIENT_ROOTS = JSON.stringify([clientDir]);
  const output = run(['--import', 'tsx', 'scripts/pdv-unico-global-preflight.mjs'], inventoryEnv);
  console.log(output.trim());
} finally {
  const resolved = path.resolve(temporaryRoot);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Refusing to remove a temporary path outside OS temp root.');
  await rm(resolved, { recursive: true, force: true });
}
