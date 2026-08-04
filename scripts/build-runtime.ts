import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ENTRIES = [
  {
    id: "destruction-guard",
    entry: join(root, "packages/policy/src/main.ts"),
    relativePath: "dist/destruction-guard.js",
  },
  {
    id: "architecture-policy",
    entry: join(root, "packages/policy/src/architecture-main.ts"),
    relativePath: "dist/architecture-policy.js",
  },
  {
    id: "lane-queue",
    entry: join(root, "packages/orchestration/src/queue-main.ts"),
    relativePath: "dist/lane-queue.js",
  },
  {
    id: "lane-round",
    entry: join(root, "packages/orchestration/src/round-main.ts"),
    relativePath: "dist/lane-round.js",
  },
] as const;

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

export type ArtifactBuild = {
  readonly id: string;
  readonly relativePath: string;
  readonly bundlePath: string;
  readonly sha256: string;
  readonly byteLength: number;
};

export type BuildPaths = {
  /** Directory that will contain dist/*.js and sibling manifest.json */
  readonly runtimeRoot: string;
};

/** Build both ESM bundles and write the multi-artifact manifest. */
export async function buildTo(paths: BuildPaths): Promise<{
  readonly artifacts: readonly ArtifactBuild[];
  readonly manifestPath: string;
  readonly manifestText: string;
}> {
  const distDir = join(paths.runtimeRoot, "dist");
  mkdirSync(distDir, { recursive: true });
  const artifacts: ArtifactBuild[] = [];

  for (const e of ENTRIES) {
    const bundlePath = join(paths.runtimeRoot, e.relativePath);
    mkdirSync(dirname(bundlePath), { recursive: true });
    await esbuild.build({
      entryPoints: [e.entry],
      outfile: bundlePath,
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
    const bytes = readFileSync(bundlePath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    artifacts.push({
      id: e.id,
      relativePath: e.relativePath,
      bundlePath,
      sha256,
      byteLength: bytes.byteLength,
    });
  }

  // Deterministic artifact order by relativePath
  artifacts.sort((a, b) =>
    a.relativePath < b.relativePath
      ? -1
      : a.relativePath > b.relativePath
        ? 1
        : 0,
  );

  const manifest = {
    artifacts: artifacts.map((a) => ({
      byteLength: a.byteLength,
      id: a.id,
      relativePath: a.relativePath,
      sha256: a.sha256,
    })),
    nodeRange: ">=24 <25",
    schemaVersion: 2,
  };
  const manifestText = canonicalize(manifest) + "\n";
  const manifestPath = join(paths.runtimeRoot, "manifest.json");
  writeFileSync(manifestPath, manifestText, "utf8");
  return { artifacts, manifestPath, manifestText };
}

/** Write only the tracked runtime artifacts under skills/foreman/runtime. */
export async function buildTracked(): Promise<void> {
  const result = await buildTo({
    runtimeRoot: join(root, "skills/foreman/runtime"),
  });
  for (const a of result.artifacts) {
    process.stdout.write(
      `built ${a.bundlePath} sha256=${a.sha256} bytes=${a.byteLength}\n`,
    );
  }
  process.stdout.write(`manifest ${result.manifestPath}\n`);
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  await buildTracked();
}
