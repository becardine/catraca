// Shared helpers for the harness scripts. Node built-ins only: these run before `npm install`.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

/** Runs a command with inherited stdio. Returns the exit code (never throws). */
export function run(cmd, args, { env = {}, quiet = false } = {}) {
  if (!quiet) console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
    // npm/npx are .cmd shims on Windows and need a shell there.
    shell: isWindows && (cmd === "npm" || cmd === "npx"),
  });
  if (result.error) {
    console.error(`Failed to run ${cmd}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

export function runOrExit(cmd, args, opts) {
  const code = run(cmd, args, opts);
  if (code !== 0) process.exit(code);
}

export function requireDocker() {
  const code = run("docker", ["info", "--format", "{{.ServerVersion}}"], { quiet: true });
  if (code !== 0) {
    console.error("Docker is not running. Start Docker and try again.");
    process.exit(1);
  }
}
