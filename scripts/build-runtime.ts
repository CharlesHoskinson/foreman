import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "packages/policy/src/main.ts");

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v)).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k]))
        .join(",") +
      "}"
    );
  }
  throw new Error("unsupported");
}

export type BuildPaths = {
  readonly bundlePath: string;
  readonly manifestPath: string;
};

/** Build the ESM bundle and write both artifacts to the given explicit paths. */
export async function buildTo(paths: BuildPaths): Promise<{
  bundlePath: string;
  manifestPath: string;
  sha256: string;
  byteLength: number;
  manifestText: string;
}> {
  mkdirSync(dirname(paths.bundlePath), { recursive: true });
  mkdirSync(dirname(paths.manifestPath), { recursive: true });
  await esbuild.build({
    entryPoints: [entry],
    outfile: paths.bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    minify: false,
    legalComments: "none",
    sourcemap: false,
    logLevel: "silent",
    packages: "bundle",
    absWorkingDir: root,
  });
  const bytes = readFileSync(paths.bundlePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const byteLength = bytes.byteLength;
  const manifest = {
    bundle: {
      byteLength,
      relativePath: "dist/destruction-guard.js",
      sha256,
    },
    nodeRange: ">=24 <25",
    schemaVersion: 1,
  };
  const manifestText = canonicalize(manifest) + "\n";
  writeFileSync(paths.manifestPath, manifestText, "utf8");
  return {
    bundlePath: paths.bundlePath,
    manifestPath: paths.manifestPath,
    sha256,
    byteLength,
    manifestText,
  };
}

/** Write only the two tracked runtime artifacts. */
export async function buildTracked(): Promise<void> {
  const result = await buildTo({
    bundlePath: join(
      root,
      "skills/foreman/runtime/dist/destruction-guard.js",
    ),
    manifestPath: join(root, "skills/foreman/runtime/manifest.json"),
  });
  process.stdout.write(
    `built ${result.bundlePath} sha256=${result.sha256} bytes=${result.byteLength}\n`,
  );
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  await buildTracked();
}
