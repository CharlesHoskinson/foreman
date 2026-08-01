import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const requiredFiles = [
  "packages/schema/package.json",
  "packages/schema/tsconfig.json",
  "packages/domain/package.json",
  "packages/domain/tsconfig.json",
  "packages/domain/src/index.ts",
] as const;

describe("workspace", () => {
  for (const file of requiredFiles) {
    it("contains " + file, async () => {
      await expect(access(file)).resolves.toBeUndefined();
    });
  }
});
