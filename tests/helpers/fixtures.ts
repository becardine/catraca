import type { Pool } from "../../src/db/pool.js";
import { createEvent, publishEvent } from "../../src/events/index.js";
import { centsToInput, toLocalInput } from "../../src/lib/format.js";
import { randomToken } from "../../src/lib/ids.js";

export async function userId(pool: Pool, email: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [
    email,
  ]);
  if (!rows[0]) throw new Error(`no user ${email}`);
  return rows[0].id;
}

/** Creates (and by default publishes) an event for the organizer, starting in 30 days. */
export async function makeEvent(
  pool: Pool,
  organizerId: string,
  { capacity = 5, priceCents = 1000, publish = true, name = `Evento ${randomToken(6)}` } = {},
) {
  const r = await createEvent(pool, organizerId, {
    name,
    venue: "Bar",
    startsAt: toLocalInput(new Date(Date.now() + 30 * 86_400_000)),
    capacity: String(capacity),
    price: centsToInput(priceCents),
  });
  if (!r.ok) throw new Error(r.error);
  if (publish) await publishEvent(pool, organizerId, r.event.id);
  return r.event;
}

/** Polls until fn returns a truthy value or the timeout expires. */
export async function waitFor<T>(fn: () => Promise<T>, timeoutMs = 3000, stepMs = 25): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value || Date.now() > end) return value;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

export const CARD = {
  approveFast: "4000000000000001",
  declineFast: "4000000000000002",
  approveSlow: "4000000000000003",
  declineSlow: "4000000000000004",
  other: "4000000000000005",
} as const;
