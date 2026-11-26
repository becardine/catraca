# Spec — F02 Event management and storefront listing

- **Feature ID**: F02
- **Wave**: 2
- **PRD criteria covered**: F02-AC1 … F02-AC6
- **Cross-feature criteria assigned here**: X-F01-F02-1
- **Rules**: R01, R02, R03, R04, R13

## Goal

Organizers create, edit and publish their own events, each with its own management page. Visitors see
published events on the storefront. The management page and the event page are composed of **sections**,
so later features (F03, F05, F06, F07) plug in without editing F02 files.

## Provides (to other features)

| Item | Kind | Signature / shape |
|---|---|---|
| `events` table | migration `003_events.sql` | `id`, `organizer_id`, `name`, `venue`, `starts_at`, `capacity`, `price_cents`, `status` (`draft`/`published`/`cancelled`), `created_at`, `updated_at` |
| `EventRecord` | type (`src/events/events.ts`) | `{ id, organizerId, name, venue, startsAt: Date, capacity, priceCents, status }` |
| `getOwnedEvent(pool, organizerId, eventId)` | function | `EventRecord \| null`. `null` for unknown ids **and** for other organizers' events (R13) |
| `listOwnedEvents(pool, organizerId)` | function | own events, by `starts_at` |
| `listOnSaleEvents(pool)` / `getOnSaleEvent(pool, id)` | functions | published events only (cancelled and draft excluded) |
| `createEvent`, `updateEvent`, `publishEvent` | functions | see "Domain" below |
| `registerEventUpdateValidator(registry, fn)` | hook | `fn(client, current, next)` runs inside `updateEvent`'s transaction **after** `SELECT … FOR UPDATE` on the event row; returns an error message or `null`. F03 uses it for "capacity ≥ occupied". |
| `ManagementSection` registry | `src/events/sections.ts` | `{ id, order, render(ctx) }`, rendered on `/organizer/events/:id` after the edit form. `ctx = { event, request, pool }` |
| `EventPageSection` registry | `src/events/sections.ts` | same shape, rendered on the public `/events/:id` (F03 adds the purchase form) |
| `formatCents`, `formatDateTime`, `parseMoney`, `parseLocalDateTime`, `toLocalInput` | `src/lib/format.ts` | `R$ 1.234,56` (regular space), `05/12/2026 21:00` in `America/Sao_Paulo` |
| Pages | routes | `/`, `/events/:id`, `/organizer/events`, `/organizer/events/new`, `/organizer/events/:id` |

All registries live in one `EventsRegistry` object created in `buildApp` and passed to each feature's
`register…(app, deps)` function (no module-level global state, so tests can build several apps).

## Consumes (from other features)

| Item | From | How it is used |
|---|---|---|
| `registerOrganizerRoutes`, `request.user` | F01 | all organizer routes; `request.user.id` is the only owner id |
| `renderPage`, `sendPage`, `html` | F01 | pages |

## Data model

```sql
CREATE TABLE events (
  id            text PRIMARY KEY,
  organizer_id  text NOT NULL REFERENCES users(id),
  name          text NOT NULL CHECK (length(trim(name)) > 0),
  venue         text NOT NULL CHECK (length(trim(venue)) > 0),
  starts_at     timestamptz NOT NULL,
  capacity      integer NOT NULL CHECK (capacity >= 1),
  price_cents   integer NOT NULL CHECK (price_cents > 0),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_organizer_idx ON events (organizer_id);
CREATE INDEX events_status_idx ON events (status);
```

## Domain

- `parseEventForm(body)` → `{ ok, value } | { ok: false, error }`, checked in this order with these messages:
  - name empty → `Informe o nome do evento.`
  - venue empty → `Informe o local do evento.`
  - start missing or not `YYYY-MM-DDTHH:MM` → `Informe a data e a hora de início.`
  - capacity not an integer ≥ 1 → `A lotação deve ser um número inteiro maior ou igual a 1.`
  - price unparseable → `Informe um preço válido.`; price ≤ 0 → `O preço deve ser maior que zero.`
- Future check (R01), on create and edit: `starts_at <= now` → `A data de início precisa estar no futuro.`
  `now` is a parameter (default `new Date()`) so tests control the clock.
- `createEvent(pool, organizerId, form, now)` → status `draft` (R02).
- `updateEvent(pool, registry, organizerId, eventId, form, now)`: in one transaction, `SELECT … FOR UPDATE`
  the row filtered by owner (missing → `not_found`), reject a `cancelled` event (`Evento cancelado não pode ser editado.`),
  validate, run every update validator, then `UPDATE`. Price changes only touch `events.price_cents`; tickets
  (F03) store their own price, so R03's "only later purchases" is satisfied by F03.
- `publishEvent(pool, organizerId, eventId)`: `UPDATE … SET status='published' WHERE id=$1 AND organizer_id=$2 AND status='draft'`.
  Not found/not owner → `not_found`; not a draft → `not_draft`.
- Money: `parseMoney` accepts `100`, `100,5`, `100,00`, `100.00`, `1.234,56` → cents.
- Time: `datetime-local` values are read as `America/Sao_Paulo` (fixed `-03:00`, no DST since 2019).

## Routes / pages

| Method | Path | Who | Behavior |
|---|---|---|---|
| GET | `/` | anyone | storefront: on-sale events with name, date, venue, price, link to `/events/:id` |
| GET | `/events/:id` | anyone | on-sale event page + event-page sections; draft/cancelled/unknown → 404 |
| GET | `/organizer/events` | organizer | own events (name, date, status label Rascunho/Publicado/Cancelado), link "Criar evento" |
| GET | `/organizer/events/new` | organizer | create form |
| POST | `/organizer/events` | organizer | create → `303 /organizer/events/:id`; invalid → `422` form + message |
| GET | `/organizer/events/:id` | owner | management page: details, status, edit form (not when cancelled), "Publicar" (draft only), sections; non-owner → `404` page with no event data |
| POST | `/organizer/events/:id` | owner | edit → `303` back with `Evento atualizado.`; invalid → `422` page + message; non-owner → `404` |
| POST | `/organizer/events/:id/publish` | owner | draft → published, `303` back with `Evento publicado.`; not a draft → `409`; non-owner → `404` |

## Technical decisions

- **Ownership in the query** (`WHERE id = $1 AND organizer_id = $2`) for every read and write, and the
  same 404 for "does not exist" and "not yours". *Rejected*: 403 for other organizers, which reveals that
  the event exists (R13 says no data).
- **Row lock in `updateEvent`** so F03's capacity validator and concurrent purchases serialize on the same
  row (AGENTS.md rule 1).
- **Section registries** instead of editing one big template, to keep the parallel wave (F05, F06) free of
  conflicts on the management page.
- **Fixed `-03:00` offset**: Brazil has had no DST since 2019; the brief allows any time zone.
- Notices are passed as a query string (`?notice=updated`), mapped to fixed texts, so no user input is reflected.

## Edge cases and invariants

- Editing with an unchanged past date is still rejected (R01 applies on edit).
- `publish` twice → second call `409`, status unchanged.
- The public event page never shows draft or cancelled events, even by direct URL.
- `cancelled` is in the schema, but only F07 sets it. F02 already blocks editing and publishing a cancelled event.

## Out of scope

Deleting events, images, categories, pagination, and cancellation itself (F07).
