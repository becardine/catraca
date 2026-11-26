import type { FastifyInstance } from "fastify";
import type { FeatureDeps } from "../app.js";
import { PARTNER_PREFIX, partnerRoutes } from "./routes.js";

export { isValidPartnerKey, requirePartnerKey } from "./auth.js";
export { parsePurchaseBody } from "./validation.js";

/** F04 — partner API (fixed contract in docs/brief.md), same purchase path as the storefront. */
export async function registerPartnerApi(app: FastifyInstance, deps: FeatureDeps): Promise<void> {
  await app.register(partnerRoutes(deps), { prefix: PARTNER_PREFIX });
}
