# Agenda recurring schedules button (2026-10-09)

Moved access to the recurring-rules panel from the secondary period row into the main toolbar, beside **+ Novo agendamento**. The button is now labeled **Agendamentos recorrentes (N)** and uses secondary styling; the one-off scheduling action remains primary. Labels can wrap on mobile without horizontal overflow. Both controls keep a minimum 44 px touch area.

The button preserves the dynamic count and opens the existing recurring-rules panel. No agenda rules, APIs, or data changed.

## Validation

- Frontend: `npm.cmd run build` - passed.
- Focused Playwright: `npx.cmd playwright test --config=playwright.agenda.config.ts e2e/agenda-calendario.spec.ts --grep "recurring schedules button"` - 2 passed at 390 px and 768 px. Checked placement next to the primary action, styles, count (2), absence of the old button, panel opening, and no overflow or writes.
- Agenda calendar suite: `npx.cmd playwright test --config=playwright.agenda.config.ts e2e/agenda-calendario.spec.ts` - 18 passed.
- PROD was not accessed. No migration QA was run.

## Evidence

The focused test is in `e2e/agenda-calendario.spec.ts`; the UI change is in `frontend/src/components/operacao/AgendaOperacionalPanel.tsx`.
