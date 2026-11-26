import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "../db/pool.js";
import type { CurrentUser } from "./types.js";

export const SESSION_COOKIE = "catraca_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a session and returns the raw token (to be sent only in the cookie). */
export async function createSession(pool: Pool, userId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await pool.query(
    `INSERT INTO sessions (id, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(secs => $3))`,
    [hashToken(token), userId, SESSION_TTL_SECONDS],
  );
  return token;
}

export async function findUserBySession(pool: Pool, token: string): Promise<CurrentUser | null> {
  const { rows } = await pool.query<CurrentUser>(
    `SELECT u.id, u.name, u.email, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function deleteSession(pool: Pool, token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE id = $1", [hashToken(token)]);
}
