import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { appendCutoverReceipt, readCutoverReceipts } from './pdv-unico-cutover-receipts.mjs';
import { executeCutoverCore } from './pdv-unico-dev-cutover-core.mjs';

/** Runs the ordered cutover phases for an already validated DEV or owned-QA target. */
export async function executePdvCutoverAdapter({ target, tenantIds, runId, preflight, operations, receiptFile, verifyCompletedPhase }) {
  if (!path.isAbsolute(receiptFile)) throw new Error('Cutover receipts must use an explicit absolute durable path.');
  await mkdir(path.dirname(receiptFile), { recursive: true });
  const completedPhases = readCutoverReceipts(receiptFile, { runId, tenantIds });
  return executeCutoverCore({
    target, tenantIds, runId, preflight, operations, completedPhases,
    verifyCompletedPhase,
    receipt: (row) => appendCutoverReceipt(receiptFile, row),
  });
}
