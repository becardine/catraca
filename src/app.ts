import Fastify, { type FastifyInstance } from "fastify";
import { registerAuth } from "./auth/plugin.js";
import type { Config } from "./config.js";
import type { Pool } from "./db/pool.js";
import { html } from "./ui/html.js";
import { renderPage, sendPage } from "./ui/layout.js";
import { registerPlaceholders } from "./ui/placeholders.js";

export interface AppDeps {
  config: Config;
  pool: Pool;
}

export async function buildApp({ pool }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV === "production" });

  app.get("/health", async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "db_unavailable" });
    }
  });

  // F01 — accounts and access (must come first: fills request.user for every route below).
  await registerAuth(app, { pool });
  registerPlaceholders(app);

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
