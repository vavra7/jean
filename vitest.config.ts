import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/api/src/**/*.test.ts"],
    environment: "node",
    // Integration files share one real Postgres and clean up tables globally,
    // so they must run serially (one worker) to avoid cross-file clobbering.
    maxWorkers: 1,
  },
});
