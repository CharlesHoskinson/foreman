import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface BuildProvenance {
  readonly sourceRevision: string;
  readonly sourceDirty: boolean;
  readonly buildEnvironment: { readonly nodeVersion: string; readonly nodeSha256: string };
  readonly implementationHashes: Readonly<Record<string, string>>;
  readonly bundleInputHashes: Readonly<Record<string, string>>;
  readonly bundleInputs: readonly string[];
  readonly dependencies: { readonly effect: string; readonly esbuild: string };
  readonly dependencyHashes: Readonly<Record<string, string>>;
}
declare const __PILOT_BUILD_PROVENANCE__: BuildProvenance | undefined;
export const hash = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
export const sourceFiles = ["scripts/openbao-pilot.ts", "scripts/openbao-pilot.test.ts", "scripts/openbao-pilot-worker.ts", "scripts/build-openbao-pilot.ts", "scripts/openbao-pilot/build-inputs.ts", "scripts/openbao-pilot/lifecycle.ts", "scripts/openbao-pilot/provenance.ts", "scripts/openbao-pilot/binary-receipt.ts", "scripts/openbao-pilot/deletion-semantics.ts", "packages/orchestration/src/openbao-pilot.ts", "packages/providers/src/openbao-credential-store.ts", "packages/providers/src/openbao-http.ts", "packages/providers/src/credential-store.ts", "packages/providers/src/testing.ts"];

export function sourceState(root: string) {
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  return { sourceRevision: git(["rev-parse", "HEAD"]), sourceDirty: git(["status", "--porcelain", "-uall"]) !== "" };
}
export async function nodeEnvironment(signal?: AbortSignal) {
  return { nodeVersion: process.version, nodeSha256: hash(await readFile(process.execPath, signal ? { signal } : {})) };
}

export async function dependencyEvidence(root: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const paths = ["package.json", "package-lock.json", "node_modules/effect/package.json", "node_modules/esbuild/package.json"];
  const contents = await Promise.all(paths.map(path => readFile(resolve(root, path), signal ? { signal } : {})));
  signal?.throwIfAborted();
  return {
    buildEnvironment: await nodeEnvironment(signal),
    dependencies: { effect: JSON.parse(contents[2]!.toString()).version as string, esbuild: JSON.parse(contents[3]!.toString()).version as string },
    dependencyHashes: Object.fromEntries(paths.map((path, index) => [path, hash(contents[index]!)])),
  };
}

export async function implementationEvidence(entryUrl: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const executableSha256 = hash(await readFile(fileURLToPath(entryUrl), signal ? { signal } : {}));
  signal?.throwIfAborted();
  const runtimeEnvironment = await nodeEnvironment(signal);
  if (typeof __PILOT_BUILD_PROVENANCE__ !== "undefined") return { ...__PILOT_BUILD_PROVENANCE__, runtimeEnvironment, evidenceMode: "compiled" as const, executableSha256 };
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const implementationHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, hash(await readFile(resolve(root, path), signal ? { signal } : {}))])));
  signal?.throwIfAborted();
  return { ...sourceState(root), implementationHashes, bundleInputs: [], bundleInputHashes: {}, ...await dependencyEvidence(root, signal), runtimeEnvironment, evidenceMode: "source" as const, executableSha256 };
}
