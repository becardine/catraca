# Contract — F03 Ticket purchase and simulated gateway

## Prerequisites

- Commit under evaluation checked out; `npm run down -- --reset && npm run up` succeeded (default
  `GATEWAY_DELAY_SCALE=1`, i.e. the brief's real timings).
- Shell: bash. On Windows: `"C:\Program Files\Git\bin\bash.exe" -lc 'cd /d/projects/mba/catraca && <commands>'`.
  `WEB=http://localhost:3000`. `SQL() { docker compose exec -T db psql -U catraca -tAc "$1"; }`.
- Cookie jars (signup logs the new account in, so `jarQ` needs no separate login):
  ```sh
  login() { curl -s -o /dev/null -c "$1" -X POST "$WEB/login" --data-urlencode "email=$2" --data-urlencode password=catraca123; }
  login jarA org.a@catraca.test; login jarB org.b@catraca.test; login jarP participante@catraca.test
  curl -s -o /dev/null -c jarQ -X POST "$WEB/signup" --data-urlencode name=Quarta \
    --data-urlencode "email=q-$(date +%s)@example.com" --data-urlencode password=segredo1
  ```
- Helper to create a **published** event as A and return its id (`NEXT=$(date -d "+1 month" +%Y-%m-%dT20:00)`):
  ```sh
  mkevent() { # $1=name $2=capacity $3=price
    id=$(curl -s -i -b jarA -X POST "$WEB/organizer/events" --data-urlencode "name=$1" --data-urlencode "venue=Bar" \
      --data-urlencode "startsAt=$NEXT" --data-urlencode "capacity=$2" --data-urlencode "price=$3" \
      | grep -io 'evt_[a-z0-9]*' | head -1)
    curl -s -o /dev/null -b jarA -X POST "$WEB/organizer/events/$id/publish"; echo "$id"; }
  buy() { # $1=jar $2=event $3=card ; prints "<http_code> <time_total>"
    curl -s -o /dev/null -w "%{http_code} %{time_total}\n" -b "$1" -X POST "$WEB/events/$2/purchase" --data-urlencode "cardNumber=$3"; }
  ```
- Gateway latency of a ticket = `extract(epoch from updated_at - created_at)` once its status is final.

## Items

### F03-C1 — Purchase answers immediately and the ticket starts pending (R06)

- **Steps**: `E=$(mkevent "F03 C1" 5 "100,00")`; `buy jarP $E 4000000000000003`; right away
  `curl -s -b jarP "$WEB/my-tickets"` and `SQL "select status from tickets where event_id='$E'"`.
- **Expected**: `303` in less than `1.0` s; "Meus ingressos" lists `F03 C1` with `pendente` and an 8-character
  code; the query returns `pending`.

### F03-C2 — Simulated gateway outcomes and timings (R08)

- **Steps**: `E=$(mkevent "F03 C2" 10 "10,00")`; buy once with each card `…0001`, `…0002`, `…0003`, `…0004`, `…0005`
  (as `jarP`); wait 45 s; then
  ```sh
  SQL "select j.card_last4, t.status, extract(epoch from t.updated_at - t.created_at) as s,
         case when j.card_last4 in ('0003','0004') then extract(epoch from t.updated_at - t.created_at) between 30 and 40
              else extract(epoch from t.updated_at - t.created_at) between 2 and 5 end as in_window
       from tickets t join payment_jobs j on j.ticket_id=t.id where t.event_id='$E' order by 1"
  ```
  and load "Meus ingressos".
- **Expected**: statuses `0001 confirmed`, `0002 declined`, `0003 confirmed`, `0004 declined`, `0005 declined`, and
  `in_window` is `t` on all five rows (unrounded latency; 2–5 s for 0001/0002/0005, 30–40 s for 0003/0004).
  "Meus ingressos" shows `confirmado` and `recusado` labels for them.

### F03-C3 — Card numbers that are not 16 digits are rejected before creating a ticket

- **Steps**: `E=$(mkevent "F03 C3" 5 "10,00")`; for each card in `400000000000001` (15 digits), `4000abcd00000001`
  and an empty value: `curl -s -i -b jarP -X POST "$WEB/events/$E/purchase" --data-urlencode "cardNumber=<card>"`
  (keep status line and body); then `SQL "select count(*) from tickets where event_id='$E'"`.
- **Expected**: three `422` (body contains `Informe um número de cartão com 16 dígitos.`); count `0`.

### F03-C4 — A pending ticket occupies the seat; a decline frees it (R05, R06, R08)

- **Steps**: `E=$(mkevent "F03 C4" 1 "10,00")`; `buy jarP $E 4000000000000004`; `curl -s -b jarQ "$WEB/events/$E"`;
  `buy jarQ $E 4000000000000001`; wait until the first ticket is `declined` (≤ 45 s); `curl -s -b jarQ "$WEB/events/$E"`.
- **Expected**: while pending, Q's event page shows `Ingressos esgotados` and no purchase form, and Q's purchase
  answers `409`. After the decline, the page shows the purchase form and `Vagas disponíveis: 1`.

### F03-C5 — Sold out is shown and enforced on the storefront (R07)

- **Steps**: `E=$(mkevent "F03 C5" 1 "10,00")`; `buy jarP $E 4000000000000001`; `curl -s -b jarQ "$WEB/events/$E"`;
  `curl -s -i -b jarQ -X POST "$WEB/events/$E/purchase" --data-urlencode cardNumber=4000000000000001`;
  `SQL "select count(*) from tickets where event_id='$E'"`.
- **Expected**: Q's page contains `Ingressos esgotados` and no `cardNumber` field; the stale-form POST answers `409`
  with `Ingressos esgotados`; count stays `1`.

### F03-C6 — No overselling under concurrent purchases (R07)

- **Steps**: twice, on fresh events `E=$(mkevent "F03 C6 $i" 5 "10,00")`:
  ```sh
  seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -b jarP -X POST "$WEB/events/$E/purchase" \
    --data-urlencode cardNumber=4000000000000001 | sort | uniq -c
  SQL "select count(*) from tickets where event_id='$E' and status in ('pending','confirmed')"
  ```
- **Expected**: each round prints exactly `5 303` and `25 409`; the query returns `5`.
  Automated proof (runs in F03-C-GATES; the evaluator also reads the test to confirm these assertions):
  `tests/purchase.test.ts` › "no overselling under 30 concurrent purchases" creates **5 fresh events with capacity 5**,
  fires **30 concurrent `purchaseTicket` calls** on each, and asserts per event exactly **5 `ok`**, **25 `sold_out`**,
  and `seatStats(...).occupied === 5 <= capacity`.

### F03-C7 — Unique codes; "Meus ingressos" shows only one's own tickets (R09)

- **Steps**: `SQL "select count(*), count(distinct code), bool_and(code ~ '^[2-9A-HJKMNP-TV-Z]{8}$') from tickets"`;
  `E=$(mkevent "F03 C7" 5 "10,00")`; `buy jarQ $E 4000000000000001`; compare `/my-tickets` of `jarP` and `jarQ`.
- **Expected**: both counts are equal and the last column is `t`. Q's page lists `F03 C7` with its status and code;
  P's page does not contain Q's code or `F03 C7`.

### F03-C8 — Price snapshot per ticket (R03) — also X-F02-F03-3

- **Steps**: `E=$(mkevent "F03 C8" 5 "100,00")`; `buy jarP $E 4000000000000001`; as A, edit `$E` keeping all fields but
  `price=150,00` (POST `/organizer/events/$E`, `startsAt=$NEXT`, `venue=Bar`, `capacity=5`); `buy jarP $E 4000000000000001`;
  `SQL "select price_cents_paid from tickets where event_id='$E' order by created_at"`.
- **Expected**: the edit answers `303`; the query returns `10000` then `15000`.

### F03-C9 — Gateway results only apply to pending tickets (R08, R11)

- **Steps**: `E=$(mkevent "F03 C9" 10 "10,00")`; buy 4 tickets with `…0003` (slow approve) and 4 with `…0004`
  (slow decline). Immediately, while all are pending, force one ticket of each card into each non-pending status:
  ```sh
  SQL "with r as (select t.id, j.card_last4, row_number() over (partition by j.card_last4 order by t.id) n
                  from tickets t join payment_jobs j on j.ticket_id=t.id where t.event_id='$E')
       update tickets t set status = (array['confirmed','declined','cancelled','refunded'])[r.n] from r where t.id=r.id"
  ```
  Wait 45 s; `SQL "select j.card_last4, t.status, j.processed_at is not null from tickets t join payment_jobs j on j.ticket_id=t.id where t.event_id='$E' order by 1,2"`.
- **Expected**: 8 rows, all jobs processed (`t`), and the statuses still `confirmed`, `declined`, `cancelled`, `refunded`
  for both `0003` and `0004` (no answer changed a non-pending ticket). Automated proof (F03-C-GATES):
  `tests/gateway.test.ts` › "applies results only to pending tickets" calls `applyGatewayResult` with approve **and**
  decline on tickets in each of `confirmed`, `declined`, `cancelled`, `refunded` and asserts no change (returns `false`).

### F03-C10 — Gateway jobs survive an app restart

- **Steps**: `E=$(mkevent "F03 C10" 5 "10,00")`; `buy jarP $E 4000000000000003`; `docker compose restart app`;
  wait 45 s after the purchase; `SQL "select status from tickets where event_id='$E'"`.
- **Expected**: `confirmed`.

### F03-C11 — X-F01-F03-1: only participants buy; each sees only their tickets

- **Steps**: `E=$(mkevent "F03 C11" 5 "10,00")`; as visitor `curl -s "$WEB/events/$E"` and
  `curl -s -i -X POST "$WEB/events/$E/purchase" --data-urlencode cardNumber=4000000000000001`; as A `curl -s -b jarA "$WEB/events/$E"`
  and the same POST with `jarA`; `SQL "select count(*) from tickets where event_id='$E'"`; then C7's P/Q comparison.
- **Expected**: the visitor's page has no `cardNumber` field and has a link to `/login`, and the visitor's POST answers `303`
  `Location: /login`; A's page shows `Organizadores não compram ingressos.` and no `cardNumber` field, and A's POST
  answers `403`; count `0`; P does not see Q's tickets (C7).

### F03-C12 — X-F02-F03-1: drafts cannot be bought (R02)

- **Steps**: create an event as A **without** publishing (same POST as `mkevent`, skip `/publish`) → `D`;
  `curl -s -i -b jarP -X POST "$WEB/events/$D/purchase" --data-urlencode cardNumber=4000000000000001`; count its tickets;
  publish `D`; buy again.
- **Expected**: `404` and count `0` before publishing; `303` and count `1` after.

### F03-C13 — X-F02-F03-2: capacity cannot go below occupied seats (R03, R05)

- **Steps**: `E=$(mkevent "F03 C13" 2 "10,00")`; `buy jarP $E 4000000000000001`; wait until that ticket is `confirmed`
  (≤ 6 s); `buy jarP $E 4000000000000003`; verify `SQL "select status, count(*) from tickets where event_id='$E' group by 1 order by 1"`
  returns `confirmed|1` and `pending|1`; as A POST edit with `capacity=1` (other fields valid); then with `capacity=3`;
  `buy jarQ $E 4000000000000001`.
- **Expected**: `capacity=1` → `422` with `A lotação não pode ser menor que as vagas ocupadas (2).` and capacity stays `2`;
  `capacity=3` → `303`; Q's purchase → `303`.

### F03-C-GATES — Gates pass

- **Steps**: `npm run gates`
- **Expected**: exit 0, all PASS, including `tests/purchase.test.ts`, `tests/gateway.test.ts` and `tests/purchase-http.test.ts`.

## Criteria mapping

| PRD criterion | Rules | Contract items |
|---|---|---|
| F03-AC1 | R06 | F03-C1 |
| F03-AC2 | R08 | F03-C2 |
| F03-AC3 | — | F03-C3 |
| F03-AC4 | R05, R06, R08 | F03-C4 |
| F03-AC5 | R07 | F03-C5 |
| F03-AC6 | R07 | F03-C6, F03-C-GATES |
| F03-AC7 | R09 | F03-C7 |
| F03-AC8 | R03 | F03-C8 |
| F03-AC9 | R08, R11 | F03-C9, F03-C-GATES |
| F03-AC10 | — | F03-C10 |
| X-F01-F03-1 | R09 | F03-C11, F03-C7 |
| X-F02-F03-1 | R02 | F03-C12 |
| X-F02-F03-2 | R03, R05 | F03-C13 |
| X-F02-F03-3 | R03 | F03-C8 |
