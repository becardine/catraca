# Plan — F05 Check-in

1. `src/checkin/checkin.ts`: `CHECKIN_MESSAGES`, `checkIn(pool, organizerId, eventId, code)` with the ordered rules and
   the atomic update.
2. `src/checkin/index.ts`: `registerCheckin(app, deps)` registers the management section (order 20) and
   `POST /events/:id/checkin` inside `registerOrganizerRoutes`; one line in `src/app.ts`.
3. Tests `tests/checkin.test.ts`: every message; precedence (confirmed code from another event → invalid; pending
   ticket of a cancelled event → cancelled, status set via SQL); 2 concurrent check-ins → exactly one `admitted`;
   HTTP: owner flow with PRG and message on the page, organizer B → 404 with no data and no check-in, visitor → login,
   participant → 403; storefront code from "Meus ingressos" admitted.

Integration: `src/app.ts` is also edited by F04/F06 in this wave; keep the change to one import + one line.
