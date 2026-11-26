import type { Pool } from "../db/pool.js";
import { parseLocalDateTime, parseMoney } from "../lib/format.js";
import { newId } from "../lib/ids.js";
import type { EventsRegistry } from "./sections.js";

export type EventStatus = "draft" | "published" | "cancelled";

export interface EventRecord {
  id: string;
  organizerId: string;
  name: string;
  venue: string;
  startsAt: Date;
  capacity: number;
  priceCents: number;
  status: EventStatus;
}

export interface EventInput {
  name: string;
  venue: string;
  startsAt: Date;
  capacity: number;
  priceCents: number;
}

export const EVENT_MESSAGES = {
  nameRequired: "Informe o nome do evento.",
  venueRequired: "Informe o local do evento.",
  startsAtInvalid: "Informe a data e a hora de início.",
  startsAtPast: "A data de início precisa estar no futuro.",
  capacityInvalid: "A lotação deve ser um número inteiro maior ou igual a 1.",
  priceInvalid: "Informe um preço válido.",
  priceNotPositive: "O preço deve ser maior que zero.",
  cancelledNotEditable: "Evento cancelado não pode ser editado.",
  notDraft: "Só é possível publicar um evento em rascunho.",
} as const;

export const STATUS_LABELS: Record<EventStatus, string> = {
  draft: "Rascunho",
  published: "Publicado",
  cancelled: "Cancelado",
};

type ParseResult = { ok: true; value: EventInput } | { ok: false; error: string };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Validates the event form (R01). `now` is injectable so tests control the clock. */
export function parseEventForm(body: Record<string, unknown>, now = new Date()): ParseResult {
  const name = str(body.name);
  const venue = str(body.venue);
  if (!name) return { ok: false, error: EVENT_MESSAGES.nameRequired };
  if (!venue) return { ok: false, error: EVENT_MESSAGES.venueRequired };

  const startsAt = parseLocalDateTime(body.startsAt);
  if (!startsAt) return { ok: false, error: EVENT_MESSAGES.startsAtInvalid };

  const capacityText = str(body.capacity);
  const capacity = /^\d+$/.test(capacityText) ? Number(capacityText) : Number.NaN;
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    return { ok: false, error: EVENT_MESSAGES.capacityInvalid };
  }

  const priceCents = parseMoney(body.price);
  if (priceCents === null) return { ok: false, error: EVENT_MESSAGES.priceInvalid };
  if (priceCents <= 0) return { ok: false, error: EVENT_MESSAGES.priceNotPositive };

  if (startsAt.getTime() <= now.getTime()) return { ok: false, error: EVENT_MESSAGES.startsAtPast };

  return { ok: true, value: { name, venue, startsAt, capacity, priceCents } };
}

interface EventRow {
  id: string;
  organizer_id: string;
  name: string;
  venue: string;
  starts_at: Date;
  capacity: number;
  price_cents: number;
  status: EventStatus;
}

const COLUMNS = "id, organizer_id, name, venue, starts_at, capacity, price_cents, status";

export function toEvent(row: EventRow): EventRecord {
  return {
    id: row.id,
    organizerId: row.organizer_id,
    name: row.name,
    venue: row.venue,
    startsAt: row.starts_at,
    capacity: row.capacity,
    priceCents: row.price_cents,
    status: row.status,
  };
}

export async function createEvent(
  pool: Pool,
  organizerId: string,
  body: Record<string, unknown>,
  now = new Date(),
): Promise<{ ok: true; event: EventRecord } | { ok: false; error: string }> {
  const parsed = parseEventForm(body, now);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const { rows } = await pool.query<EventRow>(
    `INSERT INTO events (id, organizer_id, name, venue, starts_at, capacity, price_cents, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft') RETURNING ${COLUMNS}`,
    [newId("evt"), organizerId, v.name, v.venue, v.startsAt, v.capacity, v.priceCents],
  );
  return { ok: true, event: toEvent(rows[0] as EventRow) };
}

