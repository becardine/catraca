import type { FastifyInstance } from "fastify";
import type { Pool } from "../db/pool.js";
import { registerOrganizerEventRoutes } from "./organizer-routes.js";
import type { EventsRegistry } from "./sections.js";
import { registerStorefrontRoutes } from "./storefront-routes.js";

export * from "./events.js";
export * from "./sections.js";

/** F02 — event management (organizer area) and storefront listing. */
export function registerEvents(
  app: FastifyInstance,
  deps: { pool: Pool; events: EventsRegistry },
): void {
  registerStorefrontRoutes(app, deps);
  registerOrganizerEventRoutes(app, deps);
}
