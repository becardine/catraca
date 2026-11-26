# Spec — F03 Ticket purchase and simulated gateway

- **Feature ID**: F03
- **Wave**: 3
- **PRD criteria covered**: F03-AC1 … F03-AC10
- **Cross-feature criteria assigned here**: X-F01-F03-1, X-F02-F03-1, X-F02-F03-2, X-F02-F03-3
- **Rules**: R02, R03, R05, R06, R07, R08, R09, R11 (gateway side)

## Goal

The core that every later feature reads: one purchase function for every channel, which never oversells,
a persisted simulated gateway whose late answers can never overwrite a final status, a price snapshot per
ticket, and the storefront purchase UI with "Meus ingressos".

## Provides (to other features)

| Item | Kind | Signature / shape |
|---|---|---|
| `tickets` table | migration `004_tickets.sql` | `id`, `event_id`, `buyer_user_id` (null for partner), `buyer_email`, `code` (unique), `status`, `price_cents_paid`, `channel` (`storefront`/`partner`), `checked_in_at`, `created_at`, `updated_at` |
| `payment_jobs` table | same migration | `ticket_id`, `approve`, `card_last4`, `due_at`, `processed_at` |
| `purchaseTicket(deps, { eventId, buyerUserId, buyerEmail, cardNumber, channel })` | `src/tickets/purchase.ts` | `{ ok: true, ticket } \| { ok: false, error: "invalid_card" \| "event_not_available" \| "sold_out" }`, checked in this order |
| `seatStats(db, eventId)` | `src/tickets/seats.ts` | `{ capacity, occupied, available }`, the **only** implementation of R05 (`db` = pool or transaction client) |
| `getTicket(pool, id)`, `findTicketByCode(pool, code)`, `listTicketsByUser(pool, userId)` | `src/tickets/tickets.ts` | `TicketRecord` |
| `TICKET_STATUS_LABELS` | `src/tickets/tickets.ts` | `pending→pendente`, `confirmed→confirmado`, `declined→recusado`, `cancelled→cancelado`, `refunded→estornado` |
| `applyGatewayResult(db, ticketId, approved)` | `src/gateway/gateway.ts` | pending-only update; returns `true` if the ticket changed |
| `startGatewayWorker(pool, { intervalMs })` | `src/gateway/worker.ts` | polls due jobs; returns `{ stop() }` |
| Capacity validator | registered via F02 `registerEventUpdateValidator` | rejects `capacity < occupied` inside the event row lock |
| UI | routes | purchase section on `/events/:id`, `POST /events/:id/purchase`, `GET /my-tickets` |

## Consumes (from other features)

| Item | From | How it is used |
|---|---|---|
| `requireParticipant`, `request.user`, `renderPage` | F01 | purchase and "Meus ingressos" are participant-only |
| `events` table, `EventsRegistry` (event page sections, update validators), `getOnSaleEvent` | F02 | event page purchase section; capacity rule (R03) |

## Data model

```sql
CREATE TABLE tickets (
  id                text PRIMARY KEY,
  event_id          text NOT NULL REFERENCES events(id),
  buyer_user_id     text REFERENCES users(id),
  buyer_email       text NOT NULL,
  code              text NOT NULL UNIQUE,
  status            text NOT NULL CHECK (status IN ('pending','confirmed','declined','cancelled','refunded')),
  price_cents_paid  integer NOT NULL CHECK (price_cents_paid > 0),
  channel           text NOT NULL CHECK (channel IN ('storefront','partner')),
  checked_in_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_event_status_idx ON tickets (event_id, status);
CREATE INDEX tickets_buyer_idx ON tickets (buyer_user_id);

CREATE TABLE payment_jobs (
  ticket_id     text PRIMARY KEY REFERENCES tickets(id),
  approve       boolean NOT NULL,
  card_last4    text NOT NULL,
  due_at        timestamptz NOT NULL,
  processed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_jobs_due_idx ON payment_jobs (due_at) WHERE processed_at IS NULL;
```

The full card number is never stored, only the last 4 digits and the simulated outcome.

## Domain

### Purchase (R05, R06, R07, R09, R03)

1. `cardNumber` must match `^\d{16}$`, otherwise `invalid_card` and nothing is written.
2. `BEGIN`; `SELECT … FROM events WHERE id = $1 FOR UPDATE`. A missing event, or one whose status is not
   `published`, gives `event_not_available`.
