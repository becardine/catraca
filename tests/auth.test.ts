import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashToken, SESSION_COOKIE } from "../src/auth/sessions.js";
import {
  createTestApp,
  form,
  login,
  SEED,
  sessionCookie,
  type TestContext,
  uniqueEmail,
} from "./helpers/app.js";

describe("signup, login and logout", () => {
  let ctx: TestContext;
  const userCount = async () =>
    Number((await ctx.pool.query("SELECT count(*) AS n FROM users")).rows[0].n);

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it("signup creates a logged-in participant with a secure session cookie (F01-AC1)", async () => {
    const email = uniqueEmail("signup");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/signup",
      ...form({ name: "Nova Pessoa", email, password: "segredo1" }),
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/");
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie?.value).toBeTruthy();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", maxAge: 604800 });

    const home = await ctx.app.inject({
      method: "GET",
      url: "/",
      headers: { cookie: `${SESSION_COOKIE}=${cookie?.value}` },
    });
    expect(home.body).toContain("Nova Pessoa");
    const { rows } = await ctx.pool.query("SELECT role FROM users WHERE email = $1", [email]);
    expect(rows[0].role).toBe("participant");
  });

  it("rejects invalid signups without creating anything (F01-AC1)", async () => {
    const taken = uniqueEmail("taken");
    await ctx.app.inject({
      method: "POST",
      url: "/signup",
      ...form({ name: "Primeira", email: taken, password: "segredo1" }),
    });
    const before = await userCount();
    const valid = { name: "Fulano", email: uniqueEmail("bad"), password: "segredo1" };
    const cases: [Record<string, string>, string][] = [
      [{ email: valid.email, password: valid.password }, "Informe o nome."],
      [{ ...valid, name: "  " }, "Informe o nome."],
      [{ name: valid.name, password: valid.password }, "Informe um e-mail válido."],
      [{ ...valid, email: "not-an-email" }, "Informe um e-mail válido."],
      [{ name: valid.name, email: valid.email }, "A senha deve ter pelo menos 6 caracteres."],
      [{ ...valid, password: "123" }, "A senha deve ter pelo menos 6 caracteres."],
      [{ ...valid, email: taken.toUpperCase() }, "Este e-mail já está cadastrado."],
    ];
    for (const [fields, message] of cases) {
      const res = await ctx.app.inject({ method: "POST", url: "/signup", ...form(fields) });
      expect(res.statusCode, JSON.stringify(fields)).toBe(422);
      expect(res.body).toContain(message);
      expect(sessionCookie(res)).toBeUndefined();
    }
    expect(await userCount()).toBe(before);
  });

  it("ignores a role field: signup always creates a participant (F01-AC4)", async () => {
    const email = uniqueEmail("role");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/signup",
      ...form({ name: "Hacker", email, password: "segredo1", role: "organizer" }),
    });
    const { rows } = await ctx.pool.query("SELECT role FROM users WHERE email = $1", [email]);
    expect(rows[0].role).toBe("participant");
    const area = await ctx.app.inject({
      method: "GET",
      url: "/organizer/events",
      headers: { cookie: `${SESSION_COOKIE}=${sessionCookie(res)}` },
    });
    expect(area.statusCode).toBe(403);
  });

  it("logs in every seed account and redirects by role (F01-AC2)", async () => {
    const cases = [
      [SEED.orgA, "/organizer/events", "Organizadora A"],
      [SEED.orgB, "/organizer/events", "Organizador B"],
      [SEED.participant, "/", "Participante Seed"],
    ] as const;
    for (const [email, location, name] of cases) {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/login",
        ...form({ email, password: "catraca123" }),
      });
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe(location);
      const home = await ctx.app.inject({
        method: "GET",
        url: "/",
        headers: { cookie: `${SESSION_COOKIE}=${sessionCookie(res)}` },
      });
      expect(home.body).toContain(name);
    }
  });

  it("rejects wrong password and unknown e-mail the same way (F01-AC2)", async () => {
    for (const fields of [
      { email: SEED.orgA, password: "wrongpass" },
      { email: "nobody@example.com", password: "catraca123" },
    ]) {
      const res = await ctx.app.inject({ method: "POST", url: "/login", ...form(fields) });
      expect(res.statusCode).toBe(401);
      expect(res.body).toContain("E-mail ou senha inválidos");
      expect(sessionCookie(res)).toBeUndefined();
    }
  });

  it("logout deletes the session server-side (F01-AC3)", async () => {
    const { cookie, token } = await login(ctx.app, SEED.orgA);
    const res = await ctx.app.inject({ method: "POST", url: "/logout", headers: { cookie } });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/");
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBe("");

    const replay = await ctx.app.inject({
      method: "GET",
      url: "/organizer/events",
      headers: { cookie },
    });
    expect(replay.statusCode).toBe(303);
    expect(replay.headers.location).toBe("/login");
    const { rowCount } = await ctx.pool.query("SELECT 1 FROM sessions WHERE id = $1", [
      hashToken(token),
    ]);
    expect(rowCount).toBe(0);
  });

  it("stores no plain-text password (F01-AC5)", async () => {
    const { rows } = await ctx.pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email = ANY($1)",
      [[SEED.orgA, SEED.orgB, SEED.participant]],
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.password_hash.startsWith("scrypt:")).toBe(true);
      expect(r.password_hash).not.toContain("catraca123");
    }
  });
});
