import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateIsolatedQaEnvironment } from './isolated-qa-env.mjs';
import { revivePhotoValue } from './pdv-unico-source-photo-restore.mjs';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
const url = validateIsolatedQaEnvironment(process.env).toString();
if (process.env.DATABASE_URL !== url) throw new Error('Wrong QA target.');
const { PrismaClient } = await import(pathToFileURL(path.join(process.env.PDV_QA_PRISMA_CLIENT, 'index.js')).href);
const db = new PrismaClient({ datasources: { db: { url } } });
const id = `qa-unselected-${process.env.PDV_QA_RUN_ID}`;
try {
  const photo = JSON.parse(await readFile(process.env.PDV_REPRESENTATIVE_PHOTO_FILE, 'utf8'));
  const company = revivePhotoValue(photo.tableRows.find(t => t.model === 'Cervejaria').rows[0]);
  await db.cervejaria.create({ data: { ...company, id, nome: 'QA unselected sentinel', slug: id } });
  const settings = revivePhotoValue(photo.tableRows.find(t => t.model === 'ConfiguracaoOperacional').rows[0]);
  await db.configuracaoOperacional.create({ data: { ...settings, cervejariaId: id } });
  await db.produto.create({ data: { id: `${id}-product`, cervejariaId: id, nome: 'QA unselected product', categoria: 'Unselected historical category', ativo: true } });
  for (const index of [1, 2]) {
    await db.pontoVenda.create({ data: { id: `${id}-point-${index}`, cervejariaId: id, nome: `QA legacy point ${index}`, cashRegisterEnabled: false } });
    await db.trailer.create({ data: { id: `${id}-trailer-${index}`, cervejariaId: id, nome: `QA legacy trailer ${index}` } });
  }
  const password = randomBytes(24).toString('base64url');
  const staff = await db.usuario.create({ data: { id: `${id}-existing-staff`, cervejariaId: id, nome: 'QA existing legacy attendant', email: `${id}-staff@example.invalid`, senhaHash: await bcrypt.hash(password, 10), papel: 'ATENDENTE' } });
  await writeFile(process.env.PDV_SENTINEL_CREDENTIAL_FILE, JSON.stringify({ email: staff.email, password, userId: staff.id }));
  const baseline = [];
  for (const model of ['Cervejaria', 'ConfiguracaoOperacional', 'Produto', 'PontoVenda', 'Trailer', 'Usuario']) {
    const delegate = model[0].toLowerCase() + model.slice(1);
    const where = model === 'Cervejaria' ? { id } : model === 'Usuario' ? { id: staff.id } : { cervejariaId: id };
    const fields = db._runtimeDataModel.models[model].fields.filter(f => ['scalar', 'enum'].includes(f.kind)).map(f => f.name);
    baseline.push({ model, where, fields, rows: await db[delegate].findMany({ where, select: Object.fromEntries(fields.map(f => [f, true])) }) });
  }
  await writeFile(process.env.PDV_SENTINEL_BASELINE, JSON.stringify(baseline));
  console.log(JSON.stringify({ status: 'PASS', tenantId: id }));
} finally { await db.$disconnect(); }
