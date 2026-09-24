# TAP Quiver — Master Certification DEV

The official reproducible entry point is:

```text
npm run certify:dev
```

The runner creates `artifacts/certification/<RUN_ID>/` with:

- `run-manifest.json`: environment, Git SHA, versions and DEV-only scope;
- `batches.json`: resumable batch state (`DONE`, `FAILED`, `NOT_STARTED`);
- `machine-readable-inventory.json`: repository-backed functional inventory;
- one log per executed test batch;
- `final-report.md`, `summary.json` and SHA-256 hashes.

The runner defines the full audit batch map (preflight through report), discovers
product surfaces from Prisma, route sources and frontend routes, validates the
master scenario registry, and reconciles existing tests as evidence. A failed
batch is recorded while independent audit batches continue. Resume a run with:

```text
npm run certify:dev -- --resume=<RUN_ID>
```

The runner is DEV-only by contract. It does not seed, mutate, query or deploy
PROD, and it records `PROD_CHANGED=NO`. Production promotion remains a separate
human-approved gate.

## Evidence interpretation

`UNKNOWN=0` means every inventory entry has an explicit classification. It does
not mean every category is fully certified: categories requiring manual Golden
validation, external observability, or dedicated load infrastructure remain
`PARTIALLY_COVERED` until their evidence is present in the same run.

The authoritative result is the run's `final-report.md`, not a previous report or
a result copied from another SHA. QA and E2E artifacts are retained operationally
and ignored by Git; lightweight documentation and the runner are versioned.
