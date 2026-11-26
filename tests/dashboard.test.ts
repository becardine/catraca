import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventDashboard } from "../src/dashboard/index.js";
import { applyGatewayResult } from "../src/gateway/gateway.js";
import { purchaseTicket } from "../src/tickets/index.js";
import { createTestApp, login, SEED, type TestContext } from "./helpers/app.js";
import { CARD, makeEvent, userId } from "./helpers/fixtures.js";

describe("event dashboard (F06)", () => {
  let ctx: TestContext;
  let orgA: string;
  let buyer: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    orgA = await userId(ctx.pool, SEED.orgA);
    buyer = await userId(ctx.pool, SEED.participant);
  });
  afterAll(async () => {
    await ctx.close();
  });

  /** Buys a pending ticket (the gateway never answers in tests unless applied explicitly). */
  const buy = async (eventId: string) => {
    const r = await purchaseTicket(ctx.pool, 1, {
      eventId,
      buyerUserId: buyer,
      buyerEmail: SEED.participant,
      cardNumber: CARD.approveSlow,
      channel: "storefront",
    });
    if (!r.ok) throw new Error(r.error);
    return r.ticket.id;
  };
  const confirm = (ticketId: string) => applyGatewayResult(ctx.pool, ticketId, true);
  const decline = (ticketId: string) => applyGatewayResult(ctx.pool, ticketId, false);
  const setTicket = (ticketId: string, status: string, checkedIn = false) =>
    ctx.pool.query(
      `UPDATE tickets SET status = $2, checked_in_at = CASE WHEN $3::boolean THEN now() END
        WHERE id = $1`,
      [ticketId, status, checkedIn],
    );

  it("empty event: zeros, all seats available, R$ 0,00 (F06-AC1)", async () => {
    const event = await makeEvent(ctx.pool, orgA, { capacity: 5 });
    expect(await eventDashboard(ctx.pool, event.id)).toEqual({
      confirmed: 0,
      pending: 0,
      checkIns: 0,
      availableSeats: 5,
      revenueCents: 0,
      refunded: 0,
    });
  });

  it("mixed statuses: declined/cancelled count nowhere, refunded only in Estornados (F06-AC1, AC2)", async () => {
    const event = await makeEvent(ctx.pool, orgA, { capacity: 10, priceCents: 10000 });
    const ids = [];
    for (let i = 0; i < 7; i++) ids.push(await buy(event.id));
    const [c1, c2, , d1, x1, r1, r2] = ids as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    await confirm(c1);
    await setTicket(c2, "confirmed", true); // confirmed and checked in
    await decline(d1);
    await setTicket(x1, "cancelled");
    await setTicket(r1, "refunded", true); // checked in, then refunded
    await setTicket(r2, "refunded");
    // The third ticket stays pending.

    expect(await eventDashboard(ctx.pool, event.id)).toEqual({
      confirmed: 2,
      pending: 1,
      checkIns: 1,
      availableSeats: 7,
      revenueCents: 20000,
      refunded: 2,
    });
  });

  it("revenue uses each ticket's price snapshot: 2 × 100 + 1 × 150 = 350 (X-F03-F06-1)", async () => {
    const event = await makeEvent(ctx.pool, orgA, { capacity: 3, priceCents: 10000 });
    await confirm(await buy(event.id));
    await confirm(await buy(event.id));
    await ctx.pool.query("UPDATE events SET price_cents = 15000 WHERE id = $1", [event.id]);
    await confirm(await buy(event.id));
    const d = await eventDashboard(ctx.pool, event.id);
    expect(d).toMatchObject({ confirmed: 3, availableSeats: 0, revenueCents: 35000 });
  });

  it("cancelled event shows 0 available seats (R05)", async () => {
    const event = await makeEvent(ctx.pool, orgA, { capacity: 5 });
    await ctx.pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [event.id]);
    expect((await eventDashboard(ctx.pool, event.id)).availableSeats).toBe(0);
  });

  it("numbers change after a gateway result with no other write (F06-AC3)", async () => {
    const event = await makeEvent(ctx.pool, orgA, { capacity: 5, priceCents: 1000 });
    const ticket = await buy(event.id);
    expect(await eventDashboard(ctx.pool, event.id)).toMatchObject({
      confirmed: 0,
      pending: 1,
      availableSeats: 4,
      revenueCents: 0,
    });
    await confirm(ticket);
    expect(await eventDashboard(ctx.pool, event.id)).toMatchObject({
      confirmed: 1,
      pending: 0,
      availableSeats: 4,
      revenueCents: 1000,
    });
  });

  describe("HTTP (X-F02-F06-1)", () => {
    const metric = (body: string, name: string) =>
      new RegExp(`data-metric="${name}">([^<]*)<`).exec(body)?.[1];

    it("the owner sees the six metrics with exact labels and money format; organizer B gets 404", async () => {
      const name = "Painel HTTP F06";
      const event = await makeEvent(ctx.pool, orgA, { capacity: 3, priceCents: 10000, name });
      await confirm(await buy(event.id));
      await confirm(await buy(event.id));
      await ctx.pool.query("UPDATE events SET price_cents = 15000 WHERE id = $1", [event.id]);
      await confirm(await buy(event.id));

      const a = (await login(ctx.app, SEED.orgA)).cookie;
      const res = await ctx.app.inject({
        method: "GET",
        url: `/organizer/events/${event.id}`,
        headers: { cookie: a },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<section id="dashboard"><h2>Painel</h2>');
      for (const label of [
        "Confirmados",
        "Pendentes",
        "Check-ins",
        "Vagas disponíveis",
        "Receita",
        "Estornados",
      ]) {
        expect(res.body).toContain(`<dt>${label}</dt>`);
      }
      const found = [...res.body.matchAll(/data-metric="([a-zA-Z]+)"/g)].map((m) => m[1]).sort();
      expect(found).toEqual([
        "availableSeats",
        "checkIns",
        "confirmed",
        "pending",
        "refunded",
        "revenue",
      ]);
      expect({
        confirmed: metric(res.body, "confirmed"),
        pending: metric(res.body, "pending"),
        checkIns: metric(res.body, "checkIns"),
        availableSeats: metric(res.body, "availableSeats"),
        revenue: metric(res.body, "revenue"),
        refunded: metric(res.body, "refunded"),
      }).toEqual({
        confirmed: "3",
        pending: "0",
        checkIns: "0",
        availableSeats: "0",
        revenue: "R$ 350,00",
        refunded: "0",
      });

      const b = (await login(ctx.app, SEED.orgB)).cookie;
      const other = await ctx.app.inject({
        method: "GET",
        url: `/organizer/events/${event.id}`,
        headers: { cookie: b },
      });
      expect(other.statusCode).toBe(404);
      expect(other.body).not.toContain("data-metric");
      expect(other.body).not.toContain(name);
      expect(other.body).not.toContain("R$ 350,00");
    });

    it("an empty event page shows R$ 0,00 and every seat available (F06-AC1)", async () => {
      const event = await makeEvent(ctx.pool, orgA);
      const a = (await login(ctx.app, SEED.orgA)).cookie;
      const res = await ctx.app.inject({
        method: "GET",
        url: `/organizer/events/${event.id}`,
        headers: { cookie: a },
      });
      expect(metric(res.body, "revenue")).toBe("R$ 0,00");
      expect(metric(res.body, "availableSeats")).toBe("5");
    });
  });
});
