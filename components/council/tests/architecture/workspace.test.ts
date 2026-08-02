import { spawnSync } from "node:child_process";
import { access, readFile, unlink, writeFile } from "node:fs/promises";
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

  it("rejects executable sidecars, computed loading, and runtime globals", async () => {
    const result = await runArchitecture([
      {
        path: "packages/schema/src/__sidecar_violation__.mjs",
        source: 'import "node:fs";',
      },
      {
        path: "packages/domain/src/__runtime_violations__.js",
        source: [
          'const moduleName = "effect/Effect";',
          "void import(moduleName);",
          "require(moduleName);",
          "void process;",
          "void Buffer;",
          "void global;",
          "void globalThis;",
          "void __dirname;",
          "void __filename;",
          "void setTimeout;",
          "void fetch;",
          "void crypto;",
          "void performance;",
          "void Date.now();",
          "void Math.random();",
          'void Date["now"]();',
          'void Math["random"]();',
          'const clockMethod = "now";',
          "void Date[clockMethod]();",
        ].join("\n"),
      },
      {
        path: "packages/domain/src/__shadowed_require__.ts",
        source: [
          "const load = (require: (value: string) => unknown, name: string) =>",
          "  require(name);",
          "void load;",
        ].join("\n"),
      },
    ]);

    expect(result.status).toBe(1);
    for (const violation of [
      "schema-runtime-import node:fs",
      "domain-nonliteral-dynamic-import",
      "domain-direct-require",
      "domain-runtime-global process",
      "domain-runtime-global Buffer",
      "domain-runtime-global global",
      "domain-runtime-global globalThis",
      "domain-runtime-global __dirname",
      "domain-runtime-global __filename",
      "domain-runtime-global setTimeout",
      "domain-runtime-global fetch",
      "domain-runtime-global crypto",
      "domain-runtime-global performance",
      "domain-runtime-access Date.now",
      "domain-runtime-access Math.random",
    ]) {
      expect(result.stderr).toContain(violation);
    }
    expect(result.stderr.match(/domain-direct-require/g)).toHaveLength(2);
    expect(
      result.stderr.match(/domain-runtime-access Date\.now/g),
    ).toHaveLength(2);
    expect(
      result.stderr.match(/domain-runtime-access Math\.random/g),
    ).toHaveLength(2);
    expect(result.stderr).toContain("domain-runtime-access Date[computed]");
  });

  it("allows property names, comments, strings, and deterministic date parsing", async () => {
    const result = await runArchitecture([
      {
        path: "packages/schema/src/__runtime_allowed__.ts",
        source: [
          "const record = { process: 1, Buffer: 2, require: 3 };",
          "void record.process;",
          "void record.Buffer;",
          "void record.require;",
          '// process Buffer require Date.now() Math.random() import("node:fs")',
          "const text = 'process Buffer require Date.now() Math.random()';",
          'const instant = Date.parse("2026-08-01T12:00:00.000Z");',
          'const date = new Date("2026-08-01T12:00:00.000Z");',
          "void text;",
          "void instant;",
          "void date;",
        ].join("\n"),
      },
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("removes Node ambient types from pure package builds", async () => {
    for (const path of [
      "packages/schema/tsconfig.json",
      "packages/domain/tsconfig.json",
    ]) {
      const config = JSON.parse(await readFile(path, "utf8")) as {
        compilerOptions?: { types?: unknown };
      };
      expect(config.compilerOptions?.types).toEqual([]);
    }
  });

  it("pins and locally executes OpenSpec in the complete verification gate", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(manifest.devDependencies["@fission-ai/openspec"]).toBe("1.7.0");
    expect(manifest.scripts.verify).toContain(
      "corepack pnpm exec openspec validate",
    );
    expect(manifest.scripts.verify).toContain("git diff HEAD --check");
  });
});
