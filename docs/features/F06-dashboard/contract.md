# Contract — F06 Event dashboard

## Prerequisites

- Commit under evaluation checked out; `npm run down -- --reset && npm run up` succeeded. If the evaluator runs in a
  worktree with its own stack (AGENTS.md "Parallel worktrees"), use that `APP_PORT` in `WEB`.
- Shell: bash (Git Bash on Windows). `WEB=http://localhost:3000`. `SQL() { docker compose exec -T db psql -U catraca -tAc "$1"; }`.
- Helpers:
  ```sh
  login() { curl -s -o /dev/null -c "$1" -X POST "$WEB/login" --data-urlencode "email=$2" --data-urlencode password=catraca123; }
  login jarA org.a@catraca.test; login jarB org.b@catraca.test; login jarP participante@catraca.test
  NEXT=$(date -d "+1 month" +%Y-%m-%dT20:00)
  mkevent() { # $1=name $2=capacity $3=price -> published event id (organizer A)
    id=$(curl -s -i -b jarA -X POST "$WEB/organizer/events" --data-urlencode "name=$1" --data-urlencode "venue=Bar" \
      --data-urlencode "startsAt=$NEXT" --data-urlencode "capacity=$2" --data-urlencode "price=$3" | grep -io 'evt_[a-z0-9]*' | head -1)
    curl -s -o /dev/null -b jarA -X POST "$WEB/organizer/events/$id/publish"; echo "$id"; }
  buy() { curl -s -o /dev/null -b jarP -X POST "$WEB/events/$1/purchase" --data-urlencode "cardNumber=$2"; }
  dash() { # prints "confirmed pending checkIns availableSeats revenue refunded"
    page=$(curl -s -b jarA "$WEB/organizer/events/$1")
    for m in confirmed pending checkIns availableSeats revenue refunded; do
      printf '%s=%s ' "$m" "$(echo "$page" | grep -o "data-metric=\"$m\">[^<]*" | sed 's/.*>//')"; done; echo; }
  ```
- F05 (check-in) and F07 (cancellation) are built in parallel or later, so items that need checked-in, refunded or
  cancelled tickets set those states with SQL.

## Items

### F06-C1 — Labels and an empty event (F06-AC1)

- **Steps**: `E=$(mkevent "F06 C1" 5 "100,00")`; `curl -s -b jarA "$WEB/organizer/events/$E"`; `dash $E`.
- **Expected**: the page has `<section id="dashboard">` with the labels `Confirmados`, `Pendentes`, `Check-ins`,
  `Vagas disponíveis`, `Receita`, `Estornados`; `dash` prints
  `confirmed=0 pending=0 checkIns=0 availableSeats=5 revenue=R$ 0,00 refunded=0`.

### F06-C2 — Gateway outcomes are counted correctly (F06-AC1, F06-AC2, R05)

- **Steps**: `E=$(mkevent "F06 C2" 5 "100,00")`; `buy $E 4000000000000001` ×2; `buy $E 4000000000000003`; `buy $E 4000000000000002`;
  wait 6 s; `SQL "select status, count(*) from tickets where event_id='$E' group by 1 order by 1"`; `dash $E`.
- **Expected**: the query shows `confirmed|2`, `declined|1`, `pending|1`; `dash` prints
  `confirmed=2 pending=1 checkIns=0 availableSeats=2 revenue=R$ 200,00 refunded=0` (the declined ticket is in no number).

### F06-C3 — Check-ins, refunds and cancellations (F06-AC1, F06-AC2)

- **Steps** (on `E` from C2):
  1. `SQL "update tickets set checked_in_at=now() where id=(select id from tickets where event_id='$E' and status='confirmed' order by id limit 1)"`; `dash $E`.
  2. `SQL "update tickets set status='refunded' where id=(select id from tickets where event_id='$E' and status='confirmed' and checked_in_at is null limit 1)"`; `dash $E`.
  3. `SQL "update tickets set status='cancelled' where event_id='$E' and status='pending'"`; `dash $E`.
- **Expected**:
  1. `confirmed=2 pending=1 checkIns=1 availableSeats=2 revenue=R$ 200,00 refunded=0`
  2. `confirmed=1 pending=1 checkIns=1 availableSeats=3 revenue=R$ 100,00 refunded=1`
  3. `confirmed=1 pending=0 checkIns=1 availableSeats=4 revenue=R$ 100,00 refunded=1`

### F06-C4 — X-F03-F06-1: revenue uses each ticket's price (R03, R12)

- **Steps**: `E=$(mkevent "F06 C4" 3 "100,00")`; `buy $E 4000000000000001` ×2; wait 6 s; as A edit `$E` with
  `name=F06 C4`, `venue=Bar`, `startsAt=$NEXT`, `capacity=3`, `price=150,00` (POST `/organizer/events/$E`); `buy $E 4000000000000001`;
  wait 6 s; `dash $E`.
- **Expected**: the edit answers `303`; `dash` prints `confirmed=3 pending=0 checkIns=0 availableSeats=0 revenue=R$ 350,00 refunded=0`.

### F06-C5 — Computed at render time: a reload shows the gateway result (F06-AC3)

- **Steps**: `E=$(mkevent "F06 C5" 5 "10,00")`; `buy $E 4000000000000001`; immediately `dash $E`; wait 6 s; `dash $E`;
  `SQL "select column_name from information_schema.columns where table_name='events' order by 1"`.
- **Expected**: first `confirmed=0 pending=1 … revenue=R$ 0,00`, then `confirmed=1 pending=0 … revenue=R$ 10,00`, with no
  action other than the reload; `events` has no counter columns (only `capacity, created_at, id, name, organizer_id,
  price_cents, starts_at, status, updated_at, venue`).

### F06-C6 — Cancelled event shows zero seats (F06-AC1, R05)

- **Steps**: `E=$(mkevent "F06 C6" 5 "10,00")`; `SQL "update events set status='cancelled' where id='$E'"`; `dash $E`.
- **Expected**: `availableSeats=0`.

### F06-C7 — X-F02-F06-1: only the owner sees the dashboard (R04, R13)

- **Steps**: `E` from C4; `curl -s -i -b jarB "$WEB/organizer/events/$E"`; `curl -s -b jarA "$WEB/organizer/events/$E" | grep -c data-metric`.
- **Expected**: B → `404` and the body contains no `data-metric`, `F06 C4` or `R$ 350,00`; A's page has `6` metric lines.

### F06-C-GATES — Gates pass

- **Steps**: `npm run gates` · **Expected**: exit 0, all PASS, including `tests/dashboard.test.ts`.

## Criteria mapping

| PRD criterion | Rules | Contract items |
|---|---|---|
| F06-AC1 | R12, R05 | F06-C1, F06-C2, F06-C3, F06-C6 |
| F06-AC2 | R12 | F06-C2, F06-C3 |
| F06-AC3 | R12 | F06-C5 |
| X-F02-F06-1 | R04, R13 | F06-C7 |
| X-F03-F06-1 | R03, R12 | F06-C4 |
