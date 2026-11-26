import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "../src/db/pool.js";
import { runSeed } from "../src/db/seed.js";
import { applyGatewayResult } from "../src/gateway/gateway.js";
import { purchaseTicket, seatStats } from "../src/tickets/index.js";
import { setupTestDb } from "./helpers/db.js";
import { CARD, makeEvent, userId } from "./helpers/fixtures.js";

describe("purchaseTicket", () => {
  let pool: Pool;
  let orgA: string;
  let buyer: string;

  beforeAll(async () => {
    pool = await setupTestDb();
    await runSeed(pool);
    orgA = await userId(pool, "org.a@catraca.test");
    buyer = await userId(pool, "participante@catraca.test");
  });
  afterAll(async () => {
    await pool.end();
  });

  const buy = (eventId: string, cardNumber: unknown = CARD.approveSlow) =>
    purchaseTicket(pool, 1, {
      eventId,
      buyerUserId: buyer,
      buyerEmail: "participante@catraca.test",
      cardNumber,
      channel: "storefront",
    });
  const count = async (eventId: string) =>
    Number(
      (await pool.query("SELECT count(*) AS n FROM tickets WHERE event_id = $1", [eventId])).rows[0]
        .n,
    );

  it("checks errors in order: card, event availability, seats", async () => {
    const draft = await makeEvent(pool, orgA, { publish: false });
    expect(await buy(draft.id, "123")).toEqual({ ok: false, error: "invalid_card" });
    expect(await buy(draft.id)).toEqual({ ok: false, error: "event_not_available" });
    expect(await buy("evt_doesnotexist")).toEqual({ ok: false, error: "event_not_available" });

    const full = await makeEvent(pool, orgA, { capacity: 1 });
    expect((await buy(full.id)).ok).toBe(true);
    expect(await buy(full.id, "x")).toEqual({ ok: false, error: "invalid_card" });
    expect(await buy(full.id)).toEqual({ ok: false, error: "sold_out" });

    for (const card of ["400000000000001", "4000abcd00000001", "", null, 4000000000000001]) {
      expect(await buy(full.id, card)).toEqual({ ok: false, error: "invalid_card" });
    }
    expect(await count(full.id)).toBe(1);
  });

  it("creates a pending ticket with a unique 8-character code and the current price", async () => {
    const event = await makeEvent(pool, orgA, { priceCents: 10000 });
    const r = await buy(event.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticket.status).toBe("pending");
    expect(r.ticket.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    expect(r.ticket.priceCentsPaid).toBe(10000);

    await pool.query("UPDATE events SET price_cents = 15000 WHERE id = $1", [event.id]);
    const second = await buy(event.id);
    expect(second.ok && second.ticket.priceCentsPaid).toBe(15000);
    const { rows } = await pool.query(
      "SELECT price_cents_paid FROM tickets WHERE event_id = $1 ORDER BY created_at",
      [event.id],
    );
    expect(rows.map((x) => x.price_cents_paid)).toEqual([10000, 15000]);
  });

  it("pending occupies a seat; a decline frees it; cancelled events have 0 available (R05)", async () => {
    const event = await makeEvent(pool, orgA, { capacity: 1 });
    const r = await buy(event.id, CARD.declineSlow);
    expect(await seatStats(pool, event.id)).toEqual({ capacity: 1, occupied: 1, available: 0 });
    expect(await buy(event.id)).toEqual({ ok: false, error: "sold_out" });
    if (r.ok) await applyGatewayResult(pool, r.ticket.id, false);
    expect(await seatStats(pool, event.id)).toEqual({ capacity: 1, occupied: 0, available: 1 });
    expect((await buy(event.id)).ok).toBe(true);
    await pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [event.id]);
    expect((await seatStats(pool, event.id))?.available).toBe(0);
  });

  it("no overselling under 30 concurrent purchases", async () => {
    for (let round = 0; round < 5; round++) {
      const event = await makeEvent(pool, orgA, { capacity: 5 });
      const results = await Promise.all(Array.from({ length: 30 }, () => buy(event.id)));
      const ok = results.filter((r) => r.ok).length;
      const soldOut = results.filter((r) => !r.ok && r.error === "sold_out").length;
      expect({ round, ok, soldOut }).toEqual({ round, ok: 5, soldOut: 25 });
      const stats = await seatStats(pool, event.id);
      expect(stats?.occupied).toBe(5);
      expect(stats?.occupied).toBeLessThanOrEqual(event.capacity);
    }
  });
});
