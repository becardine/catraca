# Plan — F02 Event management and storefront listing

Spec: `./spec.md` · Contract: `./contract.md`

## Steps

1. **Format helpers**: `src/lib/format.ts` + `tests/format.test.ts` (money parse/format, datetime-local in -03:00).
2. **Schema and domain**: `migrations/003_events.sql`, `src/events/events.ts`, `src/events/sections.ts`;
   `tests/events-domain.test.ts` (validation order and messages, future boundary with a controlled clock,
   ownership returns null, publish only drafts, update validators run inside the lock).
3. **Organizer pages**: `src/events/organizer-routes.ts` (list, new, create, management page, edit, publish).
4. **Storefront**: `src/events/storefront-routes.ts` (`/`, `/events/:id`); remove `src/ui/placeholders.ts`.
5. **Wiring**: `src/events/index.ts` `registerEvents(app, { pool, events })`; `src/app.ts` creates the
   `EventsRegistry`; `tests/events-http.test.ts` covers every contract item that can be automated, including
   X-F01-F02-1.
6. **Test hygiene**: tests read seed passwords from `SEED_USERS` instead of repeating the literal (avoids
   GitGuardian false positives).

## Integration notes

- `src/app.ts` gains one line per feature; `EventsRegistry` is passed to F03, F05, F06 and F07.
- F03 must add its capacity validator through `registerEventUpdateValidator`, not by editing `updateEvent`.

## Handoff checklist

- [ ] `npm run gates` passes
- [ ] `project-state.json` F02 → `in_evaluation`
