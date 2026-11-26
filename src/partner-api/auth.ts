import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export const PARTNER_KEY_HEADER = "x-api-key";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** Constant-time comparison; hashing first keeps the time independent of the lengths too. */
export function isValidPartnerKey(given: unknown, expected: string): boolean {
  if (typeof given !== "string" || given === "" || expected === "") return false;
  return timingSafeEqual(digest(given), digest(expected));
}

/** `onRequest` hook for the /api/partner scope: runs before body parsing, routing errors and 404s. */
export function requirePartnerKey(expected: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isValidPartnerKey(request.headers[PARTNER_KEY_HEADER], expected)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  };
}
