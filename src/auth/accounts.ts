import type { Pool } from "../db/pool.js";
import { newId } from "../lib/ids.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import type { CurrentUser } from "./types.js";

export const MESSAGES = {
  nameRequired: "Informe o nome.",
  emailInvalid: "Informe um e-mail válido.",
  passwordTooShort: "A senha deve ter pelo menos 6 caracteres.",
  emailTaken: "Este e-mail já está cadastrado.",
  invalidCredentials: "E-mail ou senha inválidos",
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Used when the e-mail is unknown, so login takes the same time either way.
const DUMMY_HASH =
  "scrypt:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000";

export function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

export interface SignupInput {
  name?: unknown;
  email?: unknown;
  password?: unknown;
}

export type SignupResult = { ok: true; user: CurrentUser } | { ok: false; error: string };

/** Creates a participant. The role is hard-coded: signup can never create an organizer. */
export async function signupParticipant(pool: Pool, input: SignupInput): Promise<SignupResult> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = normalizeEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";

  if (!name) return { ok: false, error: MESSAGES.nameRequired };
  if (!EMAIL_RE.test(email)) return { ok: false, error: MESSAGES.emailInvalid };
  if (password.length < 6) return { ok: false, error: MESSAGES.passwordTooShort };

  const user: CurrentUser = { id: newId("usr"), name, email, role: "participant" };
  try {
    await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'participant')`,
      [user.id, user.name, user.email, await hashPassword(password)],
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23505")
      return { ok: false, error: MESSAGES.emailTaken };
    throw err;
  }
  return { ok: true, user };
}

/** Returns the user for valid credentials, or null (same result for unknown e-mail and wrong password). */
export async function authenticate(
  pool: Pool,
  emailInput: unknown,
  passwordInput: unknown,
): Promise<CurrentUser | null> {
  const email = normalizeEmail(emailInput);
  const password = typeof passwordInput === "string" ? passwordInput : "";
  const { rows } = await pool.query<CurrentUser & { password_hash: string }>(
    "SELECT id, name, email, role, password_hash FROM users WHERE email = $1",
    [email],
  );
  const row = rows[0];
  const valid = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !valid) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}
