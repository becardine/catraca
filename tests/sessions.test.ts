import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSession,
  deleteSession,
  findUserBySession,
  hashToken,
} from "../src/auth/sessions.js";
import type { Pool } from "../src/db/pool.js";
import { runSeed } from "../src/db/seed.js";
import { setupTestDb } from "./helpers/db.js";

describe("sessions", () => {
  let pool: Pool;
  let userId: string;

  beforeAll(async () => {
    pool = await setupTestDb();
    await runSeed(pool);
    const { rows } = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = 'org.a@catraca.test'",
    );
    userId = rows[0]?.id ?? "";
  });
  afterAll(async () => {
    await pool.end();
  });

  it("creates, finds and deletes a session, storing only the token hash", async () => {
    const token = await createSession(pool, userId);
    expect(token.length).toBeGreaterThanOrEqual(32);

    const raw = await pool.query("SELECT 1 FROM sessions WHERE id = $1", [token]);
    expect(raw.rowCount).toBe(0);
    const hashed = await pool.query("SELECT 1 FROM sessions WHERE id = $1", [hashToken(token)]);
    expect(hashed.rowCount).toBe(1);

    expect((await findUserBySession(pool, token))?.email).toBe("org.a@catraca.test");
    await deleteSession(pool, token);
    expect(await findUserBySession(pool, token)).toBeNull();
  });

  it("ignores expired and unknown sessions", async () => {
    const token = await createSession(pool, userId);
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = $1", [
      hashToken(token),
    ]);
    expect(await findUserBySession(pool, token)).toBeNull();
    expect(await findUserBySession(pool, "does-not-exist")).toBeNull();
  });
});
