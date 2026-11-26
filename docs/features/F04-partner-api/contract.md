# Contract — F04 Partner API

## Prerequisites

- Commit under evaluation checked out. Environment: the default `GATEWAY_DELAY_SCALE=1` and `PARTNER_API_KEY`
  (do not set either). If several stacks run in parallel, **export** the worktree variables before every command of
  this contract (AGENTS.md "Parallel worktrees"), e.g.
  `export COMPOSE_PROJECT_NAME=catraca-f04 APP_PORT=3004 GATES_PROJECT=catraca-gates-f04 GATES_DB_PORT=55434`;
  then `npm run down -- --reset && npm run up`.
- Shell: bash (Git Bash on Windows). `WEB=http://localhost:${APP_PORT:-3000}`, `API=$WEB`, `KEY=catraca-partner-dev-key`
  (the default `PARTNER_API_KEY`, documented in the README). `SQL() { docker compose exec -T db psql -U catraca -tAc "$1"; }`
  (uses the exported `COMPOSE_PROJECT_NAME`). JSON is inspected with `node -e`.
- Helpers:
  ```sh
  login() { curl -s -o /dev/null -c "$1" -X POST "$WEB/login" --data-urlencode "email=$2" --data-urlencode password=catraca123; }
  login jarA org.a@catraca.test; login jarP participante@catraca.test
  NEXT=$(date -d "+1 month" +%Y-%m-%dT20:00)
  mkdraft() { curl -s -i -b jarA -X POST "$WEB/organizer/events" --data-urlencode "name=$1" --data-urlencode "venue=Bar" \
    --data-urlencode "startsAt=$NEXT" --data-urlencode "capacity=$2" --data-urlencode "price=$3" | grep -io 'evt_[a-z0-9]*' | head -1; }
  publish() { curl -s -o /dev/null -b jarA -X POST "$WEB/organizer/events/$1/publish"; }
  mkevent() { id=$(mkdraft "$@"); publish "$id"; echo "$id"; }
  # post <event> <raw body> [content-type] -> prints the response body, a space, then the HTTP status
  post() { curl -s -w " %{http_code}" -X POST "$API/api/partner/events/$1/purchases" -H "X-Api-Key: $KEY" \
    -H "Content-Type: ${3:-application/json}" --data-binary "$2"; }
  body() { echo "{\"buyerEmail\":\"${2:-p@example.com}\",\"cardNumber\":\"$1\"}"; }   # body <card> [email]
  tid() { node -e 'const s=require("fs").readFileSync(0,"utf8");console.log(JSON.parse(s.slice(0,s.lastIndexOf(" "))).ticketId)'; }
  ```

## Items

### F04-C1 — Key required on every route, before anything else (F04-AC5)

- **Steps**: `E1=$(mkevent "F04 C1" 5 "10,00")`; `T1=$(post $E1 "$(body 4000000000000001)" | tid)`. For each request
  (a) `GET /api/partner/events`, (b) `POST /api/partner/events/$E1/purchases` with `$(body 4000000000000001)`,
  (c) `GET /api/partner/tickets/$T1`, (d) `GET /api/partner/unknown`, send it without `X-Api-Key` and with `X-Api-Key: wrong`.
  Also send, without a key, `POST …/purchases` with body `{}` and with the raw text `not json`.
- **Expected**: every response is `401` with body exactly `{"error":"unauthorized"}`. With the valid key, (d) answers `404`
  `{"error":"not_found"}`.

### F04-C2 — Listing: only published events, exact fields (F04-AC1, R02, R05)

- **Steps**: `D2=$(mkdraft "F04 draft" 3 "10,00")`; `E2=$(mkevent "F04 C2" 3 "100,00")`; `X2=$(mkevent "F04 cancelled" 3 "10,00")`;
  `SQL "update events set status='cancelled' where id='$X2'"`; `post $E2 "$(body 4000000000000003)"`;
  `curl -s -w " %{http_code}" -H "X-Api-Key: $KEY" "$API/api/partner/events"`.
- **Expected**: `200`, a JSON array; `D2` and `X2` are absent; the item for `E2` has **exactly** the keys
  `id, name, startsAt, priceCents, availableSeats` with `name="F04 C2"`, `priceCents=10000`, `availableSeats=2`
  (one pending ticket occupies a seat) and `startsAt` matching `^\d{4}-\d{2}-\d{2}T20:00:00-03:00$`.

### F04-C3 — Purchase answers 202 pending without waiting (F04-AC2, R06)

- **Steps**: `E3=$(mkevent "F04 C3" 5 "10,00")`;
  `R3=$(curl -s -w " %{http_code} %{time_total}" -X POST "$API/api/partner/events/$E3/purchases" -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d "$(body 4000000000000003 t@example.com)")`;
  `echo "$R3"`; `T3=` the `ticketId` from `R3`; immediately `curl -s -H "X-Api-Key: $KEY" "$API/api/partner/tickets/$T3"`.
- **Expected**: `202` with `time_total < 1.0`; body has exactly the keys `ticketId` (string), `code` (8 characters) and
  `status` = `"pending"`; the immediate lookup shows `"status":"pending"`.

### F04-C4 — Error order 422 → 404 → 409 (F04-AC3, R07)

