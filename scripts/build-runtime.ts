import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  capabilityTableDigest,
  capabilityTableToCanonicalJson,
  parseVendorCapabilitiesFromToml,
} from "../packages/orchestration/src/vendor-preflight-manifest.js";
import { isVendorPreflightContractFailure } from "../packages/orchestration/src/vendor-preflight-contract.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ENTRIES = [
  {
    id: "architecture-policy",
    entry: join(root, "packages/policy/src/architecture-main.ts"),
    relativePath: "dist/architecture-policy.js",
    injectCapabilities: false,
  },
  {
    id: "destruction-guard",
    entry: join(root, "packages/policy/src/main.ts"),
    relativePath: "dist/destruction-guard.js",
    injectCapabilities: false,
  },
  {
    id: "lane-queue",
    entry: join(root, "packages/orchestration/src/queue-main.ts"),
    relativePath: "dist/lane-queue.js",
    injectCapabilities: false,
  },
  {
    id: "lane-round",
    entry: join(root, "packages/orchestration/src/round-main.ts"),
    relativePath: "dist/lane-round.js",
    injectCapabilities: false,
  },
  {
    id: "vendor-preflight",
    entry: join(root, "packages/orchestration/src/vendor-preflight-main.ts"),
    relativePath: "dist/vendor-preflight.js",
    injectCapabilities: true,
  },
  {
    id: "tool-check",
    entry: join(root, "packages/orchestration/src/tool-check-main.ts"),
    relativePath: "dist/tool-check.js",
    injectCapabilities: true,
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

/**
 * Read and validate the authored capability table. Returns canonical JSON
 * text and its SHA-256 digest for injection into only the vendor-preflight
 * runtime artifact.
 */
export function loadAuthoredCapabilityEmbed(): {
  readonly jsonText: string;
  readonly digest: string;
} {
  const tomlPath = join(root, "env/reference-manifest.toml");
  const text = readFileSync(tomlPath, "utf8");
  const table = parseVendorCapabilitiesFromToml(text);
  if (isVendorPreflightContractFailure(table)) {
    throw new Error(
      `vendor capability table invalid in ${tomlPath}: ${table.reason}`,
    );
  }
  // Require the three configured lanes; refuse silent empty tables.
  const ids = new Set(table.capabilities.map((c) => c.vendor));
  for (const need of ["claude", "codex", "grok"] as const) {
    if (!ids.has(need)) {
      throw new Error(`vendor capability table missing ${need}`);
    }
  }
  if (ids.has("agy")) {
    throw new Error(
      "agy capability must not be authored until probe and floor are specified",
    );
  }
  const jsonText = capabilityTableToCanonicalJson(table);
  const digest = capabilityTableDigest(table);
  return { jsonText, digest };
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

/** Build all ESM bundles and write the multi-artifact manifest. */
export async function buildTo(paths: BuildPaths): Promise<{
  readonly artifacts: readonly ArtifactBuild[];
  readonly manifestPath: string;
  readonly manifestText: string;
}> {
  const distDir = join(paths.runtimeRoot, "dist");
  mkdirSync(distDir, { recursive: true });
  const artifacts: ArtifactBuild[] = [];
  const caps = loadAuthoredCapabilityEmbed();

  for (const e of ENTRIES) {
    const bundlePath = join(paths.runtimeRoot, e.relativePath);
    mkdirSync(dirname(bundlePath), { recursive: true });
    const buildOptions: esbuild.BuildOptions = {
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
    };
    if (e.injectCapabilities) {
      // Inject only into vendor-preflight. Other artifacts stay free of the table.
      buildOptions.define = {
        __FOREMAN_VENDOR_CAPS_JSON__: JSON.stringify(caps.jsonText),
        __FOREMAN_VENDOR_CAPS_DIGEST__: JSON.stringify(caps.digest),
      };
    }
    await esbuild.build(buildOptions);
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
