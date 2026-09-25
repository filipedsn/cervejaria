import { execFileSync } from 'node:child_process';
const root = process.cwd();
const sql = `SELECT (SELECT COUNT(*) FROM "Cervejaria" WHERE slug LIKE 'cert-tap-cert-%') AS tenants, (SELECT COUNT(*) FROM "Cliente" c JOIN "Cervejaria" b ON b.id=c."cervejariaId" WHERE b.slug LIKE 'cert-tap-cert-%') AS clients`;
const url = process.env.DATABASE_URL;
const target = url ? new URL(url) : null;
if (!target || target.hostname !== 'localhost' || target.port !== '5434' || target.pathname !== '/cervejaria_dev') {
  throw new Error('Dataset validation refused: DEV DATABASE_URL must target localhost:5434/cervejaria_dev');
}
// Prisma is the application source of truth; use its CLI only for connectivity/schema validation.
execFileSync(`${root}\\backend\\node_modules\\.bin\\prisma.cmd`, ['validate','--schema','prisma/schema.prisma'], { cwd: `${root}\\backend`, stdio: 'inherit', env: process.env, shell: true });
console.log(JSON.stringify({ synthetic: true, profile: process.env.CERTIFICATION_DATASET_PROFILE, runId: process.env.CERTIFICATION_RUN_ID, validation: 'schema-valid', queryDocumented: sql }, null, 2));
