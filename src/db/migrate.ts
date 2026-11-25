import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "./pool.js";

// Resolves to <repo>/migrations both from src/db (tests) and dist/db (container).
const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));
const LOCK_KEY = 72_621_001; // arbitrary constant for pg_advisory_lock

/** Applies pending migrations/*.sql in lexical order, each in its own transaction. */
export async function runMigrations(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const done = new Set(rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    client.release();
  }
  return applied;
}
