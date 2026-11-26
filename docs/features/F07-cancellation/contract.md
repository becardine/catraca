# Contract — F07 Event cancellation

## Prerequisites

- Commit under evaluation checked out. Environment: the default `GATEWAY_DELAY_SCALE=1` and `PARTNER_API_KEY` (do not set
  either); `npm run down -- --reset && npm run up`. If the stack is not the default one, **export** its variables
  (AGENTS.md "Parallel worktrees") before every command.
- **Run the items in order, in one bash session.** Shell: bash (Git Bash on Windows). `WEB=http://localhost:${APP_PORT:-3000}`,
  `API=$WEB`, `KEY=catraca-partner-dev-key`. `SQL() { docker compose exec -T db psql -U catraca -tAc "$1"; }`.
- Helpers:
  ```sh
  login() { curl -s -o /dev/null -c "$1" -X POST "$WEB/login" --data-urlencode "email=$2" --data-urlencode password=catraca123; }
  login jarA org.a@catraca.test; login jarB org.b@catraca.test; login jarP participante@catraca.test
  NEXT=$(date -d "+1 month" +%Y-%m-%dT20:00)
  mkdraft() { # $1=jar $2=name $3=capacity $4=price
    id=$(curl -s -i -b "$1" -X POST "$WEB/organizer/events" --data-urlencode "name=$2" --data-urlencode "venue=Bar" \
      --data-urlencode "startsAt=$NEXT" --data-urlencode "capacity=$3" --data-urlencode "price=$4" | grep -io 'evt_[a-z0-9]*' | head -1)
    [ -n "$id" ] || { echo "EVENT CREATION FAILED" >&2; return 1; }; echo "$id"; }
  mkevent() { id=$(mkdraft "$@") && curl -s -o /dev/null -b "$1" -X POST "$WEB/organizer/events/$id/publish" && echo "$id"; }
  buy() { curl -s -o /dev/null -b jarP -X POST "$WEB/events/$1/purchase" --data-urlencode "cardNumber=$2"; }   # storefront
  apibuy() { curl -s -X POST "$API/api/partner/events/$1/purchases" -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
    -d "{\"buyerEmail\":\"x@example.com\",\"cardNumber\":\"$2\"}"; }                                            # prints JSON
  jget() { node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(j[process.argv[1]])' "$1"; }
  ticket() { curl -s -H "X-Api-Key: $KEY" "$API/api/partner/tickets/$1"; }
  cancel() { curl -s -i -b "${2:-jarA}" -X POST "$WEB/organizer/events/$1/cancel"; }
  checkin() { curl -s -L -b jarA "$WEB/organizer/events/$1/checkin" --data-urlencode "code=$2" \
    | grep -o '<p class="checkin-result"[^>]*>[^<]*' | sed 's/.*>//'; }
  dash() { page=$(curl -s -b jarA "$WEB/organizer/events/$1"); for m in confirmed pending checkIns availableSeats revenue refunded; do
    printf '%s=%s ' "$m" "$(echo "$page" | grep -o "data-metric=\"$m\">[^<]*" | sed 's/.*>//')"; done | sed 's/ $//'; echo; }
  waitsince() { while [ $(( $(date +%s) - $1 )) -lt $2 ]; do sleep 1; done; }   # waitsince <epoch> <seconds>
  ```

## Items

### F07-C1 — Only published events can be cancelled, only by the owner (F07-AC1)

- **Steps**: `D1=$(mkdraft jarA "F07 draft" 5 "10,00")`; `curl -s -b jarA "$WEB/organizer/events/$D1" | grep -c 'Cancelar evento'`;
  `cancel $D1 | head -1`; `E1=$(mkevent jarA "F07 C1" 5 "10,00")`; `curl -s -b jarA "$WEB/organizer/events/$E1" | grep -c 'Cancelar evento'`;
  `cancel $E1 jarB` (status line and body); `SQL "select status from events where id in ('$D1','$E1') order by status"`;
  `cancel $E1 | grep -iE '^HTTP|^location'`; `cancel $E1 | head -1`; `SQL "select status from events where id='$E1'"`.
- **Expected**: the draft page has no `Cancelar evento` (`0`) and cancelling it answers `409`; the published page has the action
  (≥ `1`); B's attempt answers `404` with a body containing neither `F07 C1` nor `R$ 10,00`, and both events are unchanged
  (`draft`, `published`); A's cancel answers `303` with `Location: /organizer/events/$E1?notice=cancelled`; a second cancel answers
  `409`; the final status is `cancelled`.