- **Steps**: `E4=$(mkevent "F04 C4" 1 "10,00")`; `D4=$(mkdraft "F04 C4 draft" 1 "10,00")`; `X4=$(mkevent "F04 C4 cancelled" 1 "10,00")`;
  `SQL "update events set status='cancelled' where id='$X4'"`.
  1. on `E4`, each of: `{"cardNumber":"4000000000000001"}`, `{"buyerEmail":"x@example.com"}`, `$(body 4000000000000001 not-an-email)`,
     `$(body 123)`, `$(body abcdefghijklmnop)`, `{"buyerEmail":"x@example.com","cardNumber":4000000000000001}`, `[]`, `"text"`,
     raw `not json`, and `$(body 4000000000000001)` sent with content type `text/plain`;
  2. on `D4`: `$(body 123)` then `$(body 4000000000000001)`; on `X4`: `$(body 123)` then `$(body 4000000000000001)`;
     on `evt_doesnotexist`: `$(body 4000000000000001)`;
  3. on `E4`: `$(body 4000000000000001)` (takes the only seat), then `$(body 4000000000000001)`, then `$(body 123)`.
- **Expected**: (1) all `422` `{"error":"invalid_request"}`; (2) `D4`: `422` then `404` `{"error":"event_not_available"}`;
  `X4`: `422` then `404` `{"error":"event_not_available"}`; unknown: `404` `{"error":"event_not_available"}`;
  (3) `202`, then `409` `{"error":"sold_out"}`, then `422` `{"error":"invalid_request"}`.
  `SQL "select count(*) from tickets where event_id in ('$E4','$D4','$X4')"` returns `1`.

### F04-C5 — Ticket lookup (F04-AC4)

- **Steps**: with `T3`/`E3` from C3: `curl -s -w " %{http_code}" -H "X-Api-Key: $KEY" "$API/api/partner/tickets/$T3"`;
  `SQL "select code, status from tickets where id='$T3'"`; then `SQL "update tickets set checked_in_at=now() where id='$T3'"`
  and look the ticket up again; finally `curl -s -w " %{http_code}" -H "X-Api-Key: $KEY" "$API/api/partner/tickets/tkt_doesnotexist"`.
- **Expected**: `200` with exactly the keys `ticketId, code, eventId, status, checkedIn`, where `ticketId=$T3`, `eventId=$E3`, `code`
  and `status` equal the SQL row, and `checkedIn=false`; after the SQL update, `checkedIn=true` and `status` is unchanged;
  the unknown id gives `404` with body exactly `{"error":"ticket_not_found"}`.

### F04-C6 — 30 concurrent purchases, twice (F04-AC6, R07)

- **Steps**: for `i` in 1 2, on a fresh `E6=$(mkevent "F04 burst $i" 5 "10,00")`, run the brief's command:
  ```sh
  seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/api/partner/events/$E6/purchases" \
    -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
    -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' | sort | uniq -c
  ```
- **Expected**: each round prints exactly `5 202` and `25 409`.

### F04-C7 — API purchases are not linked to accounts (F04-AC7)

- **Steps**: `E7=$(mkevent "F04 C7" 5 "10,00")`; `post $E7 "$(body 4000000000000001 participante@catraca.test)"`;
  `SQL "select buyer_user_id is null, buyer_email, channel, code from tickets where event_id='$E7'"`; `curl -s -b jarP "$WEB/my-tickets"`.
- **Expected**: `t|participante@catraca.test|partner|<code>`; "Meus ingressos" contains neither `F04 C7` nor `<code>`.

### F04-C8 — X-F02-F04-1: draft hidden from the API until published in the UI (R02)

- **Steps**: `D8=$(mkdraft "F04 C8" 4 "25,50")`; list via the API; `publish $D8`; list again.
- **Expected**: absent before; present after, with `availableSeats=4` and `priceCents=2550`.

### F04-C9 — X-F03-F04-1: seats are shared with the storefront; gateway results reach the API (R05, R06, R08)

- **Steps**: `E9=$(mkevent "F04 C9" 1 "10,00")`; `T9=$(post $E9 "$(body 4000000000000004)" | tid)` and note the time; list via the API;
  `curl -s -b jarP "$WEB/events/$E9"`; poll `GET /api/partner/tickets/$T9` every second (up to 45 s) until not `pending`,
  recording the elapsed seconds; list again; `T9b=$(post $E9 "$(body 4000000000000001)" | tid)`; poll `T9b` every 0.5 s up to 6 s.
- **Expected**: while `T9` is pending, `availableSeats=0` and the storefront page shows `Ingressos esgotados`; `T9` becomes
  `declined` 30–40 s after its purchase and `availableSeats` goes back to `1`; `T9b` is `confirmed` within 5 s.

### F04-C10 — X-F03-F04-2: storefront tickets are readable through the API (R09)

- **Steps**: `E10=$(mkevent "F04 C10" 5 "10,00")`; `curl -s -o /dev/null -b jarP -X POST "$WEB/events/$E10/purchase" --data-urlencode cardNumber=4000000000000001`;
  `SQL "select id, code from tickets where event_id='$E10'"` → `T10`, `C10`; `sleep 6`; `curl -s -b jarP "$WEB/my-tickets"`;
  `curl -s -H "X-Api-Key: $KEY" "$API/api/partner/tickets/$T10"`.
- **Expected**: "Meus ingressos" shows `F04 C10` with `C10` and `confirmado`; the API returns `code=C10`, `eventId=$E10` and
  `status:"confirmed"`.

### F04-C-GATES — Gates pass

- **Steps**: `npm run gates` · **Expected**: exit 0, all PASS, including `tests/partner-api.test.ts`.

## Criteria mapping

| PRD criterion | Rules | Contract items |
|---|---|---|
| F04-AC1 | R02, R05 | F04-C2 |
| F04-AC2 | R06 | F04-C3 |
| F04-AC3 | R07 | F04-C4 |
| F04-AC4 | — | F04-C5 |
| F04-AC5 | — | F04-C1 |
| F04-AC6 | R07 | F04-C6 |
| F04-AC7 | — | F04-C7 |
| X-F02-F04-1 | R02 | F04-C8 |
| X-F03-F04-1 | R05, R06, R08 | F04-C9 |
| X-F03-F04-2 | R09 | F04-C10 |
