# DEV compiled releases

The DEV launcher can serve an immutable candidate built from Git blobs instead
of running `tsx watch` and Vite against the mutable workspace. It uses the
existing `deploy/release-candidates/<full SHA>` format and a separate
`deploy/dev-artifacts` active directory. PROD artifact paths are not used.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/prepare-dev-release.ps1 `
  -ExpectedReleaseSha <full-sha>
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/stop-dev.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/publish-dev-release.ps1 `
  -ExpectedReleaseSha <full-sha>
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/start-dev.ps1
```

Preparation exports the selected revision with `git archive`, installs its
locked dependencies, builds frontend/backend, and verifies candidate hashes.
The active swap refuses to run while either DEV service port is listening. The
launcher validates the candidate/dependency manifests and loads only those
compiled outputs. DEV credentials and uploads remain in the canonical backend
directory and are not copied into a release candidate.

This flow does not apply Prisma migrations. Before publishing, compare the
selected revision's schema/migrations with the DEV migration ledger and take a
DEV backup/restore proof when the deployment changes shared DEV state.
