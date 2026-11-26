import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "../src/db/pool.js";
import { runSeed } from "../src/db/seed.js";
import { applyGatewayResult, gatewayDecision, processDueJobs } from "../src/gateway/gateway.js";
import { startGatewayWorker } from "../src/gateway/worker.js";
import { getTicket, purchaseTicket } from "../src/tickets/index.js";
import { setupTestDb } from "./helpers/db.js";
import { CARD, makeEvent, userId, waitFor } from "./helpers/fixtures.js";

const SCALE = 0.01; // fast: 20–45 ms, slow: 305–390 ms

describe("gatewayDecision (brief table, scale 1)", () => {
  it("maps card endings to outcomes", () => {
    const outcome = (card: string) => gatewayDecision(card, 1).approve;
    expect(outcome(CARD.approveFast)).toBe(true);
    expect(outcome(CARD.declineFast)).toBe(false);
    expect(outcome(CARD.approveSlow)).toBe(true);
    expect(outcome(CARD.declineSlow)).toBe(false);
    expect(outcome(CARD.other)).toBe(false);
    expect(outcome("4000000000009999")).toBe(false);
  });

  it("keeps delays inside the brief windows (2–5 s fast, 30–40 s slow)", () => {
    for (const r of [0, 0.5, 0.999999]) {
      for (const card of [CARD.approveFast, CARD.declineFast, CARD.other]) {
        const { delayMs } = gatewayDecision(card, 1, () => r);
        expect(delayMs).toBeGreaterThanOrEqual(2000);
        expect(delayMs).toBeLessThanOrEqual(4500);
      }
      for (const card of [CARD.approveSlow, CARD.declineSlow]) {
        const { delayMs } = gatewayDecision(card, 1, () => r);
        expect(delayMs).toBeGreaterThanOrEqual(30_500);
        expect(delayMs).toBeLessThanOrEqual(39_000);
      }
    }
    expect(gatewayDecision(CARD.approveSlow, 0.01, () => 0).delayMs).toBe(305);
  });
});

describe("gateway jobs", () => {
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

  const buy = async (eventId: string, cardNumber: string) => {
    const r = await purchaseTicket(pool, SCALE, {
      eventId,
      buyerUserId: buyer,
      buyerEmail: "participante@catraca.test",
      cardNumber,
      channel: "storefront",
    });
    if (!r.ok) throw new Error(r.error);
    return r.ticket;
  };
  const statusOf = async (id: string) => (await getTicket(pool, id))?.status;

  it("the worker resolves every card per the brief table", async () => {
    const event = await makeEvent(pool, orgA, { capacity: 10 });
    const worker = startGatewayWorker(pool, { intervalMs: 20 });
    try {
      const t = {
        approveFast: await buy(event.id, CARD.approveFast),
        declineFast: await buy(event.id, CARD.declineFast),
        approveSlow: await buy(event.id, CARD.approveSlow),
        declineSlow: await buy(event.id, CARD.declineSlow),
        other: await buy(event.id, CARD.other),
      };
      for (const ticket of Object.values(t)) expect(ticket.status).toBe("pending");
      await waitFor(async () => (await statusOf(t.declineSlow.id)) !== "pending", 3000);
      expect(await statusOf(t.approveFast.id)).toBe("confirmed");
      expect(await statusOf(t.declineFast.id)).toBe("declined");
      expect(await statusOf(t.approveSlow.id)).toBe("confirmed");
      expect(await statusOf(t.declineSlow.id)).toBe("declined");
      expect(await statusOf(t.other.id)).toBe("declined");
    } finally {
      await worker.stop();
    }
  });

  it("applies results only to pending tickets", async () => {
    const event = await makeEvent(pool, orgA, { capacity: 20 });
    for (const status of ["confirmed", "declined", "cancelled", "refunded"] as const) {
      for (const approved of [true, false]) {
        const ticket = await buy(event.id, CARD.approveSlow);
        await pool.query("UPDATE tickets SET status = $2 WHERE id = $1", [ticket.id, status]);
        expect(await applyGatewayResult(pool, ticket.id, approved)).toBe(false);
        expect(await statusOf(ticket.id)).toBe(status);
      }
    }
    const pending = await buy(event.id, CARD.approveSlow);
    expect(await applyGatewayResult(pool, pending.id, true)).toBe(true);
    expect(await statusOf(pending.id)).toBe("confirmed");
  });

  it("a due job whose ticket was cancelled is processed without changing the ticket", async () => {
    const event = await makeEvent(pool, orgA);
    const ticket = await buy(event.id, CARD.approveFast);
    await pool.query("UPDATE tickets SET status = 'cancelled' WHERE id = $1", [ticket.id]);
    await new Promise((r) => setTimeout(r, 80));
    await processDueJobs(pool);
    expect(await statusOf(ticket.id)).toBe("cancelled");
    const { rows } = await pool.query(
      "SELECT processed_at IS NOT NULL AS done FROM payment_jobs WHERE ticket_id = $1",
      [ticket.id],
    );
    expect(rows[0].done).toBe(true);
  });

  it("jobs survive a worker restart (persisted queue)", async () => {
    const event = await makeEvent(pool, orgA);
    const first = startGatewayWorker(pool, { intervalMs: 20 });
    const ticket = await buy(event.id, CARD.approveSlow);
    await first.stop(); // "app stops" before the slow answer is due
    expect(await statusOf(ticket.id)).toBe("pending");
    const second = startGatewayWorker(pool, { intervalMs: 20 });
    try {
      await waitFor(async () => (await statusOf(ticket.id)) === "confirmed", 3000);
      expect(await statusOf(ticket.id)).toBe("confirmed");
    } finally {
      await second.stop();
    }
  });
});
