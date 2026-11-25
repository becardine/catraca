import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  pwd: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;
const KEY_LENGTH = 32;
const SEP = ":";

/** Format: scrypt:<saltHex>:<hashHex> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return ["scrypt", salt, hash.toString("hex")].join(SEP);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hex] = stored.split(SEP);
  if (scheme !== "scrypt" || !salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  const actual = await scrypt(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}
