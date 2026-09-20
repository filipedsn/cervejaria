param(
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

Write-Host 'Bridge release preflight (DEV/QA only; PROD is intentionally not addressed).' -ForegroundColor Cyan
if ($DryRun) {
  npm run db:backfill-operational-enablement:dry-run --prefix backend
  npm run db:backfill-cash-register:dry-run --prefix backend
  exit $LASTEXITCODE
}

npm run db:backfill-operational-enablement --prefix backend
if ($LASTEXITCODE -ne 0) { throw 'Operational enablement backfill failed; retry is safe after inspection.' }
npm run db:backfill-cash-register --prefix backend
if ($LASTEXITCODE -ne 0) { throw 'Cash capability backfill failed; operational backfill remains idempotent and no rollback is required.' }
npm run db:reconcile-operational-materialization --prefix backend
if ($LASTEXITCODE -ne 0) { throw 'Reconciliation failed; do not publish/restart until the materialization gap is corrected.' }
