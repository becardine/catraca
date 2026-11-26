import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "../src/db/pool.js";
import { runSeed } from "../src/db/seed.js";
import {
  createEvent,
  createEventsRegistry,
  EVENT_MESSAGES,
  getOnSaleEvent,
  getOwnedEvent,
  listOnSaleEvents,
  listOwnedEvents,
  parseEventForm,
  publishEvent,
  registerEventUpdateValidator,
  updateEvent,
} from "../src/events/index.js";
import { toLocalInput } from "../src/lib/format.js";
import { setupTestDb } from "./helpers/db.js";

const NOW = new Date("2026-11-26T12:00:00-03:00");
const inDays = (days: number) => toLocalInput(new Date(NOW.getTime() + days * 86_400_000));
const valid = () => ({
  name: "Show Teste",
  venue: "Bar",
  startsAt: inDays(30),
  capacity: "2",
  price: "100,00",
});

describe("parseEventForm (R01)", () => {
  it("accepts a valid event and converts the price to cents", () => {
    const r = parseEventForm(valid(), NOW);
    expect(r.ok && r.value.priceCents).toBe(10000);
    expect(r.ok && r.value.capacity).toBe(2);
  });

  it("rejects each invalid field with its message, in order", () => {
    const cases: [Record<string, string | undefined>, string][] = [
      [{ name: "" }, EVENT_MESSAGES.nameRequired],
      [{ venue: " " }, EVENT_MESSAGES.venueRequired],
      [{ startsAt: undefined }, EVENT_MESSAGES.startsAtInvalid],
      [{ startsAt: "amanhã" }, EVENT_MESSAGES.startsAtInvalid],
      [{ capacity: "0" }, EVENT_MESSAGES.capacityInvalid],
      [{ capacity: "2.5" }, EVENT_MESSAGES.capacityInvalid],
      [{ capacity: "-1" }, EVENT_MESSAGES.capacityInvalid],
      [{ price: "0" }, EVENT_MESSAGES.priceNotPositive],
      [{ price: "-5" }, EVENT_MESSAGES.priceNotPositive],
      [{ price: "abc" }, EVENT_MESSAGES.priceInvalid],
      [{ startsAt: inDays(-1) }, EVENT_MESSAGES.startsAtPast],
    ];
    for (const [override, message] of cases) {
      const body: Record<string, unknown> = { ...valid(), ...override };
      for (const [k, v] of Object.entries(override)) if (v === undefined) delete body[k];
      const r = parseEventForm(body, NOW);
      expect(r.ok ? "ok" : r.error, JSON.stringify(override)).toBe(message);
    }
  });

  it("future boundary: starts_at <= now is rejected, now + 1 min is accepted", () => {
    const exactlyNow = toLocalInput(NOW);
    const oneMinuteLater = toLocalInput(new Date(NOW.getTime() + 60_000));
    const atNow = parseEventForm({ ...valid(), startsAt: exactlyNow }, NOW);
    expect(atNow.ok ? "ok" : atNow.error).toBe(EVENT_MESSAGES.startsAtPast);
    expect(parseEventForm({ ...valid(), startsAt: oneMinuteLater }, NOW).ok).toBe(true);
  });
});

describe("events domain", () => {
  let pool: Pool;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    pool = await setupTestDb();
    await runSeed(pool);
    const { rows } = await pool.query<{ email: string; id: string }>(
      "SELECT email, id FROM users WHERE role = 'organizer'",
    );
    orgA = rows.find((r) => r.email === "org.a@catraca.test")?.id ?? "";
    orgB = rows.find((r) => r.email === "org.b@catraca.test")?.id ?? "";
  });
  afterAll(async () => {
    await pool.end();
  });

  async function newEvent() {
    const r = await createEvent(pool, orgA, valid(), NOW);
    if (!r.ok) throw new Error(r.error);
    return r.event;
  }

  it("creates drafts that are not on sale until published (R02)", async () => {
    const event = await newEvent();
    expect(event.status).toBe("draft");
    expect(await getOnSaleEvent(pool, event.id)).toBeNull();
    expect((await listOnSaleEvents(pool)).some((e) => e.id === event.id)).toBe(false);

    expect(await publishEvent(pool, orgA, event.id)).toEqual({ ok: true });
    expect((await getOnSaleEvent(pool, event.id))?.status).toBe("published");
    expect(await publishEvent(pool, orgA, event.id)).toEqual({ ok: false, error: "not_draft" });
  });

  it("hides other organizers' events everywhere (R13)", async () => {
    const event = await newEvent();
    expect(await getOwnedEvent(pool, orgB, event.id)).toBeNull();
    expect((await listOwnedEvents(pool, orgB)).some((e) => e.id === event.id)).toBe(false);
    expect(await publishEvent(pool, orgB, event.id)).toEqual({ ok: false, error: "not_found" });
    const reg = createEventsRegistry();
    const upd = await updateEvent(pool, reg, orgB, event.id, { ...valid(), name: "Hacked" }, NOW);
    expect(upd).toEqual({ ok: false, error: "not_found" });
    expect((await getOwnedEvent(pool, orgA, event.id))?.name).toBe("Show Teste");
  });

  it("future boundary on edit too (R01)", async () => {
    const event = await newEvent();
    const reg = createEventsRegistry();
    const atNow = await updateEvent(
      pool,
      reg,
      orgA,
      event.id,
      { ...valid(), startsAt: toLocalInput(NOW) },
      NOW,
    );
    expect(atNow).toMatchObject({ ok: false, message: EVENT_MESSAGES.startsAtPast });
    const later = await updateEvent(
      pool,
      reg,
      orgA,
      event.id,
      { ...valid(), startsAt: toLocalInput(new Date(NOW.getTime() + 60_000)) },
      NOW,
    );
    expect(later.ok).toBe(true);
  });

  it("runs update validators inside the row lock and honours their rejection", async () => {
    const event = await newEvent();
    const reg = createEventsRegistry();
    let sawLock = false;
    registerEventUpdateValidator(reg, async (client, current, next) => {
      // The row is locked by this transaction: a NOWAIT lock from another connection must fail.
      const other = await pool.connect();
      try {
        await other.query("SET lock_timeout = '100ms'");
        await other.query("SELECT 1 FROM events WHERE id = $1 FOR UPDATE NOWAIT", [current.id]);
      } catch {
        sawLock = true;
      } finally {
        other.release();
      }
      expect(client).toBeDefined();
      return next.capacity < current.capacity ? "capacity too low" : null;
    });
    const rejected = await updateEvent(
      pool,
      reg,
      orgA,
      event.id,
      { ...valid(), capacity: "1" },
      NOW,
    );
    expect(rejected).toMatchObject({ ok: false, message: "capacity too low" });
    expect(sawLock).toBe(true);
    const accepted = await updateEvent(
      pool,
      reg,
      orgA,
      event.id,
      { ...valid(), capacity: "5", price: "150" },
      NOW,
    );
    expect(accepted.ok && accepted.event.capacity).toBe(5);
    expect(accepted.ok && accepted.event.priceCents).toBe(15000);
  });

  it("refuses to edit or publish a cancelled event", async () => {
    const event = await newEvent();
    await pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [event.id]);
    const reg = createEventsRegistry();
    const upd = await updateEvent(pool, reg, orgA, event.id, valid(), NOW);
    expect(upd).toMatchObject({ ok: false, message: EVENT_MESSAGES.cancelledNotEditable });
    expect(await publishEvent(pool, orgA, event.id)).toEqual({ ok: false, error: "not_draft" });
    expect(await getOnSaleEvent(pool, event.id)).toBeNull();
  });
});
