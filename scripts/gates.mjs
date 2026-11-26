// npm run gates — the project's quality gates. Must pass before any feature is "done".
//   1. install deps if missing   2. lint (biome)   3. typecheck (tsc)   4. build
//   5. automated tests (vitest) against an ISOLATED Postgres (compose project "catraca-gates"),
//      so gates never touch the data of a running `npm run up` stack.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, requireDocker, run, runOrExit } from "./lib.mjs";

const GATES_DB_PORT = process.env.GATES_DB_PORT ?? "55433";
// GATES_PROJECT lets parallel worktrees run gates at the same time (each with its own GATES_DB_PORT).
const GATES_PROJECT = process.env.GATES_PROJECT ?? "catraca-gates";
const compose = ["compose", "-p", GATES_PROJECT, "-f", "docker-compose.gates.yml"];
const steps = [];

function step(name, fn) {
  const code = fn();
  steps.push({ name, ok: code === 0 });
  if (code !== 0) finish(code);
}

function finish(code) {
  run("docker", [...compose, "down", "--remove-orphans", "--volumes"], { quiet: true });
  console.log("\n=== Gates summary ===");
  for (const s of steps) console.log(`${s.ok ? "PASS" : "FAIL"}  ${s.name}`);
  console.log(code === 0 ? "\nAll gates passed." : "\nGates FAILED.");
  process.exit(code);
}

requireDocker();
if (!existsSync(join(ROOT, "node_modules"))) runOrExit("npm", ["ci"]);

step("lint", () => run("npx", ["biome", "check", "."]));
step("typecheck", () => run("npx", ["tsc", "--noEmit"]));
step("build", () => run("npm", ["run", "build"]));
step("test db up", () =>
  run("docker", [...compose, "up", "-d", "--wait", "db"], { env: { GATES_DB_PORT } }),
);
step("tests", () =>
  run("npx", ["vitest", "run"], {
    env: {
      TEST_DATABASE_URL: `postgres://catraca:catraca@localhost:${GATES_DB_PORT}/catraca`,
      // Speeds up the simulated gateway in tests only; the product default stays 1.
      GATEWAY_DELAY_SCALE: "0.01",
    },
  }),
);
finish(0);
