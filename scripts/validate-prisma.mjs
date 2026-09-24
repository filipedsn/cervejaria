import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(prismaCommand, ['prisma', 'validate'], {
  cwd: path.join(root, 'backend'),
  env: {
    ...process.env,
    // Prisma schema validation needs a syntactically valid URL but does not
    // connect; use a DEV-only placeholder when CI has no runtime env file.
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://ci:ci@localhost:5434/cervejaria_dev?schema=public',
  },
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
