import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const RESUME_DELTA_ALLOWLIST = Object.freeze([
  'backend/scripts/pdv-unico-live-reconciliation.mjs',
  'backend/scripts/pdv-unico-transacao-log-comparison.mjs',
  'backend/scripts/pdv-unico-transacao-log-comparison.test.mjs',
  'backend/scripts/pdv-unico-live-reconciliation.query.qa.mjs',
  'backend/scripts/run-pdv-unico-reconciliation-query-qa.mjs',
  'backend/scripts/pdv-unico-resume-transition.mjs',
  'backend/scripts/pdv-unico-create-resume-transition.mjs',
  'backend/scripts/pdv-unico-migrator-evidence.mjs',
  'backend/scripts/pdv-unico-payment-session-evidence.mjs',
  'backend/scripts/pdv-unico-cutover-verify.mjs',
  'backend/scripts/run-pdv-unico-dev-cutover-worker.mjs',
]);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileSha = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');

export async function createResumeTransition({ repoRoot, receiptsRoot, runId, fromRevision, toRevision, tenantIds, qaEvidenceFile, auditEvidenceFile }) {
  const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
  if (git(['rev-parse', 'HEAD']) !== toRevision) throw new Error('Transition target must be exact current HEAD.');
  const changedFiles = git(['diff', '--name-only', fromRevision, toRevision]).split(/\r?\n/).filter(Boolean).sort();
  if (!changedFiles.length || changedFiles.some((name) => !RESUME_DELTA_ALLOWLIST.includes(name))) throw new Error(`Revision delta exceeds the reviewed resume scope: ${changedFiles.join(', ')}`);
  const preflightFile = path.join(receiptsRoot, `${runId}.preflight.json`);
  const saved = JSON.parse(await readFile(preflightFile, 'utf8'));
  const { sha256: preflightSha256, ...preflightBody } = saved;
  if (preflightSha256 !== digest(preflightBody) || preflightBody.runId !== runId || preflightBody.revision !== fromRevision) throw new Error('Original preflight is invalid or not tied to the transition source revision.');
  const receiptFile = path.join(receiptsRoot, `${runId}.jsonl`);
  const receiptBytes = await readFile(receiptFile);
  const receiptRows = receiptBytes.toString('utf8').trimEnd().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  if (receiptRows.length !== 5 || receiptRows.some(({ status }) => status !== 'PASS')) throw new Error('Resume transition requires the five existing PASS phase receipts.');
  const qa = JSON.parse(await readFile(qaEvidenceFile, 'utf8'));
  const reviewedSchemaBlob = git(['rev-parse', `${fromRevision}:backend/prisma/schema.prisma`]);
  if (qa.status !== 'PASS' || qa.cases?.length !== 9 || qa.schemaBlobSha1 !== reviewedSchemaBlob || qa.cutoverRunId !== runId) throw new Error('Focused generated-client QA evidence is absent or did not use the exact final schema blob for this run.');
  const auditPath = path.resolve(auditEvidenceFile ?? '');
  if (path.dirname(auditPath) !== path.resolve(receiptsRoot)) throw new Error('TransacaoLog backup audit evidence must be inside the run receipts folder.');
  const audit = JSON.parse(await readFile(auditPath, 'utf8'));
  if (audit.status !== 'PASS' || audit.runId !== runId || audit.backupSha256 !== preflightBody.backupSha256
    || audit.differenceCount !== 0 || !/^cervejaria_restore_drill_audit_[a-z0-9_]+$/i.test(audit.recoveryDatabase ?? '')
    || JSON.stringify([...audit.tenants.map(({ tenantId }) => tenantId)].sort()) !== JSON.stringify([...tenantIds].sort())) {
    throw new Error('Full-content TransacaoLog backup audit is not PASS for this run, backup, and exact tenant set.');
  }
  const files = changedFiles.map((file) => ({ path: file,
    fromBlob: spawnGitExists(repoRoot, fromRevision, file) ? git(['rev-parse', `${fromRevision}:${file}`]) : null,
    toBlob: git(['rev-parse', `${toRevision}:${file}`]),
  }));
  const body = {
    format: 'tap76-dev-cutover-revision-transition-v1', runId, fromRevision, toRevision,
    tenantIds,
    migrationsSha256: preflightBody.migrationsSha256, photoSha256: preflightBody.photoSha256, backupSha256: preflightBody.backupSha256,
    preflightSha256, receiptCount: receiptRows.length, previousReceiptSha256: receiptRows.at(-1).sha256,
    qaEvidenceFile: path.basename(qaEvidenceFile), qaEvidenceSha256: await fileSha(qaEvidenceFile),
    auditEvidenceFile: path.basename(auditPath), auditEvidenceSha256: await fileSha(auditPath), auditRecoveryDatabase: audit.recoveryDatabase, changedFiles: files,
  };
  const transition = { ...body, sha256: digest(body) };
  const target = path.join(receiptsRoot, `${runId}.revision-transition-${toRevision.slice(0, 12)}.json`);
  await writeFile(target, `${JSON.stringify(transition, null, 2)}\n`, { flag: 'wx' });
  return { file: target, transition };
}

