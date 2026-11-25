import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "../src/db/pool.js";
import { runSeed, SEED_USERS } from "../src/db/seed.js";
import { verifyPassword } from "../src/lib/password.js";
import { setupTestDb } from "./helpers/db.js";

describe("seed", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = await setupTestDb();
  });
  afterAll(async () => {
    await pool.end();
  });

  it("creates two organizers and one participant and can run again without error", async () => {
    await runSeed(pool);
    const first = await pool.query("SELECT id, email FROM users ORDER BY email");
    await runSeed(pool);
    const second = await pool.query("SELECT id, email FROM users ORDER BY email");

    expect(second.rows).toEqual(first.rows); // idempotent: same users, same ids

    const { rows } = await pool.query<{ role: string; n: string }>(
      `SELECT role, count(*) AS n FROM users
        WHERE email = ANY($1) GROUP BY role ORDER BY role`,
      [SEED_USERS.map((u) => u.email)],
    );
    expect(rows).toEqual([
      { role: "organizer", n: "2" },
      { role: "participant", n: "1" },
    ]);
  });

  it("seed passwords match the documented credentials", async () => {
    for (const u of SEED_USERS) {
      const { rows } = await pool.query<{ password_hash: string }>(
        "SELECT password_hash FROM users WHERE email = $1",
        [u.email],
      );
      expect(await verifyPassword(u.password, rows[0]?.password_hash ?? "")).toBe(true);
    }
  });
});
