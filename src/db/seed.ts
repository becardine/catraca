import { newId } from "../lib/ids.js";
import { hashPassword } from "../lib/password.js";
import type { Pool } from "./pool.js";

export interface SeedUser {
  name: string;
  email: string;
  password: string;
  role: "organizer" | "participant";
}

/** Single source of truth for seed credentials (also documented in README.md). */
export const SEED_USERS: readonly SeedUser[] = [
  {
    name: "Organizadora A",
    email: "org.a@catraca.test",
    password: "catraca123",
    role: "organizer",
  },
  { name: "Organizador B", email: "org.b@catraca.test", password: "catraca123", role: "organizer" },
  {
    name: "Participante Seed",
    email: "participante@catraca.test",
    password: "catraca123",
    role: "participant",
  },
];

/** Idempotent: safe to run on every start. Resets seed users' name/password/role, keeps their id. */
export async function runSeed(pool: Pool): Promise<void> {
  for (const u of SEED_USERS) {
    await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
      [newId("usr"), u.name, u.email, await hashPassword(u.password), u.role],
    );
  }
}
