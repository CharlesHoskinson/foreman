import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("fresh source and actual package default entries exclude synthetic reachability; contaminated entry is detected", { timeout: 30000 }, async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const fixture = await mkdtemp(join(tmpdir(), "foreman-production-entries-"));
  const prohibited = ["makeSyntheticOpenBaoCredentialStore", "makePilotClient"];
  const assertSafe = (entry: Record<string, unknown>) => { for (const name of prohibited) assert.equal(name in entry, false, name); };
  try {
    for (const name of ["providers", "orchestration"]) {
      const metadata = JSON.parse(await readFile(join(root, "packages", name, "package.json"), "utf8"));
      const directory = join(fixture, name); await mkdir(directory);
      await writeFile(join(directory, "package.json"), JSON.stringify(metadata));
      const target = join(directory, metadata.exports["."].import);
      await mkdir(dirname(target), { recursive: true });
      const result = await build({ absWorkingDir: root, entryPoints: [join(root, "packages", name, "src/index.ts")], outfile: target, bundle: true, platform: "node", format: "esm", target: "node24", metafile: true,
        plugins: [{ name: "workspace-current-source", setup(builder) { builder.onResolve({ filter: /^@foreman\// }, args => { const match = /^@foreman\/([^/]+)(?:\/(testing))?$/.exec(args.path); if (!match) throw Error("unexpected workspace import"); return { path: join(root, "packages", match[1]!, "src", `${match[2] ?? "index"}.ts`) }; }); } }],
      });
      const inputs = Object.keys(result.metafile!.inputs);
      assert.equal(inputs.some(path => /packages\/(?:providers\/src\/testing|orchestration\/src\/openbao-pilot)\.ts$/.test(path)), false);
      assert.equal(inputs.some(path => /^packages\/[^/]+\/dist\//.test(path)), false);
      const emitted = await readFile(target, "utf8");
      for (const symbol of prohibited) assert.equal(emitted.includes(symbol), false);
      // Import the path selected by the unmodified package metadata, freshly built above.
      assertSafe(await import(pathToFileURL(target).href));
      // A disposable stale/contaminated default entry must fail the same export predicate.
      await writeFile(target, "export function makeSyntheticOpenBaoCredentialStore() {}\n");
      assert.throws(() => assertSafe({ makeSyntheticOpenBaoCredentialStore() {} }), /makeSyntheticOpenBaoCredentialStore/);
      const control = await import(`${pathToFileURL(target).href}?contaminated`);
      assert.throws(() => assertSafe(control), /makeSyntheticOpenBaoCredentialStore/);
    }
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
