import { createResumeTransition } from './pdv-unico-resume-transition.mjs';
import { DEV_PDV_TENANT_ALLOWLIST } from './pdv-unico-dev-cutover-core.mjs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const get = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
if (args.some((arg) => !/^--(?:run-id|from|to|qa-evidence)=/.test(arg))) throw new Error('Only --run-id, --from, --to, and --qa-evidence are accepted.');
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(backendRoot, '..');
const receiptsRoot = path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'TAP Quiver', 'pdv-cutover-receipts');
const result = await createResumeTransition({ repoRoot, receiptsRoot, runId: get('run-id'), fromRevision: get('from'), toRevision: get('to'),
  tenantIds: DEV_PDV_TENANT_ALLOWLIST.map(({ id }) => id), qaEvidenceFile: path.resolve(get('qa-evidence') ?? '') });
process.stdout.write(`${JSON.stringify({ status: 'PASS', file: result.file, transition: result.transition })}\n`);
