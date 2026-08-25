import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
    // Route suites build complete Express apps and import the migration/runtime
    // graph. Bound parallelism prevents unrelated suites competing for CPU and
    // timing out on shared CI/review runners.
    maxWorkers: 4,
    minWorkers: 1,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
