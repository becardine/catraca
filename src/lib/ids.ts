import { randomBytes } from "node:crypto";

// Alphabet without ambiguous characters (no 0/O, 1/I/L, U).
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function randomToken(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  return out;
}

/** Public string IDs with a type prefix, e.g. usr_7kq2m9xa4b, evt_..., tkt_... */
export function newId(prefix: string): string {
  return `${prefix}_${randomToken(10).toLowerCase()}`;
}