### F07-C2 — X-F02-F07-1: a cancelled event cannot be edited or republished (F07-AC1, R04, R11)

- **Steps**: `P=$(curl -s -b jarA "$WEB/organizer/events/$E1")`; check `P` for `Cancelado`, `Salvar alterações`,
  `<form method="post" action="/organizer/events/$E1">`, `name="capacity"`, `/organizer/events/$E1/publish` and `Cancelar evento`; then
  `curl -s -i -b jarA -X POST "$WEB/organizer/events/$E1" --data-urlencode "name=Reaberto" --data-urlencode venue=Bar --data-urlencode "startsAt=$NEXT" --data-urlencode capacity=9 --data-urlencode "price=10,00"`;
  `curl -s -i -b jarA -X POST "$WEB/organizer/events/$E1/publish"`; `SQL "select name, status, capacity from events where id='$E1'"`.
- **Expected**: the page shows `Cancelado` and `Este evento foi cancelado. Não é possível editá-lo nem republicá-lo.`, and has no
  `Salvar alterações`, no edit form (`<form method="post" action="/organizer/events/$E1">`), no `name="capacity"` input, no publish
  form and no `Cancelar evento`; the edit answers `409` with `Evento cancelado não pode ser editado.`;
  publish answers `409`; the row is still `F07 C1|cancelled|5`.

### F07-C3 — Tickets are refunded / cancelled within 10 s (F07-AC2, R11)

- **Steps**: `E3=$(mkevent jarA "F07 C3" 5 "50,00")`; `S5=$(date +%s)` (**before** the slow purchase);
  `T5=$(apibuy $E3 4000000000000003 | jget ticketId)`; `T6=$(apibuy $E3 4000000000000001 | jget ticketId)`;
  poll `ticket $T6` every 0.5 s until `confirmed` (≤ 6 s); check `$(( $(date +%s) - S5 )) -lt 25` (otherwise the item is invalid:
  restart it); `C=$(date +%s)` (**before** the request); `cancel $E3 > /dev/null`; `ticket $T6`; `ticket $T5`; `echo $(( $(date +%s) - C ))`.
- **Expected**: the elapsed time printed (from before the cancel request until both lookups returned) is `≤ 10` s, `T6` is
  `"status":"refunded"` and `T5` is `"status":"cancelled"`; the cancel happened less than 30 s after `S5`, i.e. before T5's
  slow answer (30–40 s).

### F07-C4 — X-F03-F07-1: a late gateway answer does not change them (F07-AC3, R08, R11)

- **Steps**: `waitsince $S5 45`; `ticket $T5`; `ticket $T6`;
  `SQL "select t.id, t.status, j.processed_at is not null from tickets t join payment_jobs j on j.ticket_id=t.id where t.event_id='$E3' order by 1"`.
- **Expected**: `T5` is still `cancelled` and `T6` still `refunded`, and both payment jobs are processed (`t`), so the slow approval
  did run and did not overwrite the cancellation.

### F07-C5 — Off the storefront, no purchases (F07-AC4, R02, R11)

- **Steps**: `curl -s "$WEB/" | grep -c "F07 C3"`; `curl -s -o /dev/null -w "%{http_code}\n" "$WEB/events/$E3"`;
  `curl -s -o /dev/null -w "%{http_code}\n" -b jarP -X POST "$WEB/events/$E3/purchase" --data-urlencode cardNumber=4000000000000001`;
  `SQL "select count(*) from tickets where event_id='$E3'"`.
- **Expected**: `0`; `404`; `404`; count still `2`.

### F07-C6 — Zero seats (F07-AC5, R05)

- **Steps**: `dash $E3`. · **Expected**: `availableSeats=0`.

### F07-C7 — X-F04-F07-1: gone from the partner API (R11)

- **Steps**: `curl -s -H "X-Api-Key: $KEY" "$API/api/partner/events" | grep -c "$E3"`;
  `curl -s -w " %{http_code}" -X POST "$API/api/partner/events/$E3/purchases" -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d '{"buyerEmail":"x@example.com","cardNumber":"4000000000000001"}'`;
  `ticket $T5`; `ticket $T6`.
- **Expected**: `0`; `{"error":"event_not_available"} 404`; `T5` `cancelled`, `T6` `refunded` (ticket lookup still works).

