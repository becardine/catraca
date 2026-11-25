// npm run down — stops and removes every container/network that `up` (and `gates`) started.
// Data is kept in the volume. Use `npm run down -- --reset` to also drop the database volume.
import { requireDocker, runOrExit } from "./lib.mjs";

const reset = process.argv.includes("--reset");

requireDocker();
runOrExit("docker", ["compose", "down", "--remove-orphans", ...(reset ? ["--volumes"] : [])]);
// Defensive: also clean the isolated gates stack in case a gates run was interrupted.
runOrExit("docker", [
  "compose",
  "-f",
  "docker-compose.gates.yml",
  "down",
  "--remove-orphans",
  "--volumes",
]);

console.log(reset ? "\nCatraca is down (database reset)." : "\nCatraca is down.");
