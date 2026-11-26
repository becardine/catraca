import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { createPool } from "./db/pool.js";
import { runSeed } from "./db/seed.js";
import { startGatewayWorker } from "./gateway/worker.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);

await runMigrations(pool);
await runSeed(pool);

const app = await buildApp({ config, pool });
await app.listen({ port: config.port, host: config.host });

// Simulated gateway: resolves persisted payment jobs (also the ones left before a restart).
const worker = startGatewayWorker(pool);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    await worker.stop();
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
