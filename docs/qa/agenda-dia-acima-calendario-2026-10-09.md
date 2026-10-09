# Agenda selected day above month calendar (2026-10-09)

In Month view, the existing selected-day agenda block now appears before the month grid in the page structure. Selecting a day in the calendar still drives the content above it. The empty-day message, occurrence detail action, and existing actions remain in place. The List view does not render the month grid and keeps its prior layout. Content is moved, not duplicated.

## Validation

- Frontend: `npm.cmd run build` - passed.
- Focused Playwright: `npx.cmd playwright test --config=playwright.agenda.config.ts e2e/agenda-calendario.spec.ts --grep "selected day agenda"` - 2 passed at 390 px and 768 px. Checked DOM order for keyboard/screen reader, selection updates, the empty day state, detail opening, and horizontal overflow.
- No backend, API, rule, or data changes. PROD was not accessed. No migration QA was run.

## Evidence

Focused test: `e2e/agenda-calendario.spec.ts`. UI: `frontend/src/components/operacao/AgendaOperacionalPanel.tsx`.
