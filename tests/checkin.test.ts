import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHECKIN_MESSAGES, checkIn } from "../src/checkin/checkin.js";
import { applyGatewayResult } from "../src/gateway/gateway.js";
import { getTicket, purchaseTicket, type TicketStatus } from "../src/tickets/index.js";
import { createTestApp, form, login, SEED, type TestContext } from "./helpers/app.js";
import { CARD, makeEvent, userId } from "./helpers/fixtures.js";

describe("F05 check-in", () => {
  let ctx: TestContext;
  let orgA: string;
  let orgB: string;
  let buyer: string;
  let cookieA: string;
  let cookieB: string;
  let cookieP: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    orgA = await userId(ctx.pool, SEED.orgA);
    orgB = await userId(ctx.pool, SEED.orgB);
    buyer = await userId(ctx.pool, SEED.participant);
    cookieA = (await login(ctx.app, SEED.orgA)).cookie;
    cookieB = (await login(ctx.app, SEED.orgB)).cookie;
    cookieP = (await login(ctx.app, SEED.participant)).cookie;
  });
  afterAll(async () => ctx?.close());

  async function ticket(eventId: string, status: TicketStatus = "confirmed") {
    const result = await purchaseTicket(ctx.pool, 1, {
      eventId,
      buyerUserId: buyer,
      buyerEmail: SEED.participant,
      cardNumber: CARD.approveSlow,
      channel: "storefront",
    });
    if (!result.ok) throw new Error(result.error);
    await ctx.pool.query("UPDATE tickets SET status = $2 WHERE id = $1", [
      result.ticket.id,
      status,
    ]);
    return result.ticket;
  }

  const post = (id: string, code: string, cookie = cookieA) =>
    ctx.app.inject({
      method: "POST",
      url: `/organizer/events/${id}/checkin`,
      ...form({ code }),
      headers: { ...form({ code }).headers, cookie },
    });

  async function expectResult(id: string, code: string, result: keyof typeof CHECKIN_MESSAGES) {
    const response = await post(id, code);
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(`/organizer/events/${id}?checkin=${result}#checkin`);
    const page = await ctx.app.inject({
      url: response.headers.location,
      headers: { cookie: cookieA },
    });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(
      `<p class="checkin-result" role="status">${CHECKIN_MESSAGES[result]}</p>`,
    );
    return page;
  }

  it("uses the exact five R10 messages", () => {
    expect(CHECKIN_MESSAGES).toEqual({
      invalid: "Ingresso inválido para este evento",
      cancelled: "Evento cancelado",
      not_confirmed: "Ingresso não confirmado",
      already_used: "Ingresso já utilizado",
      admitted: "Entrada liberada",
    });
  });

  it("admits the confirmed storefront code from Meus ingressos and preserves the first timestamp", async () => {
    const event = await makeEvent(ctx.pool, orgA);
    const purchase = await ctx.app.inject({
      method: "POST",
      url: `/events/${event.id}/purchase`,
      ...form({ cardNumber: CARD.approveFast }),
      headers: { ...form({}).headers, cookie: cookieP },
    });
    expect(purchase.statusCode).toBe(303);
    const row = (
      await ctx.pool.query("SELECT id, code FROM tickets WHERE event_id = $1", [event.id])
    ).rows[0];
    await applyGatewayResult(ctx.pool, row.id, true);
    const tickets = await ctx.app.inject({ url: "/my-tickets", headers: { cookie: cookieP } });
    const code = tickets.body.match(
      new RegExp(
        `<td>${event.name}</td>\\s*<td class="status">confirmado</td>\\s*<td><code>([^<]+)</code>`,
      ),
    )?.[1];
    expect(code).toHaveLength(8);
    await expectResult(event.id, `  ${code?.toLowerCase()}  `, "admitted");
    const admitted = await getTicket(ctx.pool, row.id);
    expect(admitted?.checkedInAt).toBeInstanceOf(Date);
    expect(admitted?.status).toBe("confirmed");
    await expectResult(event.id, row.code, "already_used");
    expect((await getTicket(ctx.pool, row.id))?.checkedInAt).toEqual(admitted?.checkedInAt);
  });

  it.each(["pending", "declined", "cancelled", "refunded"] as const)(
    "rejects a %s ticket before checking prior use",
    async (status) => {
      const event = await makeEvent(ctx.pool, orgA);
      const t = await ticket(event.id, status);
      await ctx.pool.query("UPDATE tickets SET checked_in_at = now() WHERE id = $1", [t.id]);
      await expectResult(event.id, t.code, "not_confirmed");
    },
  );

  it("rejects unknown, empty, same-owner foreign and other-owner foreign codes before other rules", async () => {
    const event = await makeEvent(ctx.pool, orgA);
    const ownOther = await makeEvent(ctx.pool, orgA);
    const other = await makeEvent(ctx.pool, orgB);
    const ownTicket = await ticket(ownOther.id);
    const otherTicket = await ticket(other.id);
    for (const code of ["ZZZZZZZZ", "", ownTicket.code, otherTicket.code]) {
      await expectResult(event.id, code, "invalid");
    }
    expect((await getTicket(ctx.pool, otherTicket.id))?.checkedInAt).toBeNull();
    await ctx.pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [event.id]);
    for (const code of ["ZZZZZZZZ", "", ownTicket.code, otherTicket.code]) {
      expect(await checkIn(ctx.pool, orgA, event.id, code)).toEqual({ result: "invalid" });
      await expectResult(event.id, code, "invalid");
    }
  });

  it("reports cancellation before confirmation and prior use and keeps the form available", async () => {
    const event = await makeEvent(ctx.pool, orgA);
    const confirmed = await ticket(event.id);
    const pending = await ticket(event.id, "pending");
    await ctx.pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [event.id]);
    for (const t of [confirmed, pending]) {
      const page = await expectResult(event.id, t.code, "cancelled");
      expect(page.body).toContain('<section id="checkin">');
      expect(page.body).toContain('name="code"');
      expect((await getTicket(ctx.pool, t.id))?.checkedInAt).toBeNull();
    }
    await ctx.pool.query("UPDATE tickets SET checked_in_at = now() WHERE id = $1", [confirmed.id]);
    await expectResult(event.id, confirmed.code, "cancelled");
  });

  it("concurrent check-ins admit exactly once", async () => {
    const event = await makeEvent(ctx.pool, orgA);
    const t = await ticket(event.id);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => checkIn(ctx.pool, orgA, event.id, t.code)),
    );
    expect(results.filter((r) => "result" in r && r.result === "admitted")).toHaveLength(1);
    expect(results.filter((r) => "result" in r && r.result === "already_used")).toHaveLength(9);
    expect((await getTicket(ctx.pool, t.id))?.checkedInAt).toBeInstanceOf(Date);
  });

  it("only lets the owner check in and hides event data from non-owners", async () => {
    const event = await makeEvent(ctx.pool, orgA);
    const t = await ticket(event.id);
    expect(await checkIn(ctx.pool, orgB, event.id, t.code)).toEqual({ error: "not_found" });
    expect(await checkIn(ctx.pool, orgA, "evt_missing", t.code)).toEqual({ error: "not_found" });
    const foreign = await post(event.id, t.code, cookieB);
    const missing = await post("evt_missing", t.code, cookieB);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).toBe(missing.body);
    expect(foreign.body).not.toContain(event.name);
    expect(foreign.body).not.toContain(t.code);
    const visitor = await post(event.id, t.code, "");
    expect(visitor.statusCode).toBe(303);
    expect(visitor.headers.location).toBe("/login");
    expect((await post(event.id, t.code, cookieP)).statusCode).toBe(403);
    expect((await getTicket(ctx.pool, t.id))?.checkedInAt).toBeNull();
    const page = await ctx.app.inject({
      url: `/organizer/events/${event.id}`,
      headers: { cookie: cookieA },
    });
    expect(page.body).toContain('<section id="checkin">');
    expect(page.body).toContain(`action="/organizer/events/${event.id}/checkin"`);
    expect(page.body).toContain('name="code"');
    expect(page.body).toContain("Validar ingresso");
  });

  it("ignores unrecognized result keys without reflecting query input", async () => {
    const event = await makeEvent(ctx.pool, orgA);
    for (const value of ["<script>alert(1)</script>", "toString", "__proto__", "unknown"]) {
      const page = await ctx.app.inject({
        url: `/organizer/events/${event.id}?checkin=${encodeURIComponent(value)}`,
        headers: { cookie: cookieA },
      });
      expect(page.body).not.toContain('class="checkin-result"');
      expect(page.body).not.toContain(value);
    }
  });
});
