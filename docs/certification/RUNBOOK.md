# Master Certification Runbook

Run only against DEV:

```text
npm run certify:dev -- --profile=MEDIUM
```

Profiles are `SMALL`, `MEDIUM`, and `LARGE`. A run produces a unique directory
under `artifacts/certification`. Resume a partially completed run with:

```text
npm run certify:dev -- --resume=<RUN_ID> --profile=MEDIUM
```

The runner does not fail fast: it records a failed batch and continues safe,
independent audit batches. It refuses an explicit production environment or a
database URL that appears to target production. Do not run load, seed, security
mutation, or restore activity against PROD.

Before a total PASS, review `failures.json`, `coverage-results.json`,
`observability-results.json`, and `evidence-manifest.json`. `UNKNOWN` must be
zero and every required batch must be complete with same-run evidence.

## Host-blocked Windows fallback: portable Node 20

When the host runtime is Node 24, use the official Node.js `v20.19.6` Windows
x64 ZIP in a user-space directory. The SHA-256 verified for
`node-v20.19.6-win-x64.zip` is:

```text
650f9a0b46871f25f6efeb17d9ea5e8e58cf0cfd86c8e8676db6569a7bb34a34
```

The certification was executed with temporary session-only drive mappings:

```text
Z: -> repository
Y: -> user-space portable Node directory
PATH = Y:\node-v20.19.6-win-x64;existing PATH
```

The mappings are removed when the process exits; no global PATH, installer,
pagefile, Defender/AppLocker policy, or Windows setting is changed. The host
still returns `uv_os_get_passwd ENOMEM` from `os.userInfo()` under Node 20.
Because `tsx` uses that value only to name its temporary directory, the run
uses a process-local preload shim supplied through `NODE_OPTIONS`:

```text
--require=<user-space>\tsx-userinfo-shim.cjs
```

The shim does not change application code or persist outside the process. With
it, the DEV dataset seed and backend unit suite run successfully. Playwright
must still be treated as host-blocked if Chromium returns `spawn EPERM`; do
not disable Windows security controls or classify skipped browser evidence as
`NOT_AUTOMATABLE`.
