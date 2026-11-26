import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toLocalInput } from "../src/lib/format.js";
import { createTestApp, form, login, SEED, type TestContext } from "./helpers/app.js";

const nextMonth = () => toLocalInput(new Date(Date.now() + 30 * 86_400_000));
const yesterday = () => toLocalInput(new Date(Date.now() - 86_400_000));

describe("event pages (F02)", () => {
  let ctx: TestContext;
  let a: string;
  let b: string;
  let p: string;

  const fields = (over: Record<string, string> = {}) => ({
    name: `Jazz ${Math.random().toString(36).slice(2, 8)}`,
    venue: "Bar do Zé",
    startsAt: nextMonth(),
    capacity: "2",
    price: "100,00",
    ...over,
  });

  async function create(cookie: string, over: Record<string, string> = {}) {
    const f = fields(over);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/organizer/events",
      headers: { cookie, ...form(f).headers },
      payload: form(f).payload,
    });
    expect(res.statusCode).toBe(303);
    const id = /\/organizer\/events\/(evt_[a-z0-9]+)/.exec(res.headers.location as string)?.[1];
    return { id: id as string, ...f };
  }

  const get = (url: string, cookie?: string) =>
    ctx.app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });
  const post = (url: string, cookie: string, f: Record<string, string> = {}) =>
    ctx.app.inject({
      method: "POST",
      url,
      headers: { cookie, ...form(f).headers },
      payload: form(f).payload,
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    a = (await login(ctx.app, SEED.orgA)).cookie;
    b = (await login(ctx.app, SEED.orgB)).cookie;
    p = (await login(ctx.app, SEED.participant)).cookie;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it("creates a draft with its own management page (F02-AC1, AC4)", async () => {
    const e = await create(a);
    const page = await get(`/organizer/events/${e.id}`, a);
    expect(page.statusCode).toBe(200);
    for (const text of [
      e.name,
      "Bar do Zé",
      "R$ 100,00",
      "Rascunho",
      "Publicar",
      "Salvar alterações",
    ]) {
      expect(page.body).toContain(text);
    }
    const { rows } = await ctx.pool.query(
      "SELECT status, capacity, price_cents FROM events WHERE id = $1",
      [e.id],
    );
    expect(rows[0]).toEqual({ status: "draft", capacity: 2, price_cents: 10000 });
  });

  it("rejects invalid creates with 422 and saves nothing (F02-AC1, AC2)", async () => {
    const count = async () =>
      Number((await ctx.pool.query("SELECT count(*) AS n FROM events")).rows[0].n);
    const before = await count();
    const cases: [Record<string, string>, string][] = [
      [{ name: "" }, "Informe o nome do evento."],
      [{ venue: "" }, "Informe o local do evento."],
      [{ startsAt: "amanhã" }, "Informe a data e a hora de início."],
      [{ capacity: "0" }, "A lotação deve ser um número inteiro maior ou igual a 1."],
      [{ capacity: "2.5" }, "A lotação deve ser um número inteiro maior ou igual a 1."],
      [{ price: "0" }, "O preço deve ser maior que zero."],
      [{ price: "-5" }, "O preço deve ser maior que zero."],
      [{ price: "abc" }, "Informe um preço válido."],
      [{ startsAt: yesterday() }, "A data de início precisa estar no futuro."],
    ];
    for (const [over, message] of cases) {
      const res = await post("/organizer/events", a, fields(over));
      expect(res.statusCode, JSON.stringify(over)).toBe(422);
      expect(res.body).toContain(message);
    }
    const { startsAt: _omit, ...withoutStart } = fields();
    const missing = await post("/organizer/events", a, withoutStart);
    expect(missing.statusCode).toBe(422);
    expect(missing.body).toContain("Informe a data e a hora de início.");
    expect(await count()).toBe(before);
  });

  it("rejects a past date on edit and keeps the event unchanged (F02-AC2)", async () => {
    const e = await create(a);
    const before = (await ctx.pool.query("SELECT starts_at FROM events WHERE id = $1", [e.id]))
      .rows[0];
    const res = await post(`/organizer/events/${e.id}`, a, { ...e, startsAt: yesterday() });
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("A data de início precisa estar no futuro.");
    const after = (await ctx.pool.query("SELECT starts_at FROM events WHERE id = $1", [e.id]))
      .rows[0];
    expect(after).toEqual(before);
  });

  it("drafts are hidden; published events appear on the storefront (F02-AC3, AC4)", async () => {
    const e = await create(a);
    expect((await get("/")).body).not.toContain(e.name);
    expect((await get(`/events/${e.id}`)).statusCode).toBe(404);

    expect((await post(`/organizer/events/${e.id}/publish`, a)).statusCode).toBe(303);
    const home = await get("/");
    for (const text of [e.name, "Bar do Zé", "R$ 100,00"]) expect(home.body).toContain(text);
    const page = await get(`/events/${e.id}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(e.name);

    const mgmt = await get(`/organizer/events/${e.id}`, a);
    expect(mgmt.body).toContain("Publicado");
    expect(mgmt.body).not.toContain(`/organizer/events/${e.id}/publish`);
    expect((await post(`/organizer/events/${e.id}/publish`, a)).statusCode).toBe(409);
  });

  it("other organizers see and change nothing (F02-AC5)", async () => {
    const e = await create(a);
    const secrets = [e.name, "Bar do Zé", "R$ 100,00", `/organizer/events/${e.id}`];
    const list = await get("/organizer/events", b);
    expect(list.body).not.toContain(e.name);
    const responses = [
      await get(`/organizer/events/${e.id}`, b),
      await post(`/organizer/events/${e.id}`, b, { ...e, name: "Hacked" }),
      await post(`/organizer/events/${e.id}/publish`, b),
    ];
    for (const res of responses) {
      expect(res.statusCode).toBe(404);
      for (const s of secrets) expect(res.body).not.toContain(s);
    }
    const { rows } = await ctx.pool.query("SELECT name, status FROM events WHERE id = $1", [e.id]);
    expect(rows[0]).toEqual({ name: e.name, status: "draft" });
  });

  it("accepts price edits and capacity increases everywhere (F02-AC6)", async () => {
    const e = await create(a);
    await post(`/organizer/events/${e.id}/publish`, a);
    const res = await post(`/organizer/events/${e.id}`, a, {
      ...e,
      price: "150,00",
      capacity: "3",
    });
    expect(res.statusCode).toBe(303);
    for (const page of [await get(`/organizer/events/${e.id}`, a), await get(`/events/${e.id}`)]) {
      expect(page.body).toContain("R$ 150,00");
    }
    const home = (await get("/")).body;
    const item = home.slice(home.indexOf(e.name), home.indexOf("</li>", home.indexOf(e.name)));
    expect(item).toContain("R$ 150,00");
    expect(item).not.toContain("R$ 100,00");
    const { rows } = await ctx.pool.query(
      "SELECT capacity, price_cents FROM events WHERE id = $1",
      [e.id],
    );
    expect(rows[0]).toEqual({ capacity: 3, price_cents: 15000 });
  });

  it("X-F01-F02-1: visitors and participants cannot reach a real event (R13)", async () => {
    const e = await create(a);
    const visitor = await get(`/organizer/events/${e.id}`);
    expect(visitor.statusCode).toBe(303);
    expect(visitor.headers.location).toBe("/login");
    const participant = await get(`/organizer/events/${e.id}`, p);
    expect(participant.statusCode).toBe(403);
    for (const res of [visitor, participant]) expect(res.body).not.toContain(e.name);
  });
});
