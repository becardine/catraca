import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import type { FastifyInstance } from "fastify";
import type { Pool } from "../db/pool.js";
import { registerOrganizerNotFound } from "./organizer-area.js";
import { registerAuthRoutes } from "./routes.js";
import { findUserBySession, SESSION_COOKIE } from "./sessions.js";
import "./types.js";

/** Cookies, form bodies, `request.user` on every request, auth routes and the guarded /organizer 404. */
export async function registerAuth(app: FastifyInstance, deps: { pool: Pool }): Promise<void> {
  await app.register(cookie);
  await app.register(formbody);

  app.decorateRequest("user", null);
  app.addHook("onRequest", async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.user = token ? await findUserBySession(deps.pool, token) : null;
  });

  registerAuthRoutes(app, deps);
  registerOrganizerNotFound(app);
}
