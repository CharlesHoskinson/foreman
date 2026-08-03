import { spawn, spawnSync } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const requiredFiles = [
  "packages/schema/package.json",
  "packages/schema/tsconfig.json",
  "packages/domain/package.json",
  "packages/domain/tsconfig.json",
  "packages/application/package.json",
  "packages/application/tsconfig.json",
  "packages/platform-node/package.json",
  "packages/platform-node/tsconfig.json",
  "packages/adapter-grok/package.json",
  "packages/adapter-grok/tsconfig.json",
  "packages/adapter-claude/package.json",
  "packages/adapter-claude/tsconfig.json",
] as const;

const packageRoots = [
  "packages/schema/src",
  "packages/domain/src",
  "packages/application/src",
  "packages/application/test",
  "packages/platform-node/src",
  "packages/adapter-grok/src",
  "packages/adapter-claude/src",
] as const;

/**
 * Run the architecture checker in an isolated temporary workspace.
 * Fixtures never enter the live repository source directories.
 */
const runArchitectureIsolated = async (
  fixtures: ReadonlyArray<{ path: string; source: string }>,
) => {
  const workspace = await mkdtemp(join(tmpdir(), "council-arch-"));
  try {
    for (const root of packageRoots) {
      await mkdir(join(workspace, root), { recursive: true });
      // Copy real package sources so the checker has a complete tree.
      const sourceRoot = join(process.cwd(), root);
      // A failed source copy must fail the test — never suppress copy failures.
      await cp(sourceRoot, join(workspace, root), {
        recursive: true,
        filter: (src) => {
          // Skip any leftover violation fixtures if present
          const base = src.split("/").pop() ?? "";
          return (
            !base.startsWith("__boundary") &&
            !base.startsWith("__sidecar") &&
            !base.startsWith("__runtime") &&
            !base.startsWith("__shadowed")
          );
        },
      });
    }
    await mkdir(join(workspace, "scripts"), { recursive: true });
    await cp(
      join(process.cwd(), "scripts/check-architecture.mjs"),
      join(workspace, "scripts/check-architecture.mjs"),
    );
    // ESM package resolution needs node_modules in the workspace tree.
    await symlink(
      join(process.cwd(), "node_modules"),
      join(workspace, "node_modules"),
      "dir",
    );
    for (const fixture of fixtures) {
      const full = join(workspace, fixture.path);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, fixture.source, "utf8");
    }
    return spawnSync(process.execPath, ["scripts/check-architecture.mjs"], {
      encoding: "utf8",
      cwd: workspace,
    });
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
};

