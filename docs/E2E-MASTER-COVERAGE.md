# TAP Quiver — Master Coverage

The scenario source of truth is [e2e-master-coverage.json](e2e-master-coverage.json).
It is defined from product behavior and code discovery; test files are mapped as
evidence after scenario definition, never used to define the product surface.

Run `npm run certify:dev` to generate a same-run scenario reconciliation in
`artifacts/certification/<RUN_ID>/scenario-results.json`.

Current scenarios intentionally begin as `UNKNOWN` until their full evidence is
executed and reconciled. A scenario can only become `COVERED` from same-run,
traceable evidence.
