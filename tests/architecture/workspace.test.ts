import { access, unlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const requiredFiles = [
  "packages/schema/package.json",
  "packages/schema/tsconfig.json",
  "packages/domain/package.json",
  "packages/domain/tsconfig.json",
] as const;

describe("workspace", () => {
  for (const file of requiredFiles) {
    it("contains " + file, async () => {
      await expect(access(file)).resolves.toBeUndefined();
    });
  }

  it("rejects Effect runtime imports from domain source", async () => {
    const fixture = "packages/domain/src/__boundary_violation__.ts";
    await writeFile(
      fixture,
      'import * as Effect from "effect/Effect";\nvoid Effect;\n',
      "utf8",
    );
    try {
      const result = spawnSync(
        process.execPath,
        ["scripts/check-architecture.mjs"],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("domain-runtime-import effect/Effect");
    } finally {
      await unlink(fixture);
    }
  });
});
