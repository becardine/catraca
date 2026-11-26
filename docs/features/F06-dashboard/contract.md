# Contract — F06 Event dashboard

## Prerequisites

- Commit under evaluation checked out. Environment: the default `GATEWAY_DELAY_SCALE=1` (do not set it). If several
  stacks run in parallel, **export** the worktree variables before every command of this contract (AGENTS.md "Parallel
  worktrees"), e.g. `export COMPOSE_PROJECT_NAME=catraca-f06 APP_PORT=3006 GATES_PROJECT=catraca-gates-f06 GATES_DB_PORT=55436`;
  then `npm run down -- --reset && npm run up`.
- Shell: bash (Git Bash on Windows). `WEB=http://localhost:${APP_PORT:-3000}`.
  `SQL() { docker compose exec -T db psql -U catraca -tAc "$1"; }`.
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
  dash() { # prints "confirmed=.. pending=.. checkIns=.. availableSeats=.. revenue=.. refunded=.."
    page=$(curl -s -b jarA "$WEB/organizer/events/$1")
    for m in confirmed pending checkIns availableSeats revenue refunded; do
      printf '%s=%s ' "$m" "$(echo "$page" | grep -o "data-metric=\"$m\">[^<]*" | sed 's/.*>//')"; done; echo; }
  ```
- F05 (check-in) and F07 (cancellation) are built in parallel or later. Items that need checked-in, refunded or cancelled
  tickets set those states with SQL, after **freezing** the event's unprocessed gateway jobs
  (`update payment_jobs set processed_at=now() where processed_at is null and ticket_id in (select id from tickets where event_id=…)`)
  so no late answer races the fixture.

## Items

### F06-C1 — Labels and an empty event (F06-AC1)

- **Steps**: `E1=$(mkevent "F06 C1" 5 "100,00")`; `curl -s -b jarA "$WEB/organizer/events/$E1"`; `dash $E1`.
- **Expected**: the page has `<section id="dashboard">` with the labels `Confirmados`, `Pendentes`, `Check-ins`,
  `Vagas disponíveis`, `Receita`, `Estornados`; `dash` prints
  `confirmed=0 pending=0 checkIns=0 availableSeats=5 revenue=R$ 0,00 refunded=0`.

### F06-C2 — Gateway outcomes are counted correctly (F06-AC1, F06-AC2, R05)

- **Steps**: `E2=$(mkevent "F06 C2" 5 "100,00")`; `buy $E2 4000000000000001; buy $E2 4000000000000001; buy $E2 4000000000000002`;
  `sleep 6`; `buy $E2 4000000000000003`; within 20 s of that purchase run
  `SQL "select status, count(*) from tickets where event_id='$E2' group by 1 order by 1"` and `dash $E2`.
- **Expected**: the query shows `confirmed|2`, `declined|1`, `pending|1`; `dash` prints
  `confirmed=2 pending=1 checkIns=0 availableSeats=2 revenue=R$ 200,00 refunded=0` (the declined ticket is in no number).

### F06-C3 — Check-ins, refunds and cancellations, with a deterministic fixture (F06-AC1, F06-AC2)

- **Steps**: `E3=$(mkevent "F06 C3" 10 "100,00")`; `for i in 1 2 3 4; do buy $E3 4000000000000001; done`;
  `buy $E3 4000000000000003; buy $E3 4000000000000003`; `sleep 6`; freeze the jobs (see Prerequisites); then
  ```sh
  SQL "with c as (select id, row_number() over (order by id) n from tickets where event_id='$E3' and status='confirmed'),
            p as (select id, row_number() over (order by id) n from tickets where event_id='$E3' and status='pending')
       update tickets t set
         checked_in_at = case when t.id in (select id from c where n in (1,2)) then now() else t.checked_in_at end,
         status = case when t.id in (select id from c where n in (2,3)) then 'refunded'
                       when t.id in (select id from p where n = 2) then 'cancelled' else t.status end
       where t.event_id='$E3'"
  SQL "select status, checked_in_at is not null, count(*) from tickets where event_id='$E3' group by 1,2 order by 1,2"
  dash $E3
  ```
- **Expected**: the query shows `cancelled|f|1`, `confirmed|f|1`, `confirmed|t|1`, `pending|f|1`, `refunded|f|1`, `refunded|t|1`.
  `dash` prints `confirmed=2 pending=1 checkIns=1 availableSeats=7 revenue=R$ 200,00 refunded=2`. In particular, the
  checked-in **refunded** ticket adds nothing to Check-ins, Confirmados or Receita.

### F06-C4 — X-F03-F06-1: revenue uses each ticket's price (R03, R12)

- **Steps**: `E4=$(mkevent "F06 C4" 3 "100,00")`; `buy $E4 4000000000000001; buy $E4 4000000000000001`; `sleep 6`;
  ```sh
  curl -s -o /dev/null -w "%{http_code}\n" -b jarA -X POST "$WEB/organizer/events/$E4" --data-urlencode "name=F06 C4" \
    --data-urlencode "venue=Bar" --data-urlencode "startsAt=$NEXT" --data-urlencode capacity=3 --data-urlencode "price=150,00"
  ```
  `buy $E4 4000000000000001`; `sleep 6`; `dash $E4`.
- **Expected**: the edit prints `303`; `dash` prints `confirmed=3 pending=0 checkIns=0 availableSeats=0 revenue=R$ 350,00 refunded=0`.

### F06-C5 — Computed at render time, no stored counters (F06-AC3)

- **Steps**: `E5=$(mkevent "F06 C5" 5 "10,00")`; `buy $E5 4000000000000001` and run `dash $E5` within 1 s of it; `sleep 6`; `dash $E5`.
  Source checks on the evaluated commit, against the wave base (`git merge-base HEAD main`):
  `git diff --name-only $(git merge-base HEAD main) HEAD -- migrations` and `grep -rniE "insert|update|delete" src/dashboard`.
- **Expected**: first `confirmed=0 pending=1 checkIns=0 availableSeats=4 revenue=R$ 0,00 refunded=0`, then
  `confirmed=1 pending=0 checkIns=0 availableSeats=4 revenue=R$ 10,00 refunded=0`, with no action other than the reload;
  F06 adds no migration (empty diff) and `src/dashboard` contains no write statement (no `grep` match).

### F06-C6 — Cancelled event shows zero seats (F06-AC1, R05)

- **Steps**: `E6=$(mkevent "F06 C6" 5 "10,00")`; `SQL "update events set status='cancelled' where id='$E6'"`; `dash $E6`.
- **Expected**: `availableSeats=0`.

### F06-C7 — X-F02-F06-1: only the owner sees the dashboard (R04, R13)

- **Steps**: with `E4` from C4: `curl -s -i -b jarB "$WEB/organizer/events/$E4"`;
  `curl -s -b jarA "$WEB/organizer/events/$E4" | grep -o 'data-metric="[a-zA-Z]*"' | sort -u`.
- **Expected**: B → `404` and the body contains none of `data-metric`, `F06 C4` or `R$ 350,00`; A's page lists exactly the six
  metrics `availableSeats, checkIns, confirmed, pending, refunded, revenue`.

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