3. `occupied = count(tickets WHERE event_id AND status IN ('pending','confirmed'))`. If `occupied >= capacity`,
   the result is `sold_out`.
4. Insert the ticket as `pending` with `price_cents_paid = events.price_cents` (snapshot) and a code of
   8 characters from the `ids.ts` alphabet, uppercase (`INSERT … ON CONFLICT (code) DO NOTHING`, retried on collision).
5. Insert the payment job (`due_at = now() + delay`); `COMMIT`. The response never waits for the gateway.

Because every purchase of an event waits for the same row lock, step 3 always sees the committed
result of the previous purchase. That is what guarantees R07 under concurrency.

### Simulated gateway (R08)

| Card ending | Outcome | Delay (× `GATEWAY_DELAY_SCALE`) |
|---|---|---|
| `0001` | approve | uniform 2.0–4.5 s |
| `0002` | decline | uniform 2.0–4.5 s |
| `0003` | approve | uniform 30.5–39.0 s |
| `0004` | decline | uniform 30.5–39.0 s |
| other | decline | uniform 2.0–4.5 s |

The ranges sit inside the brief's 2–5 s / 30–40 s windows, leaving room for the worker tick (200 ms).

Worker loop (every 200 ms), in one transaction: pick due, unprocessed jobs with `FOR UPDATE SKIP LOCKED`
(so several app instances or ticks never double-process a job), mark them processed, then call
`applyGatewayResult`. That call runs:

```sql
UPDATE tickets SET status = CASE WHEN $2 THEN 'confirmed' ELSE 'declined' END, updated_at = now()
 WHERE id = $1 AND status = 'pending'
```

A result for a ticket that is no longer `pending` changes nothing. That covers F07: cancelled or refunded
tickets stay that way. Jobs are rows, so a restart resumes them.

### Capacity rule (R03 / R05)

The F02 update validator computes `seatStats` with the transaction client, after F02 has locked the event
row. If `next.capacity < occupied`, it rejects with
`A lotação não pode ser menor que as vagas ocupadas (N).`. Purchases take the same lock, so a purchase and
a capacity edit can never interleave.

## Routes / pages

| Method | Path | Who | Behavior |
|---|---|---|---|
| (section) | `/events/:id` | anyone | `available = 0` → `Ingressos esgotados` with no form. Visitor → link `Entre como participante para comprar` (`/login`). Organizer → `Organizadores não compram ingressos.` with no form. Participant → form with "Número do cartão" and button `Comprar ingresso`. Also shows `Vagas disponíveis: N`. |
| POST | `/events/:id/purchase` | participant (visitor → `303 /login`, organizer → `403`) | `invalid_card` → `422` with `Informe um número de cartão com 16 dígitos.`; `event_not_available` → `404`; `sold_out` → `409` with `Ingressos esgotados`; ok → `303 /my-tickets?notice=purchased` |
| GET | `/my-tickets` | participant | the participant's own tickets, newest first: event name, status label, code, price paid |

## Technical decisions

- **Pessimistic row lock on the event** (`SELECT … FOR UPDATE`). *Rejected*: a `SERIALIZABLE` transaction
  with retries (retry storms under a 30-request burst); a seats counter column (a second source of truth,
  AGENTS.md rule 4); a conditional `INSERT … SELECT WHERE count < capacity` without a lock (not safe under
  READ COMMITTED: two inserts can both see the old count).
- **Persisted jobs and a polling worker**. *Rejected*: `setTimeout` per purchase (lost on restart, no audit).
- **Pending-only conditional update** as the single place where gateway results land (AGENTS.md rule 2).
- **Simulated outcome decided at purchase time** and stored as the job, which models the gateway's future answer.
- Channels are equal: storefront and partner (F04) call the same `purchaseTicket` (AGENTS.md rule 5).

## Edge cases and invariants

- `occupied` never exceeds `capacity` (checked by a 30×5 burst on ≥ 5 events in the gates).
- A decline frees the seat immediately, since declined tickets are not counted.
- Purchases on draft or cancelled events are rejected, also by direct POST.
- One ticket per purchase; a participant can buy several times (separate purchases).

## Out of scope

Partner API (F04), check-in (F05), dashboard (F06), cancellation (F07), real gateway, refunds by participants.
