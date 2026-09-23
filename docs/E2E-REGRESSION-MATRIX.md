# E2E Regression Matrix

## Capability Dependency Matrix

Capabilities are independent. A flow may require a capability only when it
uses the resource owned by that capability.

| Case | Mode | tapsEnabled | Tap/chope state | inventoryEnabled | kitchenEnabled | Expected event creation |
| --- | --- | --- | --- | --- | --- | --- |
| E01 | EVENTO | false | none | false | false | PASS |
| E02 | EVENTO | true | no taps | false | false | PASS |
| E03 | EVENTO | true | tap without chope | false | false | PASS |
| E04 | EVENTO | true | active tap with chope | false | false | PASS |
| E05 | EVENTO | false | historical taps only | false | false | PASS; history does not enable taps |
| E06 | EVENTO | true | inactive/historical chope | false | false | PASS |

The same event-creation cases must be repeated with every combination of
`inventoryEnabled` and `kitchenEnabled`. Neither capability is a prerequisite
for creating, scheduling, opening, or closing an event.

Tap-specific operations keep their own guards. Selling draft beer, mounting a
tap, or changing tap state may require `tapsEnabled` and a valid tap/chope
configuration; those checks must not be promoted to the event lifecycle.

## Golden scenario

Tenant: `Demo Chopp Móvel` in DEV.

With no chope associated with the trailer, create an `Evento avulso`, open it,
and close it. Expected result: `EVENT_CREATED=PASS`, with no chope-related
blocking message. Run the full E2E suite after the focused matrix and require
`FULL_E2E_FAILED=0` before promotion.

## Executed evidence

The automated matrix is implemented in
`e2e/event-capability-matrix.spec.ts`. It executes each E01-E06 case across
all four inventory/kitchen combinations, for 24 total cases. Every case
creates, opens, closes, reopens, and closes an isolated event successfully.

| Gate | Result |
| --- | --- |
| CAPABILITY_DEPENDENCY_CASES | 24 |
| CAPABILITY_DEPENDENCY_PASSED | 24 |
| CAPABILITY_DEPENDENCY_FAILED | 0 |
| TAP_SPECIFIC_GUARDS | PASS |
| FULL_E2E_TOTAL | 64 |
| FULL_E2E_PASSED | 64 |
| FULL_E2E_FAILED | 0 |
| FULL_E2E_SKIPPED | 0 |

The reported historical backend count of `144 PASS / 2 skipped` was not an
accurate interpretation of the runner inventory. The reference script at
`origin/main` (SHA `134e8f5`) declares 144 test calls, including the two
conditional DEV skips; therefore its executable result is 142 PASS / 2
skipped. This worktree initially ran only 134 calls because three existing
test files were omitted from `backend/package.json`; restoring them and adding
the capability guard test produces the same 144 total calls: 142 PASS / 2
skipped. No current test was silently filtered. The E2E runner initially
listed 40 tests because this branch did not include the capability matrix;
adding the 24 executable EVENTO cases produced 64/64, above the historical
57-case baseline.
