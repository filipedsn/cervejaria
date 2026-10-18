import path from 'node:path';

export function assertReceiptInsideArtifacts(receiptPath, artifactsRoot) {
  const resolvedReceipt = path.resolve(receiptPath);
  const resolvedArtifacts = path.resolve(artifactsRoot);
  if (path.basename(resolvedArtifacts).toLowerCase() !== 'artifacts') {
    throw new Error('QA_ARTIFACTS_ROOT_MUST_BE_ARTIFACTS_DIRECTORY');
  }
  if (!resolvedReceipt.startsWith(resolvedArtifacts + path.sep)) {
    throw new Error('QA_RECEIPT_OUTSIDE_ARTIFACTS_ROOT');
  }
  return resolvedReceipt;
}
