# Contract — F04 Partner API

## Prerequisites

- Commit under evaluation checked out; `npm run down -- --reset && npm run up` succeeded. If the evaluator runs in
  a worktree with its own stack (AGENTS.md "Parallel worktrees"), use that `APP_PORT` in `WEB`/`API`.
- Shell: bash (Git Bash on Windows). `WEB=http://localhost:3000`, `API=$WEB`, `KEY=catraca-partner-dev-key`.
  `SQL() { docker compose exec -T db psql -U catraca -tAc "$1"; }`. JSON is inspected with `node -e`.
- Organizer and participant jars and helpers (same as F03):
  ```sh
  login() { curl -s -o /dev/null -c "$1" -X POST "$WEB/login" --data-urlencode "email=$2" --data-urlencode password=catraca123; }
  login jarA org.a@catraca.test; login jarP participante@catraca.test
  NEXT=$(date -d "+1 month" +%Y-%m-%dT20:00)
  mkdraft() { curl -s -i -b jarA -X POST "$WEB/organizer/events" --data-urlencode "name=$1" --data-urlencode "venue=Bar" \
    --data-urlencode "startsAt=$NEXT" --data-urlencode "capacity=$2" --data-urlencode "price=$3" | grep -io 'evt_[a-z0-9]*' | head -1; }
  publish() { curl -s -o /dev/null -b jarA -X POST "$WEB/organizer/events/$1/publish"; }
  mkevent() { id=$(mkdraft "$@"); publish "$id"; echo "$id"; }
  apibuy() { # $1=event $2=card [$3=email] -> prints "<code> <body>"
    curl -s -w " %{http_code}" -X POST "$API/api/partner/events/$1/purchases" -H "X-Api-Key: $KEY" \
      -H "Content-Type: application/json" -d "{\"buyerEmail\":\"${3:-p@example.com}\",\"cardNumber\":\"$2\"}"; }
  ```

## Items

### F04-C1 — Key required on every route (F04-AC5)

- **Steps**: with `E=$(mkevent "F04 C1" 5 "10,00")` and `T` = a ticket id from `apibuy $E 4000000000000001`, call each of
  `GET /api/partner/events`, `POST /api/partner/events/$E/purchases` (valid JSON body), `GET /api/partner/tickets/$T`
  (a) without `X-Api-Key`, (b) with `X-Api-Key: wrong`. Also (c) `POST …/purchases` with body `{}` and no key.
- **Expected**: every response is `401` with body exactly `{"error":"unauthorized"}`, including (c), where the key check
  comes before validation.

### F04-C2 — Listing: only published events, exact fields (F04-AC1, R02, R05)

- **Steps**: `D=$(mkdraft "F04 draft" 3 "10,00")`; `E=$(mkevent "F04 C2" 3 "100,00")`; `C=$(mkevent "F04 cancelled" 3 "10,00")`;
  `SQL "update events set status='cancelled' where id='$C'"`; `apibuy $E 4000000000000003`;
  `curl -s -H "X-Api-Key: $KEY" "$API/api/partner/events"`.
- **Expected**: `200`, a JSON array; `D` and `C` are absent; the item for `E` has **exactly** the keys
  `id, name, startsAt, priceCents, availableSeats` with `name="F04 C2"`, `priceCents=10000`, `availableSeats=2`,
  and `startsAt` matching `^\d{4}-\d{2}-\d{2}T20:00:00-03:00$`.

### F04-C3 — Purchase answers 202 pending without waiting (F04-AC2, R06)

- **Steps**: `E=$(mkevent "F04 C3" 5 "10,00")`;
  `curl -s -w " %{http_code} %{time_total}" -X POST "$API/api/partner/events/$E/purchases" -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d '{"buyerEmail":"t@example.com","cardNumber":"4000000000000003"}'`;
  then immediately `GET /api/partner/tickets/<ticketId>`.
- **Expected**: `202` in under `1.0` s; body has exactly `ticketId` (string), `code` (8 characters) and `status:"pending"`;
  the immediate lookup shows `status:"pending"`.

### F04-C4 — Error order 422 → 404 → 409 (F04-AC3, R07)

