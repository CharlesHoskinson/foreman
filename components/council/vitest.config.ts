import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "tests/**/*.test.ts"],
    sequence: { concurrent: false },
    testTimeout: process.platform === "win32" ? 15_000 : 5_000,
  },
});
