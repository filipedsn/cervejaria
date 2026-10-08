import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareSourcePhoto } from './pdv-unico-source-photo-restore.mjs';

const url = new URL(process.env.PDV_RECOVERY_DATABASE_URL ?? '');
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname)
  || !/^554(?:3[9]|4[0-9])$/.test(url.port) || url.pathname !== '/cervejaria_qa_recovery' || url.hash
  || process.env.PDV_QA_CONTAINER?.startsWith('codex-pdv-sequenced-qa-') !== true || !process.env.PDV_QA_RUN_ID) {
  throw new Error('Recovery verification accepts only this executor-owned local QA recovery database.');
}
if (!process.env.PDV_SOURCE_PRISMA_CLIENT || !process.env.PDV_REPRESENTATIVE_PHOTO_FILE) throw new Error('Recovery verification requires the pinned source schema client and approved photo.');
const { PrismaClient } = await import(pathToFileURL(path.join(path.resolve(process.env.PDV_SOURCE_PRISMA_CLIENT), 'index.js')).href);
const db = new PrismaClient({ datasources: { db: { url: url.toString() } }, errorFormat: 'minimal' });
try {
  const photo = JSON.parse(await readFile(process.env.PDV_REPRESENTATIVE_PHOTO_FILE, 'utf8'));
  process.stdout.write(`${JSON.stringify(await compareSourcePhoto(db, photo))}\n`);
} finally { await db.$disconnect(); }
