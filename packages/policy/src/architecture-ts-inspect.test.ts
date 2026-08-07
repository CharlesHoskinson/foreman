import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspectTypeScriptSource } from "./architecture-ts-inspect.js";

describe("inspectTypeScriptSource", () => {
  it("rejects Bun-only import and API", () => {
    assert.equal(
      inspectTypeScriptSource(
        "a.ts",
        `import { spawn } from "bun";\nexport const x = 1;\n`,
      ),
      "prohibited_bun_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "b.ts",
        `const p = Bun.spawn({ cmd: ["echo"] });\n`,
      ),
      "prohibited_bun_only",
    );
  });

  it("rejects Deno-only API", () => {
    assert.equal(
      inspectTypeScriptSource("c.ts", `const env = Deno.env.get("X");\n`),
      "prohibited_deno_only",
    );
  });

  it("ignores Bun and Deno inside comments, strings, and regex literals", () => {
    assert.equal(
      inspectTypeScriptSource(
        "d.ts",
        [
          `// import from "bun"`,
          `/* Deno.env.get("x") */`,
          `const s = "Bun.spawn is not used";`,
          `const t = 'from "bun"';`,
          `const r = /Bun.spawn/;`,
          `const r2 = /Deno.env/;`,
          `export const ok = 1;`,
          ``,
        ].join("\n"),
      ),
      null,
    );
  });

  it("accepts ordinary strict Node TypeScript", () => {
    assert.equal(
      inspectTypeScriptSource(
        "e.ts",
        [
          `import { readFileSync } from "node:fs";`,
          `import { Effect } from "effect";`,
          `export function f(p: string): string {`,
          `  return readFileSync(p, "utf8");`,
          `}`,
          ``,
        ].join("\n"),
      ),
      null,
    );
  });

  it("rejects Bun alias, optional chain, computed member, and template expression", () => {
    assert.equal(
      inspectTypeScriptSource("alias.ts", `const X = Bun; X.spawn();\n`),
      "prohibited_bun_only",
    );
    assert.equal(
      inspectTypeScriptSource("opt.ts", `Bun?.spawn();\n`),
      "prohibited_bun_only",
    );
    assert.equal(
      inspectTypeScriptSource("comp.ts", `Bun["spawn"]();\n`),
      "prohibited_bun_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "tmpl.ts",
        "const x = `${Bun.spawn()}`;\n",
      ),
      "prohibited_bun_only",
    );
  });

  it("rejects Deno alias, optional chain, computed member, and template expression", () => {
    assert.equal(
      inspectTypeScriptSource("dalias.ts", `const D = Deno; D.env.get("X");\n`),
      "prohibited_deno_only",
    );
    assert.equal(
      inspectTypeScriptSource("dopt.ts", `Deno?.env;\n`),
      "prohibited_deno_only",
    );
    assert.equal(
      inspectTypeScriptSource("dcomp.ts", `Deno["env"];\n`),
      "prohibited_deno_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "dtmpl.ts",
        "const x = `${Deno.env.get(\"X\")}`;\n",
      ),
      "prohibited_deno_only",
    );
  });

  it("does not treat regex literal text as a Bun reference", () => {
    assert.equal(
      inspectTypeScriptSource("re.ts", `const r = /Bun.spawn/;\nexport const n = 1;\n`),
      null,
    );
  });

  it("fails closed on invalid TypeScript without exposing parser text", () => {
    const reason = inspectTypeScriptSource(
      "bad.ts",
      `const x = {\n`,
    );
    assert.equal(reason, "schema_mismatch");
  });

  it("allows local declarations, parameters, and property names spelled Bun or Deno", () => {
    assert.equal(
      inspectTypeScriptSource(
        "local-var.ts",
        [
          `const Bun = { spawn: () => 1 };`,
          `Bun.spawn();`,
          ``,
        ].join("\n"),
      ),
      null,
    );
    assert.equal(
      inspectTypeScriptSource(
        "param.ts",
        [
          `function f(Bun: { spawn(): number }) {`,
          `  return Bun.spawn();`,
          `}`,
          ``,
        ].join("\n"),
      ),
      null,
    );
    assert.equal(
      inspectTypeScriptSource(
        "prop.ts",
        [
          `const x = { Bun: 1, Deno: 2 };`,
          `console.log(x.Bun, x.Deno);`,
          ``,
        ].join("\n"),
      ),
      null,
    );
    assert.equal(
      inspectTypeScriptSource(
        "type.ts",
        [
          `type Bun = { n: number };`,
          `interface Deno { m: string }`,
          `const v: Bun = { n: 1 };`,
          `export type T = Deno;`,
          ``,
        ].join("\n"),
      ),
      null,
    );
    assert.equal(
      inspectTypeScriptSource(
        "import-local.ts",
        [
          `import { Bun, Deno } from "./fixtures.js";`,
          `export const a = Bun;`,
          `export const b = Deno;`,
          ``,
        ].join("\n"),
      ),
      null,
    );
  });

  it("local Bun does not hide free global Bun outside its scope", () => {
    assert.equal(
      inspectTypeScriptSource(
        "shadow.ts",
        [
          `function inner() {`,
          `  const Bun = { spawn: () => 0 };`,
          `  return Bun.spawn();`,
          `}`,
          `const p = Bun.spawn({});`,
          ``,
        ].join("\n"),
      ),
      "prohibited_bun_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "shadow-deno.ts",
        [
          `function inner() {`,
          `  const Deno = { env: { get: (_k: string) => "" } };`,
          `  return Deno.env.get("X");`,
          `}`,
          `const e = Deno.env.get("Y");`,
          ``,
        ].join("\n"),
      ),
      "prohibited_deno_only",
    );
  });

  it("still rejects free global aliases even when a local Bun exists elsewhere", () => {
    assert.equal(
      inspectTypeScriptSource(
        "alias-still.ts",
        [
          `function hide() {`,
          `  const Bun = 1;`,
          `  return Bun;`,
          `}`,
          `const X = Bun;`,
          `X.spawn();`,
          ``,
        ].join("\n"),
      ),
      "prohibited_bun_only",
    );
  });

  it("rejects globalThis.Bun/Deno static, computed, and template property access", () => {
    assert.equal(
      inspectTypeScriptSource(
        "gthis-dot.ts",
        `globalThis.Bun.spawn({});\n`,
      ),
      "prohibited_bun_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "gthis-comp.ts",
        `globalThis["Deno"].env.get("X");\n`,
      ),
      "prohibited_deno_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "gthis-tpl.ts",
        "globalThis[`Bun`].spawn({});\n",
      ),
      "prohibited_bun_only",
    );
    // Unrelated globalThis properties are fine
    assert.equal(
      inspectTypeScriptSource(
        "gthis-other.ts",
        `const n = globalThis.Math?.PI ?? 0;\nexport const x = n;\n`,
      ),
      null,
    );
  });

  it("rejects ambient declare Bun/Deno value references", () => {
    assert.equal(
      inspectTypeScriptSource(
        "ambient-bun.ts",
        [
          `declare const Bun: { spawn(x: unknown): unknown };`,
          `Bun.spawn({});`,
          ``,
        ].join("\n"),
      ),
      "prohibited_bun_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "ambient-deno.ts",
        [
          `declare var Deno: { env: { get(k: string): string } };`,
          `Deno.env.get("X");`,
          ``,
        ].join("\n"),
      ),
      "prohibited_deno_only",
    );
  });

  it("allows local function/class named Bun or Deno and exports them", () => {
    assert.equal(
      inspectTypeScriptSource(
        "local-fn.ts",
        [
          `function Bun() { return 1; }`,
          `class Deno { m() { return 2; } }`,
          `export { Bun, Deno };`,
          `export const a = Bun();`,
          `export const b = new Deno().m();`,
          ``,
        ].join("\n"),
      ),
      null,
    );
  });

  it("binds var Bun to the enclosing function scope, not the block", () => {
    // Block-nested var binds function-wide; uses of Bun inside the function
    // refer to that local binding, not the free global.
    assert.equal(
      inspectTypeScriptSource(
        "var-scope.ts",
        [
          `function f() {`,
          `  if (true) { var Bun = { spawn: () => 0 }; }`,
          `  return Bun.spawn();`,
          `}`,
          ``,
        ].join("\n"),
      ),
      null,
    );
    // Outside the function, free global remains prohibited
    assert.equal(
      inspectTypeScriptSource(
        "var-scope-outer.ts",
        [
          `function f() {`,
          `  if (true) { var Bun = 1; }`,
          `  return Bun;`,
          `}`,
          `const p = Bun.spawn({});`,
          ``,
        ].join("\n"),
      ),
      "prohibited_bun_only",
    );
  });

  it("rejects import = require of Bun/Deno modules and allows Node/local", () => {
    assert.equal(
      inspectTypeScriptSource(
        "ieq-bun.ts",
        `import BunModule = require("bun");\nexport { BunModule };\n`,
      ),
      "prohibited_bun_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "ieq-deno.ts",
        `import DenoMod = require("deno:kv");\nexport { DenoMod };\n`,
      ),
      "prohibited_deno_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "ieq-node.ts",
        `import fs = require("node:fs");\nimport local = require("./local");\nexport { fs, local };\n`,
      ),
      null,
    );
  });

  it("rejects globalThis wrappers, satisfies, namespace, enum, export=, instantiation", () => {
    assert.equal(
      inspectTypeScriptSource(
        "gthis-as.ts",
        `(globalThis as any).Bun.spawn();\n`,
      ),
      "prohibited_bun_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "gthis-nn.ts",
        `globalThis!.Bun.spawn();\n`,
      ),
      "prohibited_bun_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "gthis-as-comp.ts",
        `(globalThis as Record<string, any>)["Deno"].env;\n`,
      ),
      "prohibited_deno_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "satisfies.ts",
        `const x = Bun.spawn() satisfies unknown;\n`,
      ),
      "prohibited_bun_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "ns.ts",
        `namespace N { export const x = Deno.env.get("x"); }\n`,
      ),
      "prohibited_deno_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "enum.ts",
        `enum E { X = Bun.nanoseconds() }\n`,
      ),
      "prohibited_bun_only",
    );
    assert.equal(
      inspectTypeScriptSource("export-eq.ts", `export = Bun;\n`),
      "prohibited_bun_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "inst.ts",
        `const f = Bun.fn<string>;\n`,
      ),
      "prohibited_bun_only",
    );
  });

  it("allows export function/class Bun|Deno and class-expression self-name; local require", () => {
    assert.equal(
      inspectTypeScriptSource(
        "export-fn.ts",
        `export function Bun() { return 1 }\n`,
      ),
      null,
    );
    assert.equal(
      inspectTypeScriptSource(
        "export-class.ts",
        `export class Deno {}\n`,
      ),
      null,
    );
    assert.equal(
      inspectTypeScriptSource(
        "class-expr.ts",
        `const C = class Bun { method() { return Bun } }\n`,
      ),
      null,
    );
    assert.equal(
      inspectTypeScriptSource(
        "local-require.ts",
        `function f(require: (x: string) => unknown) { return require("bun") }\n`,
      ),
      null,
    );
  });

  it("rejects Babel CallExpression+Import dynamic imports of Bun and Deno modules", () => {
    // Babel 7 emits import("mod") as CallExpression with Import callee
    // (not only ImportExpression). Static string and no-expression template.
    assert.equal(
      inspectTypeScriptSource(
        "dyn-bun.ts",
        `export async function f() { await import("bun:test"); }\n`,
      ),
      "prohibited_bun_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "dyn-bun-tpl.ts",
        "export async function f() { await import(`bun`); }\n",
      ),
      "prohibited_bun_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "dyn-deno.ts",
        `export async function f() { await import("deno:kv"); }\n`,
      ),
      "prohibited_deno_only",
    );
    assert.equal(
      inspectTypeScriptSource(
        "dyn-deno-tpl.ts",
        "export async function f() { await import(`https://deno.land/std/path/mod.ts`); }\n",
      ),
      "prohibited_deno_only",
    );
    // Ordinary Node/local dynamic imports must not fail
    assert.equal(
      inspectTypeScriptSource(
        "dyn-node.ts",
        `export async function f() { await import("node:fs"); await import("./local.js"); }\n`,
      ),
      null,
    );
  });
});
