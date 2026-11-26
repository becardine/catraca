import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { Pool } from "../src/db/pool.js";
import { setupTestDb } from "./helpers/db.js";

describe("GET /health", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = await setupTestDb();
  });
  afterAll(async () => {
    await pool.end();
  });

  it("returns ok when the database is reachable", async () => {
    const app = await buildApp({ config: loadConfig({}), pool });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });
});
