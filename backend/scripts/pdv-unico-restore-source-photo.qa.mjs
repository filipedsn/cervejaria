import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { restoreSourcePhoto } from './pdv-unico-source-photo-restore.mjs';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';

const databaseUrl = validateIsolatedQaEnvironment(process.env).toString();
if (process.env.DATABASE_URL !== databaseUrl || !process.env.PDV_SOURCE_PRISMA_CLIENT || !process.env.PDV_REPRESENTATIVE_PHOTO_FILE) throw new Error('Source photo restore requires pinned QA URL, source client, and photo file.');
const clientDir = path.resolve(process.env.PDV_SOURCE_PRISMA_CLIENT);
const { PrismaClient } = await import(pathToFileURL(path.join(clientDir, 'index.js')).href);
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, errorFormat: 'minimal' });
try {
  const photo = JSON.parse(await readFile(process.env.PDV_REPRESENTATIVE_PHOTO_FILE, 'utf8'));
  const result = await restoreSourcePhoto(db, photo);
  process.stdout.write(`${JSON.stringify({ status: 'PASS', ...result })}\n`);
} finally { await db.$disconnect(); }
