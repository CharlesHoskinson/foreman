import { readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import type { Loader, Metafile, Plugin } from "esbuild";
import { hash } from "./provenance.js";

function inputPath(root: string, path: string): string {
  const normalized = relative(root, resolve(root, path)).replaceAll("\\", "/");
  if (/^packages\/[^/]+\/dist(?:\/|$)/.test(normalized)) throw new Error("Workspace dist is not an admissible pilot build input");
  return normalized;
}

export function captureBuildInputs(root: string, hashes: Record<string, string>): Plugin {
  return { name: "capture-source-manifest", setup(build) {
    build.onResolve({ filter: /^@foreman\// }, ({ path }) => {
      const match = /^@foreman\/([a-z0-9-]+)(?:\/(testing))?$/.exec(path);
      if (!match) throw new Error("Unsupported workspace source entry");
      return { path: resolve(root, "packages", match[1]!, "src", `${match[2] ?? "index"}.ts`) };
    });
    build.onLoad({ filter: /.*/, namespace: "file" }, async ({ path }) => {
      const sourcePath = inputPath(root, path);
      const loaders: Readonly<Record<string, Loader>> = { ".js": "js", ".cjs": "js", ".mjs": "js", ".ts": "ts", ".mts": "ts", ".cts": "ts", ".tsx": "tsx", ".json": "json" };
      const loader = loaders[extname(path)];
      if (!loader) throw new Error("Unsupported pilot input extension");
      const contents = await readFile(path);
      hashes[sourcePath] = hash(contents);
      return { contents, loader };
    });
  } };
}

/** Compare sets, including unexpected capture entries. External imports are not esbuild inputs. */
export function verifyBuildInputs(root: string, metafile: Metafile, hashes: Readonly<Record<string, string>>): string[] {
  const inputs = Object.keys(metafile.inputs).map(path => inputPath(root, path)).sort();
  const captured = Object.keys(hashes).sort();
  if (inputs.length !== captured.length || inputs.some((path, index) => path !== captured[index] || !/^[a-f0-9]{64}$/.test(hashes[path] ?? ""))) throw new Error("Incomplete or unexpected pilot bundle input manifest");
  return inputs;
}