describe("workspace", () => {
  for (const file of requiredFiles) {
    it("contains " + file, async () => {
      await expect(access(file)).resolves.toBeUndefined();
    });
  }

  it("rejects prohibited import forms and dependency layers", async () => {
    const result = await runArchitectureIsolated([
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
      {
        path: "packages/application/src/__boundary_violations__.ts",
        source: [
          'import "node:fs";',
          'import "@council/platform-node";',
          'import "@council/adapter-claude";',
          'import "@council/runtime-node";',
          'import "@council/mcp-server";',
        ].join("\n"),
      },
      {
        path: "packages/platform-node/src/__boundary_violations__.ts",
        source: [
          'import "@council/domain";',
          'import "@council/adapter-claude";',
          'import "@council/runtime-node";',
          'import "@council/mcp-server";',
        ].join("\n"),
      },
      {
        path: "packages/adapter-grok/src/__boundary_violations__.ts",
        source: [
          'import "node:fs";',
          'import "@council/domain";',
          'import "@council/platform-node";',
          'import "@council/runtime-node";',
          'import "@council/mcp-server";',
          'import "@council/adapter-claude";',
        ].join("\n"),
      },
      {
        path: "packages/adapter-claude/src/__boundary_violations__.ts",
        source: [
          'import "node:fs";',
          'import "@council/domain";',
          'import "@council/platform-node";',
          'import "@council/runtime-node";',
          'import "@council/mcp-server";',
          'import "@council/adapter-grok";',
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
      "application-runtime-import node:fs",
      "application-layer-import @council/platform-node",
      "application-layer-import @council/adapter-claude",
      "application-layer-import @council/runtime-node",
      "application-layer-import @council/mcp-server",
      "platform-node-layer-import @council/domain",
      "platform-node-layer-import @council/adapter-claude",
      "platform-node-layer-import @council/runtime-node",
      "platform-node-layer-import @council/mcp-server",
      "adapter-grok-runtime-import node:fs",
      "adapter-grok-layer-import @council/domain",
      "adapter-grok-layer-import @council/platform-node",
      "adapter-grok-layer-import @council/runtime-node",
      "adapter-grok-layer-import @council/mcp-server",
      "adapter-grok-layer-import @council/adapter-claude",
      "adapter-claude-runtime-import node:fs",
      "adapter-claude-layer-import @council/domain",
      "adapter-claude-layer-import @council/platform-node",
      "adapter-claude-layer-import @council/runtime-node",
      "adapter-claude-layer-import @council/mcp-server",
      "adapter-claude-layer-import @council/adapter-grok",
    ]) {
      expect(result.stderr).toContain(violation);
    }
  });

  it("allows comments, ordinary strings, and permitted imports", async () => {
    const result = await runArchitectureIsolated([
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
      {
        path: "packages/application/src/__boundary_allowed__.ts",
        source: [
          'import { Effect } from "effect";',
          'import type { RunId } from "@council/schema";',
          'import { parseCouncilAce } from "@council/domain";',
          "void Effect;",
          "void parseCouncilAce;",
        ].join("\n"),
      },
      {
        path: "packages/platform-node/src/__boundary_allowed__.ts",
        source: [
          'import { readFile } from "node:fs/promises";',
          'import { Effect } from "effect";',
          'import type { ArtifactReader } from "@council/application";',
          'import type { Sha256Digest } from "@council/schema";',
          "void readFile;",
          "void Effect;",
        ].join("\n"),
      },
      {
        path: "packages/adapter-grok/src/__boundary_allowed__.ts",
        source: [
          'import type { ProviderProcessRequest } from "@council/application";',
          'import type { TerminalObservationV1 } from "@council/schema";',
          "type _Keep = ProviderProcessRequest | TerminalObservationV1;",
          "const keep = null as unknown as _Keep;",
          "void keep;",
        ].join("\n"),
      },
      {
        path: "packages/adapter-claude/src/__boundary_allowed__.ts",
        source: [
          'import type { ProviderProcessRequest } from "@council/application";',
          'import type { TerminalObservationV1 } from "@council/schema";',
          "type _Keep = ProviderProcessRequest | TerminalObservationV1;",
          "const keep = null as unknown as _Keep;",
          "void keep;",
        ].join("\n"),
      },
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("rejects executable sidecars, computed loading, and runtime globals", async () => {
    const result = await runArchitectureIsolated([
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
    const result = await runArchitectureIsolated([
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

  it("rejects Node built-ins and platform imports from application tests", async () => {
    const result = await runArchitectureIsolated([
      {
        path: "packages/application/test/__boundary_violations__.ts",
        source: [
          'import { createHash } from "node:crypto";',
          'import { materializePromptBytes } from "@council/platform-node";',
          "void createHash;",
          "void materializePromptBytes;",
        ].join("\n"),
      },
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("application-runtime-import node:crypto");
    expect(result.stderr).toContain(
      "application-layer-import @council/platform-node",
    );
  });

  it("runs allowed and rejecting fixtures concurrently without cross-observation", async () => {
    const barrierPath = join(
      await mkdtemp(join(tmpdir(), "council-arch-barrier-")),
      "ready",
    );

    const prepareWorkspace = async (
      fixtures: ReadonlyArray<{ path: string; source: string }>,
    ) => {
      const workspace = await mkdtemp(join(tmpdir(), "council-arch-par-"));
      for (const root of packageRoots) {
        await mkdir(join(workspace, root), { recursive: true });
        // A failed source copy must fail the test — never suppress copy failures.
        await cp(join(process.cwd(), root), join(workspace, root), {
          recursive: true,
          filter: (src) => {
            const base = src.split("/").pop() ?? "";
            return (
              !base.startsWith("__boundary") &&
              !base.startsWith("__sidecar") &&
              !base.startsWith("__runtime") &&
              !base.startsWith("__shadowed")
            );
          },
        });
      }
      await mkdir(join(workspace, "scripts"), { recursive: true });
      await cp(
        join(process.cwd(), "scripts/check-architecture.mjs"),
        join(workspace, "scripts/check-architecture.mjs"),
      );
      await symlink(
        join(process.cwd(), "node_modules"),
        join(workspace, "node_modules"),
        "dir",
      );
      for (const fixture of fixtures) {
        const full = join(workspace, fixture.path);
        await mkdir(join(full, ".."), { recursive: true });
        await writeFile(full, fixture.source, "utf8");
      }
      // Marker unique to this workspace for cross-observation proof
      await writeFile(
        join(workspace, "packages/schema/src/__workspace_marker__.txt"),
        workspace,
        "utf8",
      );
      return workspace;
    };

    const allowedWs = await prepareWorkspace([
      {
        path: "packages/schema/src/__boundary_allowed__.ts",
        source: [
          'import * as Schema from "effect/Schema";',
          "void Schema;",
        ].join("\n"),
      },
    ]);
    const rejectingWs = await prepareWorkspace([
      {
        path: "packages/schema/src/__boundary_violations__.ts",
        source: 'import "node:fs";',
      },
    ]);

    const barrierDir = join(barrierPath, "..");
    let scriptPath: string | undefined;
    try {
      // Deterministic barrier: both children write then spin until both markers exist.
      // Each child returns barrierSatisfied so the parent can prove overlap.
      const childScript = `
        import { writeFileSync, existsSync, readFileSync } from "node:fs";
        import { spawnSync } from "node:child_process";
        // argv: [node, script, workspace, barrier, role]
        const workspace = process.argv[2];
        const barrier = process.argv[3];
        const role = process.argv[4];
        writeFileSync(barrier + "." + role, String(Date.now()));
        const start = Date.now();
        let barrierSatisfied = false;
        while (Date.now() - start < 10000) {
          if (existsSync(barrier + ".allowed") && existsSync(barrier + ".rejecting")) {
            barrierSatisfied = true;
            break;
          }
        }
        const result = spawnSync(process.execPath, ["scripts/check-architecture.mjs"], {
          encoding: "utf8",
          cwd: workspace,
        });
        const marker = readFileSync(workspace + "/packages/schema/src/__workspace_marker__.txt", "utf8");
        process.stdout.write(JSON.stringify({
          status: result.status,
          stderr: result.stderr,
          marker,
          role,
          barrierSatisfied,
          readyAt: Number(readFileSync(barrier + "." + role, "utf8")),
        }));
      `;
      scriptPath = join(
        tmpdir(),
        `council-arch-child-${String(Date.now())}.mjs`,
      );
      await writeFile(scriptPath, childScript, "utf8");
      const activeScriptPath = scriptPath;

      const runChild = (workspace: string, role: string) =>
        new Promise<{
          status: number | null;
          stderr: string;
          marker: string;
          role: string;
          barrierSatisfied: boolean;
          readyAt: number;
        }>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [activeScriptPath, workspace, barrierPath, role],
            {
              env: { ...process.env },
            },
          );
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString("utf8");
          });
          child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
          });
          child.on("error", reject);
          child.on("close", () => {
            try {
              resolve(
                JSON.parse(stdout) as {
                  status: number | null;
                  stderr: string;
                  marker: string;
                  role: string;
                  barrierSatisfied: boolean;
                  readyAt: number;
                },
              );
            } catch (error) {
              reject(
                new Error(
                  `child ${role} bad output: ${stdout} stderr=${stderr} err=${String(error)}`,
                ),
              );
            }
          });
        });

      const [allowedResult, rejectingResult] = await Promise.all([
        runChild(allowedWs, "allowed"),
        runChild(rejectingWs, "rejecting"),
      ]);

      expect(allowedResult.barrierSatisfied).toBe(true);
      expect(rejectingResult.barrierSatisfied).toBe(true);
      // Overlap evidence: both children were ready before either finished the barrier wait.
      expect(Number.isFinite(allowedResult.readyAt)).toBe(true);
      expect(Number.isFinite(rejectingResult.readyAt)).toBe(true);
      expect(
        Math.abs(allowedResult.readyAt - rejectingResult.readyAt),
      ).toBeLessThan(10_000);

      expect(allowedResult.status).toBe(0);
      expect(allowedResult.stderr).toBe("");
      expect(rejectingResult.status).toBe(1);
      expect(rejectingResult.stderr).toContain("schema-runtime-import node:fs");
      // Neither process observes the other's workspace marker
      expect(allowedResult.marker).toBe(allowedWs);
      expect(rejectingResult.marker).toBe(rejectingWs);
      expect(allowedResult.stderr).not.toContain(rejectingWs);
      expect(rejectingResult.stderr).not.toContain(allowedWs);
      // Live repo source must not gain fixture files
      await expect(
        access("packages/schema/src/__boundary_violations__.ts"),
      ).rejects.toBeTruthy();
      await expect(
        access("packages/schema/src/__boundary_allowed__.ts"),
      ).rejects.toBeTruthy();
    } finally {
      // Best-effort cleanup: child script, barrier directory, and workspaces.
      // Fixtures never enter repository source directories; a killed test can
      // leave only external temporary directories.
      await rm(allowedWs, { recursive: true, force: true }).catch(
        () => undefined,
      );
      await rm(rejectingWs, { recursive: true, force: true }).catch(
        () => undefined,
      );
      if (scriptPath !== undefined) {
        await rm(scriptPath, { force: true }).catch(() => undefined);
      }
      await rm(barrierDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  });

  it("removes Node ambient types from pure package builds", async () => {
    for (const path of [
      "packages/schema/tsconfig.json",
      "packages/domain/tsconfig.json",
      "packages/application/tsconfig.json",
      "packages/adapter-grok/tsconfig.json",
      "packages/adapter-claude/tsconfig.json",
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
