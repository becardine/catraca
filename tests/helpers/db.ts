import { runMigrations } from "../../src/db/migrate.js";
import { createPool, type Pool } from "../../src/db/pool.js";

/** Creates a pool on the gates database and applies migrations. Run tests via `npm run gates`. */
export async function setupTestDb(): Promise<Pool> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Run tests through `npm run gates`.");
  }
  const pool = createPool(url);
  await runMigrations(pool);
  return pool;
}
