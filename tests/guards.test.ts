import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, login, SEED, type TestContext } from "./helpers/app.js";

describe("organizer area guard (R13)", () => {
  let ctx: TestContext;
  let participantCookie: string;
  let organizerCookie: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    participantCookie = (await login(ctx.app, SEED.participant)).cookie;
    organizerCookie = (await login(ctx.app, SEED.orgA)).cookie;
  });
  afterAll(async () => {
    await ctx.close();
  });

  for (const url of ["/organizer/events", "/organizer/anything/else"]) {
    it(`redirects visitors from ${url} to /login`, async () => {
      const res = await ctx.app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe("/login");
    });

    it(`answers 403 to participants on ${url}`, async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url,
        headers: { cookie: participantCookie },
      });
      expect(res.statusCode).toBe(403);
      expect(res.body).toContain("Acesso negado");
    });
  }

  it("lets organizers in", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/organizer/events",
      headers: { cookie: organizerCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Organizadora A");
  });

  it("gives organizers a 404 for unknown organizer paths", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/organizer/anything/else",
      headers: { cookie: organizerCookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
