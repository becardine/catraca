import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { processDueJobs } from "../src/gateway/gateway.js";
import { isValidPartnerKey, parsePurchaseBody } from "../src/partner-api/index.js";
import { createTestApp, form, login, SEED, type TestContext } from "./helpers/app.js";
import { CARD, makeEvent, userId, waitFor } from "./helpers/fixtures.js";

const KEY = loadConfig({}).partnerApiKey;
const JSON_HEADERS = { "content-type": "application/json" };

describe("partner API (F04)", () => {
  let ctx: TestContext;
  let orgA: string;
  let p: string;

  type Headers = Record<string, string>;
  const api = (
    method: "GET" | "POST",
    path: string,
    { key = KEY as string | null, payload, headers = {} as Headers } = {} as {
      key?: string | null;
      payload?: string;
      headers?: Headers;
    },
  ) =>
    ctx.app.inject({
      method,
      url: `/api/partner${path}`,
      headers: { ...(key === null ? {} : { "x-api-key": key }), ...headers },
      ...(payload === undefined ? {} : { payload }),
    });
  const body = (cardNumber: string, buyerEmail = "p@example.com") =>
    JSON.stringify({ buyerEmail, cardNumber });
  const buy = (eventId: string, payload: string, headers: Headers = JSON_HEADERS) =>
    api("POST", `/events/${eventId}/purchases`, { payload, headers });
  const expectJson = (res: LightMyRequestResponse, status: number, json: unknown) => {
    expect(res.statusCode).toBe(status);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.json()).toEqual(json);
  };
  const listing = async () => {
    const res = await api("GET", "/events");
    expect(res.statusCode).toBe(200);
    return res.json() as Array<Record<string, unknown>>;
  };
  const cancelInDb = (eventId: string) =>
    ctx.pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [eventId]);
  const ticketCount = async (eventIds: string[]) => {
    const { rows } = await ctx.pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM tickets WHERE event_id = ANY($1)",
      [eventIds],
    );
    return Number(rows[0]?.n);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    orgA = await userId(ctx.pool, SEED.orgA);
    p = (await login(ctx.app, SEED.participant)).cookie;
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe("key (F04-C1)", () => {
    it("compares keys exactly", () => {
      expect(isValidPartnerKey(KEY, KEY)).toBe(true);
      expect(isValidPartnerKey(`${KEY}x`, KEY)).toBe(false);
      expect(isValidPartnerKey("", KEY)).toBe(false);
      expect(isValidPartnerKey(undefined, KEY)).toBe(false);
      expect(isValidPartnerKey([KEY], KEY)).toBe(false);
    });

    it("every route, unknown paths and bad bodies answer 401 without a valid key", async () => {
      const event = await makeEvent(ctx.pool, orgA);
      const bought = await buy(event.id, body(CARD.approveFast));
      const ticketId = bought.json().ticketId as string;
      const requests: Array<[method: "GET" | "POST", path: string, payload?: string]> = [
        ["GET", "/events"],
        ["POST", `/events/${event.id}/purchases`, body(CARD.approveFast)],
        ["GET", `/tickets/${ticketId}`],
        ["GET", "/unknown"],
        ["GET", ""],
        ["POST", "/unknown", "not json"],
      ];
      for (const key of [null, "wrong", ""]) {
        for (const [method, path, payload] of requests) {
          const res = await api(method, path, { key, payload, headers: JSON_HEADERS });
          expectJson(res, 401, { error: "unauthorized" });
          expect(res.body).toBe('{"error":"unauthorized"}');
        }
        for (const [payload, type] of [
          ["{}", "application/json"],
          ["not json", "application/json"],
          ["not json", "text/plain"],
          ["<a/>", "application/xml"],
          ["", "application/json"],
        ]) {
          const res = await api("POST", `/events/${event.id}/purchases`, {
            key,
            payload,
            headers: { "content-type": type as string },
          });
          expect(res.body).toBe('{"error":"unauthorized"}');
          expect(res.statusCode).toBe(401);
        }
      }
      expect(await ticketCount([event.id])).toBe(1);
    });

    it("unknown partner paths with a valid key are a JSON 404", async () => {
      for (const path of ["/unknown", "/events/x/y/z", ""]) {
        const res = await api("GET", path);
        expectJson(res, 404, { error: "not_found" });
      }
      expectJson(await api("POST", "/tickets/tkt_x"), 404, { error: "not_found" });
    });
  });

  describe("listing (F04-C2, C8)", () => {
    it("lists only published events with exactly the brief's fields", async () => {
      const draft = await makeEvent(ctx.pool, orgA, { publish: false, capacity: 3 });
      const open = await makeEvent(ctx.pool, orgA, {
        name: "F04 C2",
        capacity: 3,
        priceCents: 10000,
      });
      const cancelled = await makeEvent(ctx.pool, orgA, { capacity: 3 });
      await cancelInDb(cancelled.id);
      expect((await buy(open.id, body(CARD.approveSlow))).statusCode).toBe(202);

      const items = await listing();
      const ids = items.map((i) => i.id);
      expect(ids).not.toContain(draft.id);
      expect(ids).not.toContain(cancelled.id);
      const item = items.find((i) => i.id === open.id);
      expect(Object.keys(item ?? {}).sort()).toEqual(
        ["availableSeats", "id", "name", "priceCents", "startsAt"].sort(),
      );
      expect(item).toMatchObject({ name: "F04 C2", priceCents: 10000, availableSeats: 2 });
      expect(item?.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-03:00$/);
      expect(new Date(item?.startsAt as string).getTime()).toBe(open.startsAt.getTime());
    });

    it("a draft created in the UI appears only after it is published in the UI", async () => {
      const a = (await login(ctx.app, SEED.orgA)).cookie;
      const startsAt = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      const fields = {
        name: "F04 C8",
        venue: "Bar",
        startsAt: `${startsAt}T20:00`,
        capacity: "4",
        price: "25,50",
      };
      const created = await ctx.app.inject({
        method: "POST",
        url: "/organizer/events",
        headers: { cookie: a, ...form(fields).headers },
        payload: form(fields).payload,
      });
      const id = `${created.headers.location ?? ""}`.match(/evt_[a-z0-9]+/i)?.[0] as string;
      expect(id).toBeTruthy();
      expect((await listing()).map((i) => i.id)).not.toContain(id);
      await ctx.app.inject({
        method: "POST",
        url: `/organizer/events/${id}/publish`,
        headers: { cookie: a },
      });
      const item = (await listing()).find((i) => i.id === id);
      expect(item).toMatchObject({ name: "F04 C8", availableSeats: 4, priceCents: 2550 });
      expect(item?.startsAt).toBe(`${startsAt}T20:00:00-03:00`);
    });
  });

  describe("purchase (F04-C3, C4, C7)", () => {
    it("answers 202 pending at once; the ticket is still pending right after", async () => {
      const event = await makeEvent(ctx.pool, orgA);
      const res = await buy(event.id, body(CARD.approveSlow, "t@example.com"));
      expect(res.statusCode).toBe(202);
      const json = res.json();
      expect(Object.keys(json).sort()).toEqual(["code", "status", "ticketId"]);
      expect(json.status).toBe("pending");
      expect(json.ticketId).toMatch(/^tkt_/);
      expect(json.code).toHaveLength(8);
      const lookup = await api("GET", `/tickets/${json.ticketId}`);
      expect(lookup.json()).toMatchObject({ status: "pending", code: json.code });
    });

    it("validates before availability, and availability before seats (422 → 404 → 409)", async () => {
      const event = await makeEvent(ctx.pool, orgA, { capacity: 1 });
      const draft = await makeEvent(ctx.pool, orgA, { capacity: 1, publish: false });
      const cancelled = await makeEvent(ctx.pool, orgA, { capacity: 1 });
      await cancelInDb(cancelled.id);
      const invalid = { error: "invalid_request" };

      const badBodies: Array<[string, string?]> = [
        ['{"cardNumber":"4000000000000001"}'],
        ['{"buyerEmail":"x@example.com"}'],
        [body(CARD.approveFast, "not-an-email")],
        [body(CARD.approveFast, "a b@example.com")],
        [body("123")],
        [body("abcdefghijklmnop")],
        [body(` ${CARD.approveFast}`)],
        [body(`${CARD.approveFast}0`)],
        ['{"buyerEmail":"x@example.com","cardNumber":4000000000000001}'],
        ['{"buyerEmail":["x@example.com"],"cardNumber":"4000000000000001"}'],
        ["[]"],
        ['"text"'],
        ["null"],
        ["42"],
        ["not json"],
        ["{"],
        [""],
        [body(CARD.approveFast), "text/plain"],
        [body(CARD.approveFast), "application/xml"],
        [
          new URLSearchParams(JSON.parse(body(CARD.approveFast))).toString(),
          "application/x-www-form-urlencoded",
        ],
      ];
      for (const [payload, type = "application/json"] of badBodies) {
        expectJson(await buy(event.id, payload, { "content-type": type }), 422, invalid);
      }

      for (const target of [draft.id, cancelled.id]) {
        expectJson(await buy(target, body("123")), 422, invalid);
        expectJson(await buy(target, body(CARD.approveFast)), 404, {
          error: "event_not_available",
        });
      }
      expectJson(await buy("evt_doesnotexist", body(CARD.approveFast)), 404, {
        error: "event_not_available",
      });

      expect((await buy(event.id, body(CARD.approveFast))).statusCode).toBe(202);
      expectJson(await buy(event.id, body(CARD.approveFast)), 409, { error: "sold_out" });
      expectJson(await buy(event.id, body("123")), 422, invalid);
      expect(await ticketCount([event.id, draft.id, cancelled.id])).toBe(1);
    });

    it("accepts application/json with a charset", async () => {
      const event = await makeEvent(ctx.pool, orgA);
      const res = await buy(event.id, body(CARD.approveFast), {
        "content-type": "application/json; charset=utf-8",
      });
      expect(res.statusCode).toBe(202);
    });

    it("stores API purchases without an account, so they are not in Meus ingressos", async () => {
      const event = await makeEvent(ctx.pool, orgA, { name: "F04 C7" });
      const res = await buy(event.id, body(CARD.approveFast, SEED.participant));
      expect(res.statusCode).toBe(202);
      const { rows } = await ctx.pool.query(
        "SELECT buyer_user_id, buyer_email, channel, code FROM tickets WHERE event_id = $1",
        [event.id],
      );
      expect(rows).toEqual([
        {
          buyer_user_id: null,
          buyer_email: SEED.participant,
          channel: "partner",
          code: res.json().code,
        },
      ]);
      const mine = await ctx.app.inject({
        method: "GET",
        url: "/my-tickets",
        headers: { cookie: p },
      });
      expect(mine.statusCode).toBe(200);
      expect(mine.body).not.toContain("F04 C7");
      expect(mine.body).not.toContain(res.json().code);
    });
  });

  describe("ticket lookup (F04-C5, C10)", () => {
    it("returns exactly the brief's fields, checkedIn from checked_in_at, 404 when unknown", async () => {
      const event = await makeEvent(ctx.pool, orgA);
      const { ticketId, code } = (await buy(event.id, body(CARD.approveSlow))).json();
      const first = await api("GET", `/tickets/${ticketId}`);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({
        ticketId,
        code,
        eventId: event.id,
        status: "pending",
        checkedIn: false,
      });
      await ctx.pool.query("UPDATE tickets SET checked_in_at = now() WHERE id = $1", [ticketId]);
      expect((await api("GET", `/tickets/${ticketId}`)).json()).toEqual({
        ticketId,
        code,
        eventId: event.id,
        status: "pending",
        checkedIn: true,
      });
      const missing = await api("GET", "/tickets/tkt_doesnotexist");
      expectJson(missing, 404, { error: "ticket_not_found" });
      expect(missing.body).toBe('{"error":"ticket_not_found"}');
    });

    it("reads storefront tickets with the code and status of Meus ingressos", async () => {
      const event = await makeEvent(ctx.pool, orgA, { name: "F04 C10" });
      const res = await ctx.app.inject({
        method: "POST",
        url: `/events/${event.id}/purchase`,
        headers: { cookie: p, ...form({ cardNumber: CARD.approveFast }).headers },
        payload: form({ cardNumber: CARD.approveFast }).payload,
      });
      expect(res.statusCode).toBe(303);
      const { rows } = await ctx.pool.query<{ id: string; code: string }>(
        "SELECT id, code FROM tickets WHERE event_id = $1",
        [event.id],
      );
      const ticket = rows[0] as { id: string; code: string };
      const confirmed = await waitFor(async () => {
        await processDueJobs(ctx.pool);
        const r = await api("GET", `/tickets/${ticket.id}`);
        return r.json().status === "confirmed" ? r.json() : null;
      });
      expect(confirmed).toEqual({
        ticketId: ticket.id,
        code: ticket.code,
        eventId: event.id,
        status: "confirmed",
        checkedIn: false,
      });
      const mine = await ctx.app.inject({
        method: "GET",
        url: "/my-tickets",
        headers: { cookie: p },
      });
      expect(mine.body).toContain("F04 C10");
      expect(mine.body).toContain(ticket.code);
      expect(mine.body).toContain("confirmado");
    });
  });

  describe("concurrency (F04-C6, C9)", () => {
    it("30 simultaneous purchases on capacity 5 give 5×202 and 25×409, twice", async () => {
      for (let round = 1; round <= 2; round++) {
        const event = await makeEvent(ctx.pool, orgA, { capacity: 5, name: `F04 burst ${round}` });
        const results = await Promise.all(
          Array.from({ length: 30 }, (_, i) =>
            buy(event.id, body(CARD.approveFast, `carga${i + 1}@example.com`)),
          ),
        );
        const codes = results.map((r) => r.statusCode).sort();
        expect(codes.filter((c) => c === 202)).toHaveLength(5);
        expect(codes.filter((c) => c === 409)).toHaveLength(25);
        expect(await ticketCount([event.id])).toBe(5);
        expect((await listing()).find((i) => i.id === event.id)?.availableSeats).toBe(0);
      }
    });

    it("an API ticket occupies the seat in both channels until the gateway declines it", async () => {
      const event = await makeEvent(ctx.pool, orgA, { capacity: 1, name: "F04 C9" });
      const { ticketId } = (await buy(event.id, body(CARD.declineSlow))).json();
      expect((await listing()).find((i) => i.id === event.id)?.availableSeats).toBe(0);
      const page = await ctx.app.inject({
        method: "GET",
        url: `/events/${event.id}`,
        headers: { cookie: p },
      });
      expect(page.body).toContain("Ingressos esgotados");

      const declined = await waitFor(async () => {
        await processDueJobs(ctx.pool);
        const r = await api("GET", `/tickets/${ticketId}`);
        return r.json().status === "declined";
      });
      expect(declined).toBe(true);
      expect((await listing()).find((i) => i.id === event.id)?.availableSeats).toBe(1);
    });
  });

  it("parsePurchaseBody keeps only the two validated fields", () => {
    expect(
      parsePurchaseBody({ buyerEmail: "a@b.co", cardNumber: CARD.approveFast, extra: 1 }),
    ).toEqual({ buyerEmail: "a@b.co", cardNumber: CARD.approveFast });
    expect(parsePurchaseBody(null)).toBeNull();
  });
});
