# Contract — F05 Check-in

## Prerequisites

- Commit under evaluation checked out; `npm run down -- --reset && npm run up` succeeded. If the evaluator runs in a
  worktree with its own stack (AGENTS.md "Parallel worktrees"), use that `APP_PORT` in `WEB`.
- Shell: bash (Git Bash on Windows). `WEB=http://localhost:3000`. `SQL() { docker compose exec -T db psql -U catraca -tAc "$1"; }`.
- Helpers:
  ```sh
  login() { curl -s -o /dev/null -c "$1" -X POST "$WEB/login" --data-urlencode "email=$2" --data-urlencode password=catraca123; }
  login jarA org.a@catraca.test; login jarB org.b@catraca.test; login jarP participante@catraca.test
  NEXT=$(date -d "+1 month" +%Y-%m-%dT20:00)
  mkevent() { # $1=jar $2=name $3=capacity -> published event id
    id=$(curl -s -i -b "$1" -X POST "$WEB/organizer/events" --data-urlencode "name=$2" --data-urlencode "venue=Bar" \
      --data-urlencode "startsAt=$NEXT" --data-urlencode "capacity=$3" --data-urlencode "price=10,00" | grep -io 'evt_[a-z0-9]*' | head -1)
    curl -s -o /dev/null -b "$1" -X POST "$WEB/organizer/events/$id/publish"; echo "$id"; }
  buy() { curl -s -o /dev/null -b jarP -X POST "$WEB/events/$1/purchase" --data-urlencode "cardNumber=$2"; }
  lastcode() { SQL "select code from tickets where event_id='$1' order by created_at desc limit 1"; }
  checkin() { # $1=jar $2=event $3=code -> prints the check-in message shown after the redirect
    curl -s -L -b "$1" -X POST "$WEB/organizer/events/$2/checkin" --data-urlencode "code=$3" \
      | grep -o '<p class="checkin-result"[^>]*>[^<]*' | sed 's/.*>//'; }
  ```

## Items

### F05-C1 — A confirmed storefront code is admitted (F05-AC1 rule 5; X-F03-F05-1)

- **Steps**: `E=$(mkevent jarA "F05 C1" 5)`; `buy $E 4000000000000001`; wait 6 s; read the code shown in
  `curl -s -b jarP "$WEB/my-tickets"` for `F05 C1` (`C1`); `curl -s -i -b jarA -X POST "$WEB/organizer/events/$E/checkin" --data-urlencode "code=$C1"`;
  `checkin jarA $E "$C1"` is **not** run yet; instead load `curl -s -b jarA "<Location from the POST>"`;
  `SQL "select checked_in_at is not null from tickets where code='$C1'"`.
- **Expected**: the POST answers `303` with `Location: /organizer/events/$E?checkin=admitted#checkin`; the page shows
  `Entrada liberada` in `p.checkin-result`; the query returns `t`.

### F05-C2 — The same code again is already used (rule 4)

- **Steps**: `checkin jarA $E "$C1"` (from C1). · **Expected**: `Ingresso já utilizado`.

### F05-C3 — Pending and declined tickets are not confirmed (rule 3)

- **Steps**: `E=$(mkevent jarA "F05 C3" 5)`; `buy $E 4000000000000003`; `CP=$(lastcode $E)`; `checkin jarA $E "$CP"`;
  `buy $E 4000000000000002`; wait 6 s; `CD=$(lastcode $E)`; `SQL "select status from tickets where code='$CD'"`; `checkin jarA $E "$CD"`.
- **Expected**: `Ingresso não confirmado` for the pending code; `declined` then `Ingresso não confirmado` for the declined code.

### F05-C4 — Unknown codes and codes from other events are invalid (rule 1, F05-AC2)

- **Steps**: `checkin jarA $E ZZZZZZZZ` (E from C3); `checkin jarA $E ""`; `E2=$(mkevent jarB "F05 B event" 1)`;
  `curl -s -o /dev/null -b jarP -X POST "$WEB/events/$E2/purchase" --data-urlencode cardNumber=4000000000000001`; wait 6 s;
  `C3=$(lastcode $E2)`; `SQL "select status from tickets where code='$C3'"`; `checkin jarA $E "$C3"`.
- **Expected**: `Ingresso inválido para este evento` three times (the third code is `confirmed`, but belongs to B's event).

### F05-C5 — A cancelled event says so before ticket checks (rule 2, F05-AC2)

- **Steps**: `E=$(mkevent jarA "F05 C5" 5)`; `buy $E 4000000000000001`; wait 6 s; `CC=$(lastcode $E)`; `buy $E 4000000000000003`;
  `CPN=$(lastcode $E)`; `SQL "update events set status='cancelled' where id='$E'"` (F07 does not exist yet);
  `checkin jarA $E "$CC"`; `checkin jarA $E "$CPN"`; `checkin jarA $E "$C3"` (C3 from C4); `checkin jarA $E ZZZZZZZZ`.
- **Expected**: `Evento cancelado` for the confirmed and the pending code; `Ingresso inválido para este evento` for the
  other event's code and for `ZZZZZZZZ` (rule 1 comes first).

### F05-C6 — Simultaneous check-ins admit once (F05-AC3)

- **Steps**: `E=$(mkevent jarA "F05 C6" 5)`; `buy $E 4000000000000001`; wait 6 s; `CX=$(lastcode $E)`;
  `(checkin jarA $E "$CX" & checkin jarA $E "$CX" & wait) | sort`.
- **Expected**: exactly one `Entrada liberada` and one `Ingresso já utilizado`. The automated test `tests/checkin.test.ts` ›
  "concurrent check-ins admit exactly once" (≥ 10 simultaneous calls on one code) passes in F05-C-GATES.

### F05-C7 — X-F02-F05-1: only the owner can check in (R04, R13)

- **Steps**: `E=$(mkevent jarA "F05 C7" 5)`; `buy $E 4000000000000001`; wait 6 s; `CO=$(lastcode $E)`;
  `curl -s -i -b jarB -X POST "$WEB/organizer/events/$E/checkin" --data-urlencode "code=$CO"`;
  `curl -s -i -X POST "$WEB/organizer/events/$E/checkin" --data-urlencode "code=$CO"` (visitor);
  `curl -s -i -b jarP -X POST "$WEB/organizer/events/$E/checkin" --data-urlencode "code=$CO"`;
  `SQL "select checked_in_at is null from tickets where code='$CO'"`; `curl -s -b jarA "$WEB/organizer/events/$E"`.
- **Expected**: B → `404` whose body contains neither `F05 C7` nor `$CO`; visitor → `303` `Location: /login`; participant → `403`;
  the query returns `t` (not checked in); A's management page contains `<section id="checkin">` with a `code` field.

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
