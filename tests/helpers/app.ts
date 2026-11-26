import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../../src/app.js";
import { SESSION_COOKIE } from "../../src/auth/sessions.js";
import { loadConfig } from "../../src/config.js";
import type { Pool } from "../../src/db/pool.js";
import { runSeed, SEED_USERS } from "../../src/db/seed.js";
import { randomToken } from "../../src/lib/ids.js";
import { setupTestDb } from "./db.js";

export interface TestContext {
  app: FastifyInstance;
  pool: Pool;
  close: () => Promise<void>;
}

/** App wired to the gates database, with migrations and seed applied. */
export async function createTestApp(): Promise<TestContext> {
  const pool = await setupTestDb();
  await runSeed(pool);
  const app = await buildApp({ config: loadConfig({ GATEWAY_DELAY_SCALE: "0.01" }), pool });
  await app.ready();
  return {
    app,
    pool,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

export function uniqueEmail(prefix = "t"): string {
  return `${prefix}-${randomToken(10).toLowerCase()}@example.com`;
}

/** application/x-www-form-urlencoded body. */
export function form(fields: Record<string, string>): {
  payload: string;
  headers: Record<string, string>;
} {
  return {
    payload: new URLSearchParams(fields).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  };
}

export function sessionCookie(res: LightMyRequestResponse): string | undefined {
  return res.cookies.find((c) => c.name === SESSION_COOKIE && c.value !== "")?.value;
}

/** Logs in and returns a Cookie header value for later requests. */
export async function login(app: FastifyInstance, email: string, password = SEED_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/login", ...form({ email, password }) });
  const token = sessionCookie(res);
  if (!token) throw new Error(`login failed for ${email}: ${res.statusCode}`);
  return { cookie: `${SESSION_COOKIE}=${token}`, token };
}

export const SEED = {
  orgA: "org.a@catraca.test",
  orgB: "org.b@catraca.test",
  participant: "participante@catraca.test",
} as const;

/** Seed password read from the seed itself (no literal secrets in tests). */
export const SEED_PASSWORD = SEED_USERS[0]?.password ?? "";

/** Random password for accounts created during a test run. */
export const NEW_PASSWORD = `pw-${randomToken(12)}`;