export async function validateResumeTransition({ transitionFile, repoRoot, receiptsRoot, runId, revision, preflightSaved, receipts, migrationSha256, photoSha256, backupSha256, tenantIds }) {
  const resolved = path.resolve(transitionFile);
  if (path.dirname(resolved) !== path.resolve(receiptsRoot)) throw new Error('Revision transition must be stored beside this run’s durable receipts.');
  const transition = JSON.parse(await readFile(resolved, 'utf8'));
  const { sha256, ...body } = transition;
  if (body.format !== 'tap76-dev-cutover-revision-transition-v1' || sha256 !== digest(body)
    || body.runId !== runId || body.toRevision !== revision || body.fromRevision !== preflightSaved.revision
    || body.migrationsSha256 !== migrationSha256 || body.photoSha256 !== photoSha256 || body.backupSha256 !== backupSha256
    || JSON.stringify([...body.tenantIds].sort()) !== JSON.stringify([...tenantIds].sort())
    || body.preflightSha256 !== preflightSaved.sha256 || body.receiptCount !== receipts.length
    || body.previousReceiptSha256 !== receipts.at(-1)?.sha256) throw new Error('Revision transition does not match this run, preflight, receipt chain, or approved execution inputs.');
  const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
  const changedFiles = git(['diff', '--name-only', body.fromRevision, body.toRevision]).split(/\r?\n/).filter(Boolean).sort();
  if (!changedFiles.length || changedFiles.some((name) => !RESUME_DELTA_ALLOWLIST.includes(name))
    || JSON.stringify(changedFiles) !== JSON.stringify(body.changedFiles.map(({ path: name }) => name).sort())) throw new Error('Actual Git delta is outside or differs from the explicitly recorded resume transition.');
  for (const item of body.changedFiles) {
    const fromBlob = spawnGitExists(repoRoot, body.fromRevision, item.path) ? git(['rev-parse', `${body.fromRevision}:${item.path}`]) : null;
    if (item.fromBlob !== fromBlob || item.toBlob !== git(['rev-parse', `${body.toRevision}:${item.path}`])) throw new Error(`Transition Git blob changed for ${item.path}.`);
  }
  const qaEvidenceFile = path.join(receiptsRoot, body.qaEvidenceFile ?? '');
  if (path.dirname(path.resolve(qaEvidenceFile)) !== path.resolve(receiptsRoot) || await fileSha(qaEvidenceFile) !== body.qaEvidenceSha256) throw new Error('Focused QA evidence linked by the transition is missing or changed.');
  const auditEvidenceFile = path.join(receiptsRoot, body.auditEvidenceFile ?? '');
  if (path.dirname(path.resolve(auditEvidenceFile)) !== path.resolve(receiptsRoot) || await fileSha(auditEvidenceFile) !== body.auditEvidenceSha256) throw new Error('Full-content TransacaoLog backup audit evidence linked by the transition is missing or changed.');
  const audit = JSON.parse(await readFile(auditEvidenceFile, 'utf8'));
  if (audit.status !== 'PASS' || audit.runId !== runId || audit.backupSha256 !== backupSha256 || audit.differenceCount !== 0 || audit.recoveryDatabase !== body.auditRecoveryDatabase) throw new Error('TransacaoLog backup audit evidence no longer matches the approved run and backup.');
  return { status: 'PASS', transitionFile: resolved, transitionSha256: sha256, fromRevision: body.fromRevision, toRevision: body.toRevision, changedFiles, qaEvidenceSha256: body.qaEvidenceSha256, auditEvidenceSha256: body.auditEvidenceSha256, auditRecoveryDatabase: body.auditRecoveryDatabase };
}

function spawnGitExists(repoRoot, revision, file) {
  try { execFileSync('git', ['cat-file', '-e', `${revision}:${file}`], { cwd: repoRoot, stdio: 'ignore' }); return true; }
  catch { return false; }
}
