import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import type { Pool } from "./db/pool.js";

export interface AppDeps {
  config: Config;
  pool: Pool;
}

export function buildApp({ pool }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV === "production" });

  app.get("/health", async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "db_unavailable" });
    }
  });

  return app;
}
