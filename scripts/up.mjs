// npm run up — builds and starts the whole stack (db + app). The app applies migrations
// and the seed on every start, so a clean clone needs no other step.
import { requireDocker, runOrExit } from "./lib.mjs";

requireDocker();
runOrExit("docker", ["compose", "up", "-d", "--build", "--wait"]);

const port = process.env.APP_PORT ?? "3000";
console.log(`
Catraca is up.
  WEB: http://localhost:${port}
  API: http://localhost:${port}/api/partner
Stop with: npm run down`);
