import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancelEvent } from "../src/cancellation/index.js";
import { checkIn } from "../src/checkin/index.js";
import { eventDashboard } from "../src/dashboard/dashboard.js";
import { processDueJobs } from "../src/gateway/gateway.js";
import { startGatewayWorker } from "../src/gateway/worker.js";
import { toLocalInput } from "../src/lib/format.js";
import { getTicket, purchaseTicket, seatStats } from "../src/tickets/index.js";
import { createTestApp, form, login, SEED, type TestContext } from "./helpers/app.js";
import { CARD, makeEvent, userId, waitFor } from "./helpers/fixtures.js";

const SCALE = 0.01;
const KEY = { "x-api-key": "catraca-partner-dev-key", "content-type": "application/json" };

describe("event cancellation (F07)", () => {
  let ctx: TestContext;
  let orgA: string;
  let orgB: string;
  let buyer: string;
  let a: string;
  let b: string;
  let p: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    orgA = await userId(ctx.pool, SEED.orgA);
    orgB = await userId(ctx.pool, SEED.orgB);
    buyer = await userId(ctx.pool, SEED.participant);
    a = (await login(ctx.app, SEED.orgA)).cookie;
    b = (await login(ctx.app, SEED.orgB)).cookie;
    p = (await login(ctx.app, SEED.participant)).cookie;
  });
  afterAll(async () => {
    await ctx.close();
  });

  const buy = (
    eventId: string,
    cardNumber: string = CARD.approveSlow,
    channel: "storefront" | "partner" = "storefront",
  ) =>
    purchaseTicket(ctx.pool, SCALE, {
      eventId,
      buyerUserId: channel === "storefront" ? buyer : null,
      buyerEmail: "x@example.com",
      cardNumber,
      channel,
    });
  const status = async (id: string) => (await getTicket(ctx.pool, id))?.status;
  const get = (url: string, cookie?: string) =>
    ctx.app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });
  const post = (url: string, cookie?: string, fields: Record<string, string> = {}) =>
    ctx.app.inject({
      method: "POST",
      url,
      headers: { ...(cookie ? { cookie } : {}), ...form(fields).headers },
      payload: form(fields).payload,
    });

  it("cancels only published events of the owner", async () => {
    const draft = await makeEvent(ctx.pool, orgA, { publish: false });
    expect(await cancelEvent(ctx.pool, orgA, draft.id)).toEqual({
      ok: false,
      error: "not_published",
    });
    const event = await makeEvent(ctx.pool, orgA);
    expect(await cancelEvent(ctx.pool, orgB, event.id)).toEqual({ ok: false, error: "not_found" });
    expect((await cancelEvent(ctx.pool, orgA, event.id)).ok).toBe(true);
    expect(await cancelEvent(ctx.pool, orgA, event.id)).toEqual({
      ok: false,
      error: "not_published",
    });
  });

  it("refunds confirmed, cancels pending, leaves declined; 0 seats; purchases rejected", async () => {
    const event = await makeEvent(ctx.pool, orgA, { capacity: 5 });
    const ids: string[] = [];
    for (const card of [CARD.approveSlow, CARD.approveSlow, CARD.approveSlow]) {
      const r = await buy(event.id, card);
      if (r.ok) ids.push(r.ticket.id);
    }
    const [conf, decl, pend] = ids as [string, string, string];
    await ctx.pool.query("UPDATE tickets SET status = 'confirmed' WHERE id = $1", [conf]);
    await ctx.pool.query("UPDATE tickets SET status = 'declined' WHERE id = $1", [decl]);
    expect(await cancelEvent(ctx.pool, orgA, event.id)).toEqual({
      ok: true,
      refunded: 1,
      cancelled: 1,
    });
    expect([await status(conf), await status(decl), await status(pend)]).toEqual([
      "refunded",
      "declined",
      "cancelled",
    ]);
    expect((await seatStats(ctx.pool, event.id))?.available).toBe(0);
    expect(await buy(event.id)).toEqual({ ok: false, error: "event_not_available" });
  });

  it("a late gateway answer does not change cancelled or refunded tickets", async () => {
    const event = await makeEvent(ctx.pool, orgA);
    const slow = await buy(event.id, CARD.approveSlow);
    const fast = await buy(event.id, CARD.approveFast);
    await new Promise((r) => setTimeout(r, 80));
    await processDueJobs(ctx.pool); // fast job → confirmed
    if (!slow.ok || !fast.ok) throw new Error("purchase failed");
    expect(await status(fast.ticket.id)).toBe("confirmed");
    await cancelEvent(ctx.pool, orgA, event.id);
    await new Promise((r) => setTimeout(r, 450)); // slow job (305–390 ms) is now due
    await processDueJobs(ctx.pool);
    expect(await status(slow.ticket.id)).toBe("cancelled");
    expect(await status(fast.ticket.id)).toBe("refunded");
    const { rows } = await ctx.pool.query(
      "SELECT bool_and(processed_at IS NOT NULL) AS done FROM payment_jobs WHERE ticket_id = ANY($1)",
      [[slow.ticket.id, fast.ticket.id]],
    );
    expect(rows[0].done).toBe(true);
  });

  it("check-in on a cancelled event", async () => {
    const event = await makeEvent(ctx.pool, orgA);
    const other = await makeEvent(ctx.pool, orgA);
    const own = await buy(event.id, CARD.approveSlow);
    const pending = await buy(event.id, CARD.approveSlow);
    const foreign = await buy(other.id, CARD.approveSlow);
    if (!own.ok || !pending.ok || !foreign.ok) throw new Error("purchase failed");
    await ctx.pool.query("UPDATE tickets SET status = 'confirmed' WHERE id = ANY($1)", [
      [own.ticket.id, foreign.ticket.id],
    ]);
    expect((await cancelEvent(ctx.pool, orgA, event.id)).ok).toBe(true);
    expect(await checkIn(ctx.pool, orgA, event.id, own.ticket.code)).toEqual({
      result: "cancelled",
    });
    expect(await checkIn(ctx.pool, orgA, event.id, pending.ticket.code)).toEqual({
      result: "cancelled",
    });
    expect(await checkIn(ctx.pool, orgA, event.id, foreign.ticket.code)).toEqual({
      result: "invalid",
    });
    expect(await checkIn(ctx.pool, orgA, event.id, "ZZZZZZZZ")).toEqual({ result: "invalid" });
    const page = await get(`/organizer/events/${event.id}`, a);
    expect(page.body).toContain('name="code"');
  });

  it("purchases racing a cancellation leave no active ticket", async () => {
    for (let round = 0; round < 3; round++) {
      const event = await makeEvent(ctx.pool, orgA, { capacity: 50 });
      const purchases = Array.from({ length: 24 }, () => buy(event.id, CARD.approveSlow));
      const cancellation = new Promise((r) => setTimeout(r, 5)).then(() =>
        cancelEvent(ctx.pool, orgA, event.id),
      );
      const [results, cancel] = await Promise.all([Promise.all(purchases), cancellation]);
      expect(cancel.ok).toBe(true);
      for (const r of results) {
        if (r.ok) expect(await status(r.ticket.id)).toBe("cancelled");
        else expect(r.error).toBe("event_not_available");
      }
      const { rows } = await ctx.pool.query(
        "SELECT count(*) AS n FROM tickets WHERE event_id = $1 AND status IN ('pending', 'confirmed')",
        [event.id],
      );
      expect(rows[0].n).toBe("0");
    }
  });

  it("HTTP: section per status, owner-only route, irreversible, notice", async () => {
    const draft = await makeEvent(ctx.pool, orgA, { publish: false });
    expect((await get(`/organizer/events/${draft.id}`, a)).body).not.toContain("Cancelar evento");
    expect((await post(`/organizer/events/${draft.id}/cancel`, a)).statusCode).toBe(409);

    const event = await makeEvent(ctx.pool, orgA, { name: "Cancelável" });
    expect((await get(`/organizer/events/${event.id}`, a)).body).toContain("Cancelar evento");
    const byB = await post(`/organizer/events/${event.id}/cancel`, b);
    expect(byB.statusCode).toBe(404);
    expect(byB.body).not.toContain("Cancelável");
    expect((await post(`/organizer/events/${event.id}/cancel`)).headers.location).toBe("/login");
    expect((await post(`/organizer/events/${event.id}/cancel`, p)).statusCode).toBe(403);

    const res = await post(`/organizer/events/${event.id}/cancel`, a);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(`/organizer/events/${event.id}?notice=cancelled`);
    const pageBody = (await get(res.headers.location as string, a)).body;
    expect(pageBody).toContain("Cancelado");
    expect(pageBody).toContain(
      "Este evento foi cancelado. Não é possível editá-lo nem republicá-lo.",
    );
    for (const absent of [
      "Salvar alterações",
      `/organizer/events/${event.id}/publish`,
      "Cancelar evento",
    ]) {
      expect(pageBody).not.toContain(absent);
    }
    const edit = await post(`/organizer/events/${event.id}`, a, {
      name: "Reaberto",
      venue: "Bar",
      startsAt: toLocalInput(new Date(Date.now() + 30 * 86_400_000)),
      capacity: "9",
      price: "10,00",
    });
    expect(edit.statusCode).toBe(409);
    expect(edit.body).toContain("Evento cancelado não pode ser editado.");
    expect((await post(`/organizer/events/${event.id}/publish`, a)).statusCode).toBe(409);
    expect((await post(`/organizer/events/${event.id}/cancel`, a)).statusCode).toBe(409);
    expect((await get("/")).body).not.toContain("Cancelável");
    expect((await get(`/events/${event.id}`)).statusCode).toBe(404);
  });

  it("X-F04-F07-2: API and storefront tickets are checked in, counted and cancelled alike", async () => {
    const worker = startGatewayWorker(ctx.pool, { intervalMs: 20 });
    try {
      const event = await makeEvent(ctx.pool, orgA, { capacity: 4, priceCents: 1000 });
      const s1 = await post(`/events/${event.id}/purchase`, p, { cardNumber: CARD.approveFast });
      expect(s1.statusCode).toBe(303);
      const apiBuy = (cardNumber: string) =>
        ctx.app.inject({
          method: "POST",
          url: `/api/partner/events/${event.id}/purchases`,
          headers: KEY,
          payload: JSON.stringify({ buyerEmail: "x@example.com", cardNumber }),
        });
      const a1 = (await apiBuy(CARD.approveFast)).json();
      // A2 must still be pending when we cancel: make its job due far in the future.
      const a2 = (await apiBuy(CARD.approveSlow)).json();
      await ctx.pool.query(
        "UPDATE payment_jobs SET due_at = now() + interval '1 hour' WHERE ticket_id = $1",
        [a2.ticketId],
      );
      await waitFor(async () => {
        const { rows } = await ctx.pool.query(
          "SELECT count(*) AS n FROM tickets WHERE event_id = $1 AND status = 'confirmed'",
          [event.id],
        );
        return rows[0].n === "2";
      });
      expect(await checkIn(ctx.pool, orgA, event.id, a1.code)).toEqual({ result: "admitted" });
      const lookup = await ctx.app.inject({
        method: "GET",
        url: `/api/partner/tickets/${a1.ticketId}`,
        headers: KEY,
      });
      expect(lookup.json().checkedIn).toBe(true);
      expect(await eventDashboard(ctx.pool, event.id)).toEqual({
        confirmed: 2,
        pending: 1,
        checkIns: 1,
        availableSeats: 1,
        revenueCents: 2000,
        refunded: 0,
      });

      expect((await cancelEvent(ctx.pool, orgA, event.id)).ok).toBe(true);
      const { rows } = await ctx.pool.query(
        "SELECT channel, status FROM tickets WHERE event_id = $1 ORDER BY channel, status",
        [event.id],
      );
      expect(rows).toEqual([
        { channel: "partner", status: "cancelled" },
        { channel: "partner", status: "refunded" },
        { channel: "storefront", status: "refunded" },
      ]);
      const after = {
        confirmed: 0,
        pending: 0,
        checkIns: 0,
        availableSeats: 0,
        revenueCents: 0,
        refunded: 2,
      };
      expect(await eventDashboard(ctx.pool, event.id)).toEqual(after);
      expect(await checkIn(ctx.pool, orgA, event.id, a1.code)).toEqual({ result: "cancelled" });

      // The late answer arrives and is ignored.
      await ctx.pool.query("UPDATE payment_jobs SET due_at = now() WHERE ticket_id = $1", [
        a2.ticketId,
      ]);
      await waitFor(async () => {
        const { rows: j } = await ctx.pool.query(
          "SELECT processed_at IS NOT NULL AS done FROM payment_jobs WHERE ticket_id = $1",
          [a2.ticketId],
        );
        return j[0].done;
      });
      expect(await status(a2.ticketId)).toBe("cancelled");
      expect(await eventDashboard(ctx.pool, event.id)).toEqual(after);

      const list = await ctx.app.inject({
        method: "GET",
        url: "/api/partner/events",
        headers: KEY,
      });
      expect(list.json().some((e: { id: string }) => e.id === event.id)).toBe(false);
      const apiAfter = await apiBuy(CARD.approveFast);
      expect(apiAfter.statusCode).toBe(404);
      expect(apiAfter.json()).toEqual({ error: "event_not_available" });
    } finally {
      await worker.stop();
    }
  });
});
