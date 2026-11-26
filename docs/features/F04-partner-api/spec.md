# Spec — F04 Partner API

- **Feature ID**: F04 · **Wave**: 4 (parallel with F05, F06)
- **PRD criteria covered**: F04-AC1 … F04-AC7
- **Cross-feature criteria assigned here**: X-F02-F04-1, X-F03-F04-1, X-F03-F04-2
- **Rules**: R02, R05, R06, R07, R08, R09

## Goal

The three partner routes exactly as fixed in `docs/brief.md`, on top of F02's listing and F03's single
purchase path. API purchases count like storefront ones because they *are* the same purchase.

## Provides

| Item | Shape |
|---|---|
| `GET /api/partner/events` | `200 [{ id, name, startsAt, priceCents, availableSeats }]`, only published events; `startsAt` ISO 8601 with `-03:00` |
| `POST /api/partner/events/:eventId/purchases` | `202 { ticketId, code, status: "pending" }` |
| `GET /api/partner/tickets/:ticketId` | `200 { ticketId, code, eventId, status, checkedIn }` |
| `requirePartnerKey` | `onRequest` hook for the `/api/partner` scope |

## Consumes

| Item | From |
|---|---|
| `listOnSaleEvents`, `getOnSaleEvent` | F02 |
| `purchaseTicket` (`channel: "partner"`, `buyerUserId: null`), `seatStats`, `getTicket` | F03 |
| `config.partnerApiKey`, `config.gatewayDelayScale` | harness |

## Behavior

- **Auth first** (every route under `/api/partner`, including unknown paths): missing or wrong `X-Api-Key`
  gives `401 {"error":"unauthorized"}`. The key is compared in constant time (`timingSafeEqual`).
- **Purchase error order**, after the key:
  1. `422 {"error":"invalid_request"}` for: a body that is not a JSON object (including malformed JSON or another
     content type), `buyerEmail` missing or not matching `^[^\s@]+@[^\s@]+\.[^\s@]+$`, or `cardNumber` missing or not
     a string of exactly 16 digits.
  2. `404 {"error":"event_not_available"}`: unknown, draft or cancelled event (from `purchaseTicket`).
  3. `409 {"error":"sold_out"}` (from `purchaseTicket`, under the event row lock).
- Malformed JSON would normally give a Fastify `400`. The scope's error handler maps body-parsing errors to
  the `422 invalid_request` above.
- `checkedIn` is `checked_in_at IS NOT NULL`. Tickets from any channel are readable.
- API tickets store `buyer_email` and no `buyer_user_id`, so they never appear in "Meus ingressos" (F04-AC7).
- Unknown `/api/partner/*` route with a valid key → `404 {"error":"not_found"}`.

## Technical decisions

- One Fastify plugin scope with prefix `/api/partner`, an `onRequest` key hook, and its own error and 404 handlers.
  *Rejected*: per-route checks, because a new route could forget the key.
- Validation by hand (four fields). *Rejected*: Fastify JSON schema, because its default error format is a 400
  and the contract requires exact bodies.
- `availableSeats` comes from F03 `seatStats` (AGENTS.md rule 4). The API does not recompute seats.

## Out of scope

Rate limiting, multiple partner keys, pagination, idempotency keys.
