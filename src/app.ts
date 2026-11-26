import Fastify, { type FastifyInstance } from "fastify";
import { registerAuth } from "./auth/plugin.js";
import { registerCheckin } from "./checkin/index.js";
import type { Config } from "./config.js";
import type { Pool } from "./db/pool.js";
import { createEventsRegistry, type EventsRegistry, registerEvents } from "./events/index.js";
import { registerTickets } from "./tickets/index.js";
import { html } from "./ui/html.js";
import { renderPage, sendPage } from "./ui/layout.js";

export interface AppDeps {
  config: Config;
  pool: Pool;
}

/** Shared by all features: the pool and F02's extension points. */
export interface FeatureDeps {
  config: Config;
  pool: Pool;
  events: EventsRegistry;
}

export async function buildApp({ config, pool }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV === "production" });
  const deps: FeatureDeps = { config, pool, events: createEventsRegistry() };

  app.get("/health", async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "db_unavailable" });
    }
  });

  // F01 — accounts and access (must come first: fills request.user for every route below).
  await registerAuth(app, deps);
  // F02 — events and storefront.
  registerEvents(app, deps);
  // F03 — purchase, gateway results, "Meus ingressos" (gateway worker starts in main.ts).
  registerTickets(app, deps);
  registerCheckin(app, deps);

  app.setNotFoundHandler((request, reply) =>
    sendPage(
      reply,
      renderPage({
        title: "Página não encontrada",
        body: html`<p>Esta página não existe.</p>`,
        user: request.user,
      }),
      404,
    ),
  );

  return app;
}
