# Spec — F07 Event cancellation

- **Feature ID**: F07 · **Wave**: 5 (last)
- **PRD criteria covered**: F07-AC1 … F07-AC5
- **Cross-feature criteria assigned here**: X-F02-F07-1, X-F03-F07-1, X-F04-F07-1, X-F04-F07-2, X-F05-F07-1, X-F06-F07-1
- **Rules**: R02, R04, R05, R08, R10, R11, R12

## Goal

The owner cancels a published event. This is irreversible, and it happens in one transaction: the event
becomes `cancelled`, confirmed tickets become `refunded` and pending ones `cancelled`. Every other feature
already reads that state correctly (F02 hides it and blocks edits, F03 refuses purchases and ignores late
gateway answers, F04 hides it, F05 answers `Evento cancelado`, F06 counts refunds). F07 proves all of that
end to end.

## Provides

| Item | Shape |
|---|---|
| `cancelEvent(pool, organizerId, eventId)` | `src/cancellation/cancel.ts` → `{ ok: true, refunded, cancelled } \| { ok: false, error: "not_found" \| "not_published" }` |
| Management section `cancellation` (order 30) | published: form `Cancelar evento` (with a warning that it is irreversible); cancelled: `Este evento foi cancelado. Não é possível editá-lo nem republicá-lo.`; draft: nothing |
| `POST /organizer/events/:id/cancel` | owner only; `303` → `/organizer/events/:id?notice=cancelled`; draft or already cancelled → `409` page; non-owner → `404` page without event data |

## Consumes

| Item | From | How it is used |
|---|---|---|
| `registerOrganizerRoutes`, `request.user` | F01 | the cancel route |
| `events.status`, `registerManagementSection`, `getOwnedEvent`, `NOTICES`, the cancelled-event guards in `updateEvent`/`publishEvent`, `listOnSaleEvents`/`getOnSaleEvent` (published only) | F02 | state change, page, irreversibility, storefront |
| `tickets`, `payment_jobs`, the pending-only `applyGatewayResult`, `seatStats` (0 when cancelled), `purchaseTicket` (published only) | F03 | refunds/cancellations, late answers, seats |
| partner listing / purchase / ticket lookup | F04 | behavior after cancel (verified) |
| `checkIn` rule 2 | F05 | `Evento cancelado` (verified) |
| `eventDashboard` | F06 | numbers after cancel (verified) |

## Domain

```sql
BEGIN;
SELECT status FROM events WHERE id = $1 AND organizer_id = $2 FOR UPDATE;   -- missing → not_found; ≠ published → not_published
UPDATE events SET status = 'cancelled', updated_at = now() WHERE id = $1;
UPDATE tickets
   SET status = CASE status WHEN 'confirmed' THEN 'refunded' ELSE 'cancelled' END, updated_at = now()
 WHERE event_id = $1 AND status IN ('confirmed', 'pending');
COMMIT;
```

- The statuses change in the same transaction as the event, so the 10 s bound (R11) holds with no background step.
- **Purchases racing the cancellation**: a purchase holds the same event row lock. If it commits first, its pending
  ticket is cancelled by the `UPDATE`. If the cancellation commits first, the purchase sees `cancelled` and returns
  `event_not_available`.
- **Gateway racing the cancellation**: both update the same ticket row, so they serialize. If the gateway commits
  first, `confirmed` becomes `refunded`, or `declined` stays `declined`. If the cancellation commits first, the gateway's
  `WHERE status = 'pending'` matches nothing (AGENTS.md rule 2). Postgres re-checks the `WHERE` on the locked row in
  both orders.
- Late answers: the job still runs and is marked processed; the ticket keeps `cancelled`.

## Technical decisions

- Synchronous cancellation in one transaction. *Rejected*: a background refund job, a second moving part that
  could miss the 10 s bound or leave a confirmed ticket on a cancelled event.
- `declined` tickets are left as they are (they never occupied a seat or produced revenue).
- No new table or column: `cancelled` already exists in F02's status check (no migration).

## Out of scope

Partial refunds, notifying buyers, undoing a cancellation, cancelling drafts (they can simply stay unpublished).