### F07-C8 — X-F05-F07-1 and X-F06-F07-1: check-in and dashboard after cancel (R10, R11, R12)

- **Steps**: `C6=$(ticket $T6 | jget code)`; `checkin $E3 "$C6"`; `OTHER=$(mkevent jarA "F07 other" 1 "10,00")`;
  `CO=$(apibuy $OTHER 4000000000000001 | jget code)`; `checkin $E3 "$CO"`; `checkin $E3 ZZZZZZZZ`;
  `curl -s -b jarA "$WEB/organizer/events/$E3" | grep -c 'name="code"'`; `dash $E3`.
- **Expected**: `Evento cancelado` for C6. F05 keeps the check-in field on cancelled events (F05 spec), so the count is ≥ `1`
  and the list applies: `Ingresso inválido para este evento` for the other event's code and for `ZZZZZZZZ`. Automated proof
  (F07-C-GATES): `tests/cancellation.test.ts` › "check-in on a cancelled event" asserts the domain `checkIn` returns `invalid`
  for a foreign code and `cancelled` for this event's codes; `dash` prints exactly
  `confirmed=0 pending=0 checkIns=0 availableSeats=0 revenue=R$ 0,00 refunded=1` (the brief's step-14 numbers, after the late
  gateway answer of C4).

### F07-C9 — X-F04-F07-2: API and storefront purchases are cancelled the same way (R05, R10, R11, R12)

- **Steps**: `E9=$(mkevent jarA "F07 C9" 4 "10,00")`; `buy $E9 4000000000000001` (S1); `A1=$(apibuy $E9 4000000000000001 | jget ticketId)`;
  `S9=$(date +%s)` (**before** A2's purchase); `A2=$(apibuy $E9 4000000000000003 | jget ticketId)`; `sleep 6`;
  `S1=$(SQL "select id from tickets where event_id='$E9' and channel='storefront'")`; `checkin $E9 "$(ticket $A1 | jget code)"`;
  `ticket $A1`; `dash $E9`; check `$(( $(date +%s) - S9 )) -lt 25` (otherwise restart the item); `cancel $E9 > /dev/null`;
  `SQL "select channel, status from tickets where event_id='$E9' order by channel, status"`; `dash $E9`; `waitsince $S9 45`;
  `ticket $A2`; `dash $E9`.
- **Expected**: check-in `Entrada liberada`; `ticket $A1` shows `"checkedIn":true`; before the cancel, `dash` prints
  `confirmed=2 pending=1 checkIns=1 availableSeats=1 revenue=R$ 20,00 refunded=0`. After the cancel, the query shows
  `partner|cancelled`, `partner|refunded`, `storefront|refunded` and `dash` prints
  `confirmed=0 pending=0 checkIns=0 availableSeats=0 revenue=R$ 0,00 refunded=2`. After 45 s, `A2` is still `cancelled` and `dash`
  is unchanged.

### F07-C10 — Purchases racing a cancellation never survive it (F07-AC2, R07, R11)

- **Steps**: `npm run gates`; read `tests/cancellation.test.ts` › "purchases racing a cancellation leave no active ticket".
- **Expected**: the test passes. It fires ≥ 20 concurrent `purchaseTicket` calls together with `cancelEvent` on one event and
  asserts that afterwards no ticket of the event is `pending` or `confirmed`, and that every purchase either succeeded before the
  cancel (and is now `cancelled`) or got `event_not_available`.

### F07-C-GATES — Gates pass

- **Steps**: `npm run gates` · **Expected**: exit 0, all PASS, including `tests/cancellation.test.ts`.

## Criteria mapping

| PRD criterion | Rules | Contract items |
|---|---|---|
| F07-AC1 | R11 | F07-C1, F07-C2 |
| F07-AC2 | R11 | F07-C3, F07-C10 |
| F07-AC3 | R08, R11 | F07-C4 |
| F07-AC4 | R02, R11 | F07-C5 |
| F07-AC5 | R05, R11 | F07-C6 |
| X-F02-F07-1 | R04, R11 | F07-C2 |
| X-F03-F07-1 | R08, R11 | F07-C4 |
| X-F04-F07-1 | R11 | F07-C7 |
| X-F04-F07-2 | R05, R10, R11, R12 | F07-C9 |
| X-F05-F07-1 | R10, R11 | F07-C8 |
| X-F06-F07-1 | R11, R12 | F07-C8 |
