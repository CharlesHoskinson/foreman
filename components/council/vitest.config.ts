import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "tests/**/*.test.ts"],
    sequence: { concurrent: false },
    testTimeout: 5_000,
  },
});
