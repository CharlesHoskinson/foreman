import { spawnSync } from "node:child_process";
import { access, unlink, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const requiredFiles = [
  "packages/schema/package.json",
  "packages/schema/tsconfig.json",
  "packages/domain/package.json",
  "packages/domain/tsconfig.json",
] as const;

const runArchitecture = async (
  fixtures: ReadonlyArray<{ path: string; source: string }>,
) => {
  const written: string[] = [];
  try {
    for (const fixture of fixtures) {
      await writeFile(fixture.path, fixture.source, "utf8");
      written.push(fixture.path);
    }
    return spawnSync(process.execPath, ["scripts/check-architecture.mjs"], {
      encoding: "utf8",
    });
  } finally {
    await Promise.all(written.map((path) => unlink(path)));
  }
};

describe("workspace", () => {
  for (const file of requiredFiles) {
    it("contains " + file, async () => {
      await expect(access(file)).resolves.toBeUndefined();
    });
  }

  it("rejects prohibited import forms and dependency layers", async () => {
    const result = await runArchitecture([
      {
        path: "packages/schema/src/__boundary_violations__.ts",
        source: [
          'import "effect/SideEffect";',
          'import { pipe } from "effect/Static";',
          'import DefaultEffect from "effect/Default";',
          'import type { Effect } from "effect/TypeOnly";',
          'export { Effect as ExportedEffect } from "effect/Export";',
          'void import("effect/Dynamic");',
          'import ImportEqualsEffect = require("effect/ImportEquals");',
          'require("effect/Require");',
          'import "effect";',
          'import "fs/promises";',
          'import "node:path";',
          'import "@council/domain";',
          "void pipe;",
          "void DefaultEffect;",
          "void ImportEqualsEffect;",
        ].join("\n"),
      },
      {
        path: "packages/domain/src/__boundary_violations__.ts",
        source: [
          'import "effect/DomainSideEffect";',
          'import { pipe } from "effect/DomainStatic";',
          'import DefaultEffect from "effect/DomainDefault";',
          'import type { Effect } from "effect/DomainTypeOnly";',
          'export { Effect as ExportedEffect } from "effect/DomainExport";',
          'void import("effect/DomainDynamic");',
          'import ImportEqualsEffect = require("effect/DomainImportEquals");',
          'require("effect/DomainRequire");',
          'import "path/posix";',
          'import "node:fs";',
          'import "@council/application/services";',
          'import "@council/platform-node/sqlite";',
          'import "@council/adapter-claude";',
          'import "@council/runtime-node";',
          'import "@council/mcp-server/protocol";',
          "void pipe;",
          "void DefaultEffect;",
          "void ImportEqualsEffect;",
        ].join("\n"),
      },
    ]);

    expect(result.status).toBe(1);
    for (const violation of [
      "schema-runtime-import effect/SideEffect",
      "schema-runtime-import effect/Static",
      "schema-runtime-import effect/Default",
      "schema-runtime-import effect/TypeOnly",
      "schema-runtime-import effect/Export",
      "schema-runtime-import effect/Dynamic",
      "schema-runtime-import effect/ImportEquals",
      "schema-runtime-import effect/Require",
      "schema-runtime-import effect",
      "schema-runtime-import fs/promises",
      "schema-runtime-import node:path",
      "schema-layer-import @council/domain",
      "domain-runtime-import effect/DomainSideEffect",
      "domain-runtime-import effect/DomainStatic",
      "domain-runtime-import effect/DomainDefault",
      "domain-runtime-import effect/DomainTypeOnly",
      "domain-runtime-import effect/DomainExport",
      "domain-runtime-import effect/DomainDynamic",
      "domain-runtime-import effect/DomainImportEquals",
      "domain-runtime-import effect/DomainRequire",
      "domain-runtime-import path/posix",
      "domain-runtime-import node:fs",
      "domain-layer-import @council/application/services",
      "domain-layer-import @council/platform-node/sqlite",
      "domain-layer-import @council/adapter-claude",
      "domain-layer-import @council/runtime-node",
      "domain-layer-import @council/mcp-server/protocol",
    ]) {
      expect(result.stderr).toContain(violation);
    }
  });

  it("allows comments, ordinary strings, and permitted imports", async () => {
    const result = await runArchitecture([
      {
        path: "packages/schema/src/__boundary_allowed__.ts",
        source: [
          'import * as Schema from "effect/Schema";',
          '// import "effect/Effect";',
          "const example = 'import(\"node:fs\")';",
          "void Schema;",
          "void example;",
        ].join("\n"),
      },
      {
        path: "packages/domain/src/__boundary_allowed__.ts",
        source: [
          'import type { RunId } from "@council/schema";',
          'import { runtimePolicy } from "./runtime-policy.js";',
          'export { adapterPolicy } from "./adapter-policy.js";',
          '// require("effect/Effect");',
          "const example = 'from \"node:path\"';",
          "void runtimePolicy;",
          "void example;",
        ].join("\n"),
      },
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});