- **Steps**: `E=$(mkevent "F04 C4" 1 "10,00")`; `D=$(mkdraft "F04 C4 draft" 1 "10,00")`. With the key and `Content-Type: application/json`:
  1. on `E`: bodies `{"cardNumber":"4000000000000001"}`, `{"buyerEmail":"x@example.com"}`, `{"buyerEmail":"not-an-email","cardNumber":"4000000000000001"}`,
     `{"buyerEmail":"x@example.com","cardNumber":"123"}`, `{"buyerEmail":"x@example.com","cardNumber":4000000000000001}`, and the raw text `not json`;
  2. on `D`: `{"buyerEmail":"x@example.com","cardNumber":"123"}` then a valid body; on `evt_doesnotexist`: a valid body;
  3. on `E`: a valid body (takes the only seat), then another valid body, then `{"buyerEmail":"x@example.com","cardNumber":"123"}`.
- **Expected**: (1) all `422` `{"error":"invalid_request"}`; (2) `422`, then `404` `{"error":"event_not_available"}`, then `404`
  `{"error":"event_not_available"}`; (3) `202`, then `409` `{"error":"sold_out"}`, then `422` `{"error":"invalid_request"}`.
  `SQL "select count(*) from tickets where event_id in ('$E','$D')"` is `1`.

### F04-C5 — Ticket lookup (F04-AC4)

- **Steps**: `T` from C3; `curl -s -w " %{http_code}" -H "X-Api-Key: $KEY" "$API/api/partner/tickets/$T"`; same for `tkt_doesnotexist`.
- **Expected**: `200` with exactly the keys `ticketId, code, eventId, status, checkedIn` (`checkedIn` is `false`, `eventId` is C3's event);
  unknown id gives `404` with body exactly `{"error":"ticket_not_found"}`.

### F04-C6 — 30 concurrent purchases, twice (F04-AC6, R07)

- **Steps**: twice, on a fresh `E=$(mkevent "F04 burst $i" 5 "10,00")`, run the brief's command:
  ```sh
  seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/api/partner/events/$E/purchases" \
    -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
    -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' | sort | uniq -c
  ```
- **Expected**: each round prints exactly `5 202` and `25 409`.

### F04-C7 — API purchases are not linked to accounts (F04-AC7)

- **Steps**: `E=$(mkevent "F04 C7" 5 "10,00")`; `apibuy $E 4000000000000001 participante@catraca.test`;
  `SQL "select buyer_user_id is null, buyer_email, channel from tickets where event_id='$E'"`; `curl -s -b jarP "$WEB/my-tickets"`.
- **Expected**: `t|participante@catraca.test|partner`; "Meus ingressos" does not contain `F04 C7` nor the ticket's code.

### F04-C8 — X-F02-F04-1: draft hidden from the API until published in the UI (R02)

- **Steps**: `D=$(mkdraft "F04 C8" 4 "25,50")`; list via the API; `publish $D`; list again.
- **Expected**: absent before; present after, with `availableSeats=4` and `priceCents=2550`.

### F04-C9 — X-F03-F04-1: API seats are shared with the storefront; gateway results reach the API (R05, R06, R08)

- **Steps**: `E=$(mkevent "F04 C9" 1 "10,00")`; `apibuy $E 4000000000000004` → `T2`; list via the API; `curl -s -b jarP "$WEB/events/$E"`;
  wait until `T2` is not `pending` (poll `GET /api/partner/tickets/$T2` every second, up to 45 s), recording the elapsed time;
  list again; `apibuy $E 4000000000000001` → `T3`; poll `T3` every 0.5 s up to 6 s.
- **Expected**: while `T2` is pending, `availableSeats=0` and the storefront page shows `Ingressos esgotados`; `T2` becomes
  `declined` after 30–40 s and `availableSeats` goes back to `1`; `T3` is `confirmed` within 5 s.

### F04-C10 — X-F03-F04-2: storefront tickets are readable through the API (R09)

- **Steps**: `E=$(mkevent "F04 C10" 5 "10,00")`; `curl -s -o /dev/null -b jarP -X POST "$WEB/events/$E/purchase" --data-urlencode cardNumber=4000000000000001`;
  `SQL "select id, code from tickets where event_id='$E'"`; wait 6 s; `curl -s -b jarP "$WEB/my-tickets"`; `GET /api/partner/tickets/<id>`.
- **Expected**: the API returns the same `code` shown in "Meus ingressos", `eventId=$E`, and `status:"confirmed"` matching the
  `confirmado` label.

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
