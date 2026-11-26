# Plan — F03 Ticket purchase and simulated gateway

Spec: `./spec.md` · Contract: `./contract.md`

## Steps

1. **Schema**: `migrations/004_tickets.sql` (tickets, payment_jobs).
2. **Seats and tickets**: `src/tickets/seats.ts`, `src/tickets/tickets.ts` (records, labels, lookups).
3. **Gateway**: `src/gateway/gateway.ts` (`gatewayDecision(card, scale, random)`, `applyGatewayResult`,
   `processDueJobs`), `src/gateway/worker.ts`; `tests/gateway.test.ts` (outcome table, delay ranges with
   scale 1, pending-only, worker resolves jobs, a new worker resumes jobs left by a stopped one).
4. **Purchase**: `src/tickets/purchase.ts`; `tests/purchase.test.ts` (error order, snapshot, codes,
   pending occupies, decline frees, 30×5 burst on 5 fresh events).
5. **Capacity validator + UI**: `src/tickets/index.ts` registers the validator, the event page section,
   `POST /events/:id/purchase` and `/my-tickets`; `tests/purchase-http.test.ts` covers the UI items and the
   cross-feature criteria.
6. **Boot**: `src/main.ts` starts the worker after `listen` and stops it on shutdown.

## Integration notes

- `src/app.ts`: one `registerTickets(app, deps)` line after `registerEvents`.
- F04 must call `purchaseTicket` with `channel: "partner"` and `buyerUserId: null`.
- F05/F06/F07 read `tickets` and `seatStats`; F07 relies on `applyGatewayResult` being pending-only.
