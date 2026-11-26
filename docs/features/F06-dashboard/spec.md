# Spec — F06 Event dashboard

- **Feature ID**: F06 · **Wave**: 4 (parallel with F04, F05)
- **PRD criteria covered**: F06-AC1 … F06-AC3
- **Cross-feature criteria assigned here**: X-F02-F06-1, X-F03-F06-1
- **Rules**: R03, R04, R05, R12, R13

## Goal

The management page shows six numbers computed from tickets every time it renders: no counters, no cache.

## Provides

| Item | Shape |
|---|---|
| `eventDashboard(db, eventId)` | `src/dashboard/dashboard.ts` → `{ confirmed, pending, checkIns, availableSeats, revenueCents, refunded }` |
| Management section `dashboard` (order 10, first section) | `<section id="dashboard"><h2>Painel</h2><dl>…</dl></section>` |

Markup of each number (stable for evaluators):

```html
<dt>Confirmados</dt><dd data-metric="confirmed">3</dd>
<dt>Pendentes</dt><dd data-metric="pending">0</dd>
<dt>Check-ins</dt><dd data-metric="checkIns">0</dd>
<dt>Vagas disponíveis</dt><dd data-metric="availableSeats">0</dd>
<dt>Receita</dt><dd data-metric="revenue">R$ 350,00</dd>
<dt>Estornados</dt><dd data-metric="refunded">0</dd>
```

## Consumes

| Item | From |
|---|---|
| management page, `registerManagementSection`, ownership via `getOwnedEvent` (the page is 404 for non-owners) | F02 |
| `tickets` (`status`, `price_cents_paid`, `checked_in_at`), `seatStats` | F03 |
| `formatCents` | F02 (`src/lib/format.ts`) |

## Definitions (R12)

One query over `tickets WHERE event_id = $1`:

| Number | Definition |
|---|---|
| Confirmados | `status = 'confirmed'` (checked in or not) |
| Pendentes | `status = 'pending'` |
| Check-ins | `status = 'confirmed' AND checked_in_at IS NOT NULL` |
| Vagas disponíveis | `seatStats(eventId).available` (R05; 0 when the event is cancelled) |
| Receita | `sum(price_cents_paid) WHERE status = 'confirmed'`, or 0 |
| Estornados | `status = 'refunded'` |

`declined` and `cancelled` tickets appear in no number. A refunded ticket counts only in Estornados.

## Technical decisions

- Aggregate with `count(*) FILTER (…)` in one query plus `seatStats`. *Rejected*: stored counters updated by each
  feature, the bug class that broke the first attempt (AGENTS.md rule 4).
- Revenue from the price snapshot (`price_cents_paid`), never `events.price_cents` (AGENTS.md rule 3).
- The section needs no ownership check of its own: F02 renders sections only for the owner.

## Out of scope

Charts, exports, real-time refresh (reload is enough), multi-event totals.
