import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { dependencyEvidence, hash, sourceFiles, sourceState } from "./openbao-pilot/provenance.js";
import { captureBuildInputs, verifyBuildInputs } from "./openbao-pilot/build-inputs.js";

const output = resolve(process.argv[2] ?? ".openbao-pilot-dist");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(output, { recursive: true, mode: 0o700 });
for (const name of ["openbao-pilot", "openbao-pilot-worker"] as const) {
  const implementationHashes: Record<string, string> = {};
  const bundleInputHashes: Record<string, string> = {};
  for (const path of sourceFiles) implementationHashes[path] = hash(await readFile(resolve(root, path)));
  const result = await build({ absWorkingDir: root, entryPoints: [resolve(root, "scripts", `${name}.ts`)], outfile: resolve(output, `${name}.mjs`), bundle: true, platform: "node", target: "node24", format: "esm", sourcemap: false, write: false, metafile: true,
    plugins: [captureBuildInputs(root, bundleInputHashes)],
  });
  const bundleInputs = verifyBuildInputs(root, result.metafile, bundleInputHashes);
  for (const [path, expected] of Object.entries(implementationHashes)) {
    if (hash(await readFile(resolve(root, path))) !== expected || (bundleInputHashes[path] !== undefined && bundleInputHashes[path] !== expected)) throw new Error("Source changed during pilot build");
  }
  const provenance = { ...sourceState(root), implementationHashes, bundleInputs, bundleInputHashes, ...await dependencyEvidence(root) };
  const banner = `const __PILOT_BUILD_PROVENANCE__ = ${JSON.stringify(provenance)};\n`;
  await writeFile(resolve(output, `${name}.mjs`), banner + result.outputFiles[0]!.text, { mode: 0o600 });
}