/** Owner-scoped read: returns null for unknown ids and for other organizers' events (R13). */
export async function getOwnedEvent(
  pool: Pool,
  organizerId: string,
  eventId: string,
): Promise<EventRecord | null> {
  const { rows } = await pool.query<EventRow>(
    `SELECT ${COLUMNS} FROM events WHERE id = $1 AND organizer_id = $2`,
    [eventId, organizerId],
  );
  return rows[0] ? toEvent(rows[0]) : null;
}

export async function listOwnedEvents(pool: Pool, organizerId: string): Promise<EventRecord[]> {
  const { rows } = await pool.query<EventRow>(
    `SELECT ${COLUMNS} FROM events WHERE organizer_id = $1 ORDER BY starts_at, created_at`,
    [organizerId],
  );
  return rows.map(toEvent);
}

/** Published (therefore not draft and not cancelled) events, for the storefront and the partner API (R02). */
export async function listOnSaleEvents(pool: Pool): Promise<EventRecord[]> {
  const { rows } = await pool.query<EventRow>(
    `SELECT ${COLUMNS} FROM events WHERE status = 'published' ORDER BY starts_at, created_at`,
  );
  return rows.map(toEvent);
}

export async function getOnSaleEvent(pool: Pool, eventId: string): Promise<EventRecord | null> {
  const { rows } = await pool.query<EventRow>(
    `SELECT ${COLUMNS} FROM events WHERE id = $1 AND status = 'published'`,
    [eventId],
  );
  return rows[0] ? toEvent(rows[0]) : null;
}

export type UpdateResult =
  | { ok: true; event: EventRecord }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "invalid"; message: string };

/**
 * Edits an own event inside a transaction holding the event row lock, so registered validators
 * (e.g. F03's capacity ≥ occupied seats) see a consistent state (AGENTS.md rule 1).
 */
export async function updateEvent(
  pool: Pool,
  registry: EventsRegistry,
  organizerId: string,
  eventId: string,
  body: Record<string, unknown>,
  now = new Date(),
): Promise<UpdateResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<EventRow>(
      `SELECT ${COLUMNS} FROM events WHERE id = $1 AND organizer_id = $2 FOR UPDATE`,
      [eventId, organizerId],
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false, error: "not_found" };
    }
    const current = toEvent(rows[0]);
    const reject = async (message: string): Promise<UpdateResult> => {
      await client.query("ROLLBACK");
      return { ok: false, error: "invalid", message };
    };
    if (current.status === "cancelled") return reject(EVENT_MESSAGES.cancelledNotEditable);

    const parsed = parseEventForm(body, now);
    if (!parsed.ok) return reject(parsed.error);
    for (const validate of registry.updateValidators) {
      const message = await validate(client, current, parsed.value);
      if (message) return reject(message);
    }

    const v = parsed.value;
    const updated = await client.query<EventRow>(
      `UPDATE events SET name = $3, venue = $4, starts_at = $5, capacity = $6, price_cents = $7,
              updated_at = now()
        WHERE id = $1 AND organizer_id = $2 RETURNING ${COLUMNS}`,
      [eventId, organizerId, v.name, v.venue, v.startsAt, v.capacity, v.priceCents],
    );
    await client.query("COMMIT");
    return { ok: true, event: toEvent(updated.rows[0] as EventRow) };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export type PublishResult = { ok: true } | { ok: false; error: "not_found" | "not_draft" };

/** draft → published (R02). Only the owner; only drafts. */
export async function publishEvent(
  pool: Pool,
  organizerId: string,
  eventId: string,
): Promise<PublishResult> {
  const res = await pool.query(
    `UPDATE events SET status = 'published', updated_at = now()
      WHERE id = $1 AND organizer_id = $2 AND status = 'draft'`,
    [eventId, organizerId],
  );
  if (res.rowCount === 1) return { ok: true };
  const owned = await getOwnedEvent(pool, organizerId, eventId);
  return { ok: false, error: owned ? "not_draft" : "not_found" };
}
