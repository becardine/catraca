import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toLocalInput } from "../src/lib/format.js";
import {
  createTestApp,
  form,
  login,
  NEW_PASSWORD,
  SEED,
  sessionCookie,
  type TestContext,
  uniqueEmail,
} from "./helpers/app.js";
import { CARD, makeEvent, userId } from "./helpers/fixtures.js";

describe("storefront purchase and my tickets (F03)", () => {
  let ctx: TestContext;
  let orgA: string;
  let a: string;
  let p: string;
  let q: string;

  const get = (url: string, cookie?: string) =>
    ctx.app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });
  const post = (url: string, cookie: string | undefined, fields: Record<string, string>) =>
    ctx.app.inject({
      method: "POST",
      url,
      headers: { ...(cookie ? { cookie } : {}), ...form(fields).headers },
      payload: form(fields).payload,
    });
  const buy = (
    eventId: string,
    cookie: string | undefined,
    cardNumber: string = CARD.approveSlow,
  ) => post(`/events/${eventId}/purchase`, cookie, { cardNumber });

  beforeAll(async () => {
    ctx = await createTestApp();
    orgA = await userId(ctx.pool, SEED.orgA);
    a = (await login(ctx.app, SEED.orgA)).cookie;
    p = (await login(ctx.app, SEED.participant)).cookie;
    const signup = await post("/signup", undefined, {
      name: "Quarta",
      email: uniqueEmail("q"),
      password: NEW_PASSWORD,
    });
    q = `catraca_session=${sessionCookie(signup)}`;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it("participant buys: immediate redirect, ticket pending in Meus ingressos (F03-AC1, AC7)", async () => {
    const event = await makeEvent(ctx.pool, orgA, { name: "Show C1" });
    const page = await get(`/events/${event.id}`, p);
    expect(page.body).toContain('name="cardNumber"');
    expect(page.body).toContain("Vagas disponíveis: 5");
    const res = await buy(event.id, p);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/my-tickets?notice=purchased");
    const mine = await get("/my-tickets", p);
    expect(mine.body).toContain("Show C1");
    expect(mine.body).toContain("pendente");
    expect(mine.body).toMatch(/<code>[23456789A-Z]{8}<\/code>/);
  });

  it("rejects invalid cards with 422 and creates nothing (F03-AC3)", async () => {
    const event = await makeEvent(ctx.pool, orgA);
    for (const card of ["400000000000001", "4000abcd00000001", ""]) {
      const res = await buy(event.id, p, card);
      expect(res.statusCode).toBe(422);
      expect(res.body).toContain("Informe um número de cartão com 16 dígitos.");
    }
    const { rows } = await ctx.pool.query("SELECT count(*) AS n FROM tickets WHERE event_id = $1", [
      event.id,
    ]);
    expect(rows[0].n).toBe("0");
  });

  it("shows Ingressos esgotados and rejects stale forms when full (F03-AC4, AC5)", async () => {
    const event = await makeEvent(ctx.pool, orgA, { capacity: 1 });
    expect((await buy(event.id, p, CARD.declineSlow)).statusCode).toBe(303);
    const page = await get(`/events/${event.id}`, q);
    expect(page.body).toContain("Ingressos esgotados");
    expect(page.body).not.toContain('name="cardNumber"');
    const stale = await buy(event.id, q);
    expect(stale.statusCode).toBe(409);
    expect(stale.body).toContain("Ingressos esgotados");
  });

  it("X-F01-F03-1: visitors go to login, organizers cannot buy, each sees only own tickets", async () => {
    const event = await makeEvent(ctx.pool, orgA, { name: "Show X1" });
    const visitorPage = await get(`/events/${event.id}`);
    expect(visitorPage.body).not.toContain('name="cardNumber"');
    expect(visitorPage.body).toContain('href="/login"');
    const visitorBuy = await buy(event.id, undefined);
    expect(visitorBuy.statusCode).toBe(303);
    expect(visitorBuy.headers.location).toBe("/login");

    const orgPage = await get(`/events/${event.id}`, a);
    expect(orgPage.body).toContain("Organizadores não compram ingressos.");
    expect(orgPage.body).not.toContain('name="cardNumber"');
    expect((await buy(event.id, a)).statusCode).toBe(403);

    expect((await buy(event.id, q)).statusCode).toBe(303);
    const { rows } = await ctx.pool.query<{ code: string }>(
      "SELECT code FROM tickets WHERE event_id = $1",
      [event.id],
    );
    expect(rows).toHaveLength(1);
    const qPage = await get("/my-tickets", q);
    const pPage = await get("/my-tickets", p);
    expect(qPage.body).toContain(rows[0]?.code);
    expect(pPage.body).not.toContain(rows[0]?.code);
    expect(pPage.body).not.toContain("Show X1");
  });

  it("X-F02-F03-1: drafts cannot be bought until published (R02)", async () => {
    const draft = await makeEvent(ctx.pool, orgA, { publish: false });
    expect((await buy(draft.id, p)).statusCode).toBe(404);
    await post(`/organizer/events/${draft.id}/publish`, a, {});
    expect((await buy(draft.id, p)).statusCode).toBe(303);
  });

  const editFields = (over: Record<string, string>) => ({
    name: "Editado",
    venue: "Bar",
    startsAt: toLocalInput(new Date(Date.now() + 30 * 86_400_000)),
    capacity: "2",
    price: "10,00",
    ...over,
  });

  it("X-F02-F03-2: capacity cannot go below occupied seats; increases open seats (R03)", async () => {
    const event = await makeEvent(ctx.pool, orgA, { capacity: 2 });
    await buy(event.id, p, CARD.approveSlow);
    await buy(event.id, p, CARD.approveSlow);
    await ctx.pool.query(
      "UPDATE tickets SET status = 'confirmed' WHERE id = (SELECT id FROM tickets WHERE event_id = $1 LIMIT 1)",
      [event.id],
    );
    const low = await post(`/organizer/events/${event.id}`, a, editFields({ capacity: "1" }));
    expect(low.statusCode).toBe(422);
    expect(low.body).toContain("A lotação não pode ser menor que as vagas ocupadas (2).");
    expect((await buy(event.id, q)).statusCode).toBe(409);
    const up = await post(`/organizer/events/${event.id}`, a, editFields({ capacity: "3" }));
    expect(up.statusCode).toBe(303);
    expect((await buy(event.id, q)).statusCode).toBe(303);
  });

  it("X-F02-F03-3: a price edit applies only to later purchases (R03)", async () => {
    const event = await makeEvent(ctx.pool, orgA, { priceCents: 10000 });
    await buy(event.id, p);
    expect(
      (
        await post(
          `/organizer/events/${event.id}`,
          a,
          editFields({ capacity: "5", price: "150,00" }),
        )
      ).statusCode,
    ).toBe(303);
    await buy(event.id, p);
    const { rows } = await ctx.pool.query(
      "SELECT price_cents_paid FROM tickets WHERE event_id = $1 ORDER BY created_at",
      [event.id],
    );
    expect(rows.map((r) => r.price_cents_paid)).toEqual([10000, 15000]);
  });
});
