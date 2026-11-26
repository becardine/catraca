# Plan — F06 Event dashboard

1. `src/dashboard/dashboard.ts`: `eventDashboard(db, eventId)` (one aggregate query + `seatStats`).
2. `src/dashboard/index.ts`: `registerDashboard(app, deps)` registers the management section (order 10) with the
   `data-metric` markup; one line in `src/app.ts`.
3. Tests `tests/dashboard.test.ts`: empty event; mixed statuses (confirmed, pending, declined, cancelled, refunded,
   checked in) with exact numbers; price snapshot (2 × 100 + 1 × 150 → 350); cancelled event → 0 seats; numbers change
   after a gateway result without any other write; HTTP: owner sees six `data-metric` values, organizer B gets 404 with
   no `data-metric`.

Integration: `src/app.ts` is also edited by F04/F05 in this wave; keep the change to one import + one line.
