import type { Pool } from "../db/pool.js";
import { processDueJobs } from "./gateway.js";

export interface GatewayWorker {
  stop(): Promise<void>;
}

/** Polls persisted payment jobs. Jobs survive restarts because they live in the database. */
export function startGatewayWorker(pool: Pool, { intervalMs = 200 } = {}): GatewayWorker {
  let running: Promise<unknown> | null = null;
  let stopped = false;

  const tick = () => {
    if (stopped || running) return; // never overlap ticks
    running = processDueJobs(pool)
      .catch((err) => console.error("gateway worker error:", err))
      .finally(() => {
        running = null;
      });
  };

  const timer = setInterval(tick, intervalMs);
  tick();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
