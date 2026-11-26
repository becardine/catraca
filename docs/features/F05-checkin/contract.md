# Contract — F05 Check-in

## Prerequisites

- Commit under evaluation checked out. Environment: the default `GATEWAY_DELAY_SCALE=1` (do not set it). If several
  stacks run in parallel, **export** the worktree variables before every command of this contract (AGENTS.md "Parallel
  worktrees"), e.g. `export COMPOSE_PROJECT_NAME=catraca-f05 APP_PORT=3005 GATES_PROJECT=catraca-gates-f05 GATES_DB_PORT=55435`;
  then `npm run down -- --reset && npm run up`.
- **Run the items in order, in one shell session**: C2 uses C1's variables, C4 uses C3's, C5 uses C4's.
- Shell: bash (Git Bash on Windows). `WEB=http://localhost:${APP_PORT:-3000}`.
  `SQL() { docker compose exec -T db psql -U catraca -tAc "$1"; }`.
- Access rules used in C7 come from F01 (`docs/features/F01-accounts/spec.md`): a visitor on `/organizer/*` gets
  `303 Location: /login`; a participant gets `403`.
- Helpers:
  ```sh
  login() { curl -s -o /dev/null -c "$1" -X POST "$WEB/login" --data-urlencode "email=$2" --data-urlencode password=catraca123; }
  login jarA org.a@catraca.test; login jarB org.b@catraca.test; login jarP participante@catraca.test
  NEXT=$(date -d "+1 month" +%Y-%m-%dT20:00)
  mkevent() { # $1=jar $2=name $3=capacity -> published event id; fails loudly if creation failed
    id=$(curl -s -i -b "$1" -X POST "$WEB/organizer/events" --data-urlencode "name=$2" --data-urlencode "venue=Bar" \
      --data-urlencode "startsAt=$NEXT" --data-urlencode "capacity=$3" --data-urlencode "price=10,00" | grep -io 'evt_[a-z0-9]*' | head -1)
    [ -n "$id" ] || { echo "EVENT CREATION FAILED" >&2; return 1; }
    curl -s -o /dev/null -b "$1" -X POST "$WEB/organizer/events/$id/publish"; echo "$id"; }
  buy() { curl -s -o /dev/null -b jarP -X POST "$WEB/events/$1/purchase" --data-urlencode "cardNumber=$2"; }
  lastcode() { SQL "select code from tickets where event_id='$1' order by created_at desc limit 1"; }
  # No -X POST: --data-urlencode makes it a POST, and -L then follows the 303 with a GET.
  checkin() { # $1=jar $2=event $3=code -> prints the message shown after the redirect
    curl -s -L -b "$1" "$WEB/organizer/events/$2/checkin" --data-urlencode "code=$3" \
      | grep -o '<p class="checkin-result"[^>]*>[^<]*' | sed 's/.*>//'; }
  ```

## Items

### F05-C1 — A confirmed storefront code is admitted (F05-AC1 rule 5; X-F03-F05-1)

- **Steps**:
  ```sh
  E1=$(mkevent jarA "F05 C1" 5); buy $E1 4000000000000001; sleep 6
  C1=$(curl -s -b jarP "$WEB/my-tickets" | grep -A3 '<td>F05 C1</td>' | grep -o '<code>[^<]*' | sed 's/<code>//' | head -1)
  LOC=$(curl -s -i -b jarA "$WEB/organizer/events/$E1/checkin" --data-urlencode "code=$C1" | grep -i '^location:' | tr -d '\r' | sed 's/^[Ll]ocation: //')
  echo "$LOC"; curl -s -b jarA "$WEB$LOC" | grep -o '<p class="checkin-result"[^>]*>[^<]*'
  SQL "select checked_in_at is not null from tickets where code='$C1'"
  ```
- **Expected**: `C1` is an 8-character code; `LOC` is `/organizer/events/$E1?checkin=admitted#checkin`; the page shows
  `Entrada liberada` in `p.checkin-result`; the query returns `t`.

### F05-C2 — The same code again is already used (rule 4)

- **Steps**: `checkin jarA $E1 "$C1"`. · **Expected**: `Ingresso já utilizado`.

### F05-C3 — Pending and declined tickets are not confirmed (rule 3)

- **Steps**: `E3=$(mkevent jarA "F05 C3" 5)`; `buy $E3 4000000000000003`; `CP=$(lastcode $E3)`; `checkin jarA $E3 "$CP"`;
  `buy $E3 4000000000000002`; `CD=$(lastcode $E3)`; `sleep 6`; `SQL "select status from tickets where code='$CD'"`; `checkin jarA $E3 "$CD"`.
- **Expected**: `Ingresso não confirmado` for the pending code; `declined`, then `Ingresso não confirmado` for the declined code.

### F05-C4 — Unknown codes and codes from other events are invalid (rule 1, F05-AC2)

- **Steps**: `checkin jarA $E3 ZZZZZZZZ`; `checkin jarA $E3 ""`; `checkin jarA $E3 "$C1"` (a code from another of **A's own** events);
  `E4B=$(mkevent jarB "F05 B event" 1)`; `curl -s -o /dev/null -b jarP -X POST "$WEB/events/$E4B/purchase" --data-urlencode cardNumber=4000000000000001`;
  `sleep 6`; `CB=$(lastcode $E4B)`; `SQL "select status from tickets where code='$CB'"`; `checkin jarA $E3 "$CB"`.
- **Expected**: `Ingresso inválido para este evento` four times (C1's code is from A's other event; `CB` is `confirmed`,
  but belongs to B's event).

### F05-C5 — A cancelled event says so before ticket checks (rule 2, F05-AC2)

- **Steps**: `E5=$(mkevent jarA "F05 C5" 5)`; `buy $E5 4000000000000001`; `sleep 6`; `CC=$(lastcode $E5)`; `buy $E5 4000000000000003`;
  `CPN=$(lastcode $E5)`; `SQL "update events set status='cancelled' where id='$E5'"` (F07 does not exist yet);
  `checkin jarA $E5 "$CC"`; `checkin jarA $E5 "$CPN"`; `checkin jarA $E5 "$CB"`; `checkin jarA $E5 ZZZZZZZZ`.
- **Expected**: `Evento cancelado` for the confirmed and the pending code; `Ingresso inválido para este evento` for B's code
  and for `ZZZZZZZZ` (rule 1 comes first). The check-in field (`name="code"`) is still on the page.

### F05-C6 — Simultaneous check-ins admit once (F05-AC3)

- **Steps**:
  1. `E6=$(mkevent jarA "F05 C6" 5)`; `buy $E6 4000000000000001`; `sleep 6`; `CX=$(lastcode $E6)`;
     `for i in 1 2 3 4 5 6 7 8; do checkin jarA $E6 "$CX" & done; wait` (output collected and counted with `sort | uniq -c`).
  2. `npx vitest run tests/checkin.test.ts --reporter=verbose` against the gates database: run inside `npm run gates`, or
     start it by hand with `docker compose -p "${GATES_PROJECT:-catraca-gates}" -f docker-compose.gates.yml up -d --wait db` and
     `TEST_DATABASE_URL=postgres://catraca:catraca@localhost:${GATES_DB_PORT:-55433}/catraca`.
  3. Read the test "concurrent check-ins admit exactly once" in `tests/checkin.test.ts`.
- **Expected**: (1) exactly one `Entrada liberada` and seven `Ingresso já utilizado`; (2) the verbose output lists
  "concurrent check-ins admit exactly once" as passed; (3) the test fires ≥ 10 `checkIn` calls on one code with
  `Promise.all` and asserts exactly 1 `admitted` and the rest `already_used`.

### F05-C7 — X-F02-F05-1: only the owner can check in (R04, R13)

- **Steps**: `E7=$(mkevent jarA "F05 C7" 5)`; `buy $E7 4000000000000001`; `sleep 6`; `CO=$(lastcode $E7)`;
  `curl -s -i -b jarB "$WEB/organizer/events/$E7/checkin" --data-urlencode "code=$CO"`;
  `curl -s -i "$WEB/organizer/events/$E7/checkin" --data-urlencode "code=$CO"` (visitor);
  `curl -s -i -b jarP "$WEB/organizer/events/$E7/checkin" --data-urlencode "code=$CO"`;
  `SQL "select checked_in_at is null from tickets where code='$CO'"`; `curl -s -b jarA "$WEB/organizer/events/$E7"`.
- **Expected**: B → `404` whose body contains neither `F05 C7` nor `$CO`; visitor → `303` `Location: /login`; participant → `403`;
  the query returns `t` (not checked in); A's management page contains `<section id="checkin">` with an input `name="code"`.

### F05-C-GATES — Gates pass

- **Steps**: `npm run gates` · **Expected**: exit 0, all PASS, including `tests/checkin.test.ts`.

## Criteria mapping

| PRD criterion | Rules | Contract items |
|---|---|---|
| F05-AC1 | R10 | F05-C1, F05-C2, F05-C3, F05-C4, F05-C5 |
| F05-AC2 | R10 | F05-C4, F05-C5 |
| F05-AC3 | R10 | F05-C6 |
| X-F02-F05-1 | R04, R13 | F05-C7 |
| X-F03-F05-1 | R09, R10 | F05-C1 |
