import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Tests share one Postgres database; run files serially to avoid cross-test interference.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
