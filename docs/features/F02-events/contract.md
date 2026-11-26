# Contract — F02 Event management and storefront listing

## Prerequisites

- Commit under evaluation checked out; `npm run down -- --reset && npm run up` succeeded.
- Shell: bash. On Windows run each item's commands with Git Bash, e.g.
  `"C:\Program Files\Git\bin\bash.exe" -lc 'cd /d/projects/mba/catraca && <commands>'`. `WEB=http://localhost:3000`.
- "Event data" of `$EVT` means any of: its name, its venue, its formatted date (`DD/MM/YYYY 20:00`), its
  formatted price (`R$ 100,00` or `R$ 150,00`), or a form/link targeting `/organizer/events/$EVT`.
- DB queries: `docker compose exec -T db psql -U catraca -tAc "<sql>"`.
- Log in with cookie jars:
  `curl -s -o /dev/null -c jarA -X POST "$WEB/login" --data-urlencode email=org.a@catraca.test --data-urlencode password=catraca123`
  (same for `jarB` = `org.b@catraca.test`, `jarP` = `participante@catraca.test`).
- Dates: `NEXT=$(date -d "+1 month" +%Y-%m-%dT20:00)`, `YESTERDAY=$(date -d "-1 day" +%Y-%m-%dT20:00)`.
- Create an event as A (reused by several items; `EVT` = the id at the end of the `Location` header):
  ```sh
  curl -s -i -b jarA -X POST "$WEB/organizer/events" --data-urlencode "name=Jazz no Porão F02" \
    --data-urlencode "venue=Bar do Zé" --data-urlencode "startsAt=$NEXT" \
    --data-urlencode capacity=2 --data-urlencode "price=100,00"
  ```

## Items

### F02-C1 — Create an event (draft) with its own management page

- **Steps**: the create request above; `curl -s -b jarA "$WEB/organizer/events/$EVT"`;
  `select status, capacity, price_cents from events where id='$EVT'`.
- **Expected**: `303` with `Location: /organizer/events/evt_…`; the management page shows `Jazz no Porão F02`,
  `Bar do Zé`, the date in `DD/MM/YYYY 20:00` format, `R$ 100,00` and `Rascunho`, and it has an edit form and a
  `Publicar` button; the query returns `draft|2|10000`.

### F02-C2 — Invalid values are rejected and nothing is saved

- **Steps**: count A's events; POST `/organizer/events` with the valid fields above, changing one at a time:
  (a) `name=` (b) `venue=` (c) `startsAt` omitted (d) `startsAt=amanhã` (e) `capacity=0` (f) `capacity=2.5`
  (g) `price=0` (h) `price=-5` (i) `price=abc`.
- **Expected**: each answers `422` with, respectively: (a) `Informe o nome do evento.` (b) `Informe o local do evento.`
  (c, d) `Informe a data e a hora de início.` (e, f) `A lotação deve ser um número inteiro maior ou igual a 1.`
  (g, h) `O preço deve ser maior que zero.` (i) `Informe um preço válido.`. A's event count is unchanged.

### F02-C3 — The start must be in the future, on create and on edit (R01)

- **Steps**: (a) POST create with `startsAt=$YESTERDAY`; (b) POST `/organizer/events/$EVT` (edit) with all
  fields valid except `startsAt=$YESTERDAY`; then `select starts_at from events where id='$EVT'`.
- **Expected**: both `422` with `A data de início precisa estar no futuro.`; no event is created by (a); `$EVT`'s
  `starts_at` is unchanged. The boundary (`starts_at <= now` rejected, `now + 1 min` accepted, on create and edit)
  is covered by the automated test `tests/events-domain.test.ts` › "future boundary", which runs in F02-C-GATES.

### F02-C4 — Drafts are hidden from the storefront; published events appear (R02)

- **Steps**: as a visitor: `curl -s "$WEB/"` and `curl -s -i "$WEB/events/$EVT"` (status line and body);
  then `curl -s -i -b jarA -X POST "$WEB/organizer/events/$EVT/publish"`; repeat both visitor requests.
- **Expected**: before publishing, `/` does not contain `Jazz no Porão F02` and the event page answers `404`.
  Publish answers `303`. Afterwards, `/` contains the name, `Bar do Zé`, the date and `R$ 100,00`, and the
  event page answers `200` with the name.

### F02-C5 — Management page: publish only for drafts (R04)

- **Steps**: after C4, `curl -s -b jarA "$WEB/organizer/events/$EVT"`; then POST `/publish` again;
  `select status from events where id='$EVT'`.
- **Expected**: the page shows `Publicado` and no `Publicar` button, and still has the edit form; the second
  publish answers `409`; status is `published`.

### F02-C6 — Organizers only see and operate their own events (R13)

- **Steps**: as B: `curl -s -b jarB "$WEB/organizer/events"`; `curl -s -i -b jarB "$WEB/organizer/events/$EVT"`;
  POST edit to `$EVT` with `name=Hacked` (other fields valid); POST `/organizer/events/$EVT/publish`;
  `select name, status from events where id='$EVT'`.
- **Expected**: B's list contains no event data of `$EVT`; the management URL answers `404` and its body
  contains no event data of `$EVT` (see Prerequisites); both POSTs answer `404` and their bodies contain no event
  data of `$EVT`; the row is unchanged.

### F02-C7 — Price edits and capacity increases are accepted (R03)

- **Steps**: as A, POST edit to `$EVT` with the same fields but `price=150,00` and `capacity=3`; load the
  management page and the public event page.
- **Expected**: `303`; both pages show `R$ 150,00`; the management page shows capacity `3`;
  `select capacity, price_cents from events where id='$EVT'` returns `3|15000`.

### F02-C8 — X-F01-F02-1: visitors and participants cannot reach a real organizer event (R13)

- **Steps**: `curl -s -i "$WEB/organizer/events/$EVT"`; `curl -s -i -b jarP "$WEB/organizer/events/$EVT"`.
- **Expected**: visitor → `303` `Location: /login`; participant → `403`; neither body contains event data of `$EVT`.

### F02-C-GATES — Gates pass

- **Steps**: `npm run gates`
- **Expected**: exit 0, all PASS, including `tests/events-domain.test.ts`, `tests/events-http.test.ts` and `tests/format.test.ts`.

## Criteria mapping

| PRD criterion | Rules | Contract items |
|---|---|---|
| F02-AC1 | R01 | F02-C1, F02-C2 |
| F02-AC2 | R01 | F02-C3, F02-C-GATES |
| F02-AC3 | R02 | F02-C4 |
| F02-AC4 | R04 | F02-C1, F02-C5 |
| F02-AC5 | R13 | F02-C6 |
| F02-AC6 | R03 | F02-C7 |
| X-F01-F02-1 | R13 | F02-C8 |
