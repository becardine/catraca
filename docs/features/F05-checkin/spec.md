# Spec — F05 Check-in

- **Feature ID**: F05 · **Wave**: 4 (parallel with F04, F06)
- **PRD criteria covered**: F05-AC1 … F05-AC3
- **Cross-feature criteria assigned here**: X-F02-F05-1, X-F03-F05-1
- **Rules**: R04, R09, R10, R13

## Goal

On the management page, the owner types a ticket code and gets exactly one of the five R10 messages, decided
by the first true condition in the brief's order. A ticket is let in at most once, even under concurrency.

## Provides

| Item | Shape |
|---|---|
| `checkIn(pool, organizerId, eventId, code)` | `src/checkin/checkin.ts` → `{ result: CheckinResult } \| { error: "not_found" }` where `not_found` = event not owned / unknown |
| `CheckinResult` + `CHECKIN_MESSAGES` | `invalid` → `Ingresso inválido para este evento`, `cancelled` → `Evento cancelado`, `not_confirmed` → `Ingresso não confirmado`, `already_used` → `Ingresso já utilizado`, `admitted` → `Entrada liberada` |
| Management section `checkin` (order 20) | `<section id="checkin">` with a `code` field and button `Validar ingresso`; shows the last result's message |
| `POST /organizer/events/:id/checkin` | body `code`; owner only; `303` → `/organizer/events/:id?checkin=<result>#checkin`; non-owner → `404` page without event data |

## Consumes

| Item | From |
|---|---|
| `registerOrganizerRoutes`, `request.user` | F01 |
| `getOwnedEvent`, `registerManagementSection`, `EventsRegistry` | F02 |
| `tickets` (`event_id`, `code`, `status`, `checked_in_at`) | F03 |

## Behavior (R10, in this exact order)

Input: `code` trimmed and upper-cased. The event is loaded with `getOwnedEvent`; not owned → `not_found` (route 404).

1. No ticket with that code **in this event** (unknown, empty, or from another event) → `invalid`.
2. Event `status = 'cancelled'` → `cancelled`.
3. Ticket `status <> 'confirmed'` (pending, declined, cancelled, refunded) → `not_confirmed`.
4. `checked_in_at IS NOT NULL` → `already_used`.
5. Otherwise `admitted`, written atomically:
   `UPDATE tickets SET checked_in_at = now(), updated_at = now() WHERE id = $1 AND status = 'confirmed' AND checked_in_at IS NULL`.
   If 0 rows changed (a concurrent check-in won), the result is `already_used`.

The check-in field stays available on cancelled events, so the ordered list always applies (allowed by R10).

The section reads `?checkin=<result>` (one of the five keys; anything else is ignored) and shows the fixed
message in `<p class="checkin-result" role="status">`. No user input is reflected.

## Technical decisions

- Atomic conditional update for step 5. *Rejected*: read-then-write without a condition (two simultaneous
  check-ins would both be admitted).
- PRG (POST → 303 → GET) with a fixed result key. *Rejected*: re-rendering the management page from F05, which
  would duplicate F02's page code.
- Codes are matched within the event (`WHERE event_id = $1 AND code = $2`), so a code from another organizer's
  event is indistinguishable from an unknown one.

## Out of scope

Undoing a check-in, check-in by participants, QR codes, cancellation itself (F07).
