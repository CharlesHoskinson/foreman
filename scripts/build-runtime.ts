import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  capabilityTableDigest,
  capabilityTableToCanonicalJson,
  parseVendorCapabilitiesFromToml,
} from "../packages/orchestration/src/vendor-preflight-manifest.js";
import { isVendorPreflightContractFailure } from "../packages/orchestration/src/vendor-preflight-contract.js";
import { createDefaultAuthoringSnapshotV1 } from "../packages/orchestration/src/pel-host-descriptors.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ENTRIES = [
  ...[
    ['install', 'pel-install-main.ts'],
    ['pel-package', 'pel-package-main.ts'],
    ['pel-simplification', 'pel-simplification-main.ts'],
  ].map(([id, source]) => ({id: id!, entry: join(root, 'packages/orchestration/src', source!), relativePath: `dist/${id}.js`, injectCapabilities: false})),
  {
    id: "foreman",
    entry: join(root, "packages/orchestration/src/pel-authoring-main.ts"),
    relativePath: "dist/foreman.js",
    injectCapabilities: false,
  },
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
    id: "execution-guard",
    entry: join(root, "packages/orchestration/src/execution-guard-main.ts"),
    relativePath: "dist/execution-guard.js",
    injectCapabilities: false,
  },
  {
    id: "release-coverage",
    entry: join(root, "packages/orchestration/src/release-coverage-main.ts"),
    relativePath: "dist/release-coverage.js",
    injectCapabilities: false,
  },
  {
    id: "appliance-doctor",
    entry: join(root, "packages/orchestration/src/appliance-doctor-main.ts"),
    relativePath: "dist/appliance-doctor.js",
    injectCapabilities: false,
  },
  {
    id: "graphify-qualification",
    entry: join(
      root,
      "packages/orchestration/src/graphify-qualification-main.ts",
    ),
    relativePath: "dist/graphify-qualification.js",
    injectCapabilities: false,
  },
  {
    id: "graph-context",
    entry: join(root, "packages/orchestration/src/graph-context-main.ts"),
    relativePath: "dist/graph-context.js",
    injectCapabilities: false,
  },
  {
    id: "graph-evaluation",
    entry: join(root, "packages/orchestration/src/graph-evaluation-main.ts"),
    relativePath: "dist/graph-evaluation.js",
    injectCapabilities: false,
  },
  {
    id: "release-admission",
    entry: join(root, "packages/policy/src/release-admission-main.ts"),
    relativePath: "dist/release-admission.js",
    injectCapabilities: false,
  },
  {
    id: "release-authority",
    entry: join(root, "packages/orchestration/src/release-authority-main.ts"),
    relativePath: "dist/release-authority.js",
    injectCapabilities: false,
  },
  {
    id: "release-policy",
    entry: join(root, "packages/orchestration/src/release-policy-main.ts"),
    relativePath: "dist/release-policy.js",
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
    id: "lane-supervise",
    entry: join(root, "packages/orchestration/src/supervisor-main.ts"),
    relativePath: "dist/lane-supervise.js",
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
  {
    id: "tier2-collect",
    entry: join(root, "packages/orchestration/src/tier2-collect-main.ts"),
    relativePath: "dist/tier2-collect.js",
    injectCapabilities: false,
  },
  {
    id: "tier2-compare",
    entry: join(root, "packages/orchestration/src/tier2-compare-main.ts"),
    relativePath: "dist/tier2-compare.js",
    injectCapabilities: false,
  },

  {
    id: "repo-hygiene",
    entry: join(root, "packages/policy/src/repo-hygiene.ts"),
    relativePath: "dist/repo-hygiene.js",
    injectCapabilities: false,
  },
  {
    id: "dependency-drift",
    entry: join(root, "packages/orchestration/src/dependency-drift.ts"),
    relativePath: "dist/dependency-drift.js",
    injectCapabilities: false,
  },
  {
    id: "foreman-setup",
    entry: join(root, "packages/orchestration/src/foreman-setup-main.ts"),
    relativePath: "dist/foreman-setup.js",
    injectCapabilities: true,
  },
  {
    id: "secret-scan",
    entry: join(root, "packages/orchestration/src/secret-scan-main.ts"),
    relativePath: "dist/secret-scan.js",
    injectCapabilities: false,
  },
  {
    id: "credential-profile",
    entry: join(root, "packages/orchestration/src/credential-profile-main.ts"),
    relativePath: "dist/credential-profile.js",
    injectCapabilities: false,
  },
  {
    id: "credential-profile-lane",
    entry: join(
      root,
      "packages/orchestration/src/credential-profile-lane-main.ts",
    ),
    relativePath: "dist/credential-profile-lane.js",
    injectCapabilities: false,
  },
  {
    id: "graph-store",
    entry: join(root, "packages/graph-store/src/main.ts"),
    relativePath: "dist/graph-store.js",
    injectCapabilities: false,
  },
  {
    id: "foreman-launch",
    entry: join(root, "packages/launcher/src/main.ts"),
    relativePath: "dist/foreman-launch.js",
    injectCapabilities: false,
  },
  {
    id: "fm-session",
    entry: join(root, "packages/orchestration/src/fm-session-main.ts"),
    relativePath: "dist/fm-session.js",
    injectCapabilities: false,
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
  const snapshotPath = join(
    paths.runtimeRoot,
    "assets/pel/default-authoring-snapshot.json",
  );
  mkdirSync(dirname(snapshotPath), { recursive: true });
  const snapshotBytes = Buffer.from(
    canonicalize(createDefaultAuthoringSnapshotV1()) + "\n",
  );
  writeFileSync(snapshotPath, snapshotBytes);
  artifacts.push({
    id: "pel-authoring-snapshot",
    relativePath: "assets/pel/default-authoring-snapshot.json",
    bundlePath: snapshotPath,
    sha256: createHash("sha256").update(snapshotBytes).digest("hex"),
    byteLength: snapshotBytes.length,
  });

  // The M6 package manifest binds these complete data assets. The older runtime
  // manifest retains its existing closed compiled-entry/default-snapshot contract.
  const copyData = (source: string, target: string): void => {
    const info = lstatSync(source);
    if (info.isSymbolicLink()) throw new Error('Package data cannot contain symlinks');
    if (info.isDirectory()) {
      mkdirSync(target, {recursive: true});
      for (const name of readdirSync(source).sort()) copyData(join(source, name), join(target, name));
    } else {
      if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('Package data exceeds its file bound');
      mkdirSync(dirname(target), {recursive: true});
      writeFileSync(target, readFileSync(source));
    }
  };
  // These two directories contain only generated copies owned by this build.
  // Remove prior copies so a retired source cannot survive in a later archive.
  for (const name of ['research', 'migration']) {
    rmSync(join(paths.runtimeRoot, 'assets/pel', name), { recursive: true, force: true });
  }
  copyData(join(root, 'docs/research/pel-release'), join(paths.runtimeRoot, 'assets/pel/research'));
  for (const name of ['implement-verify-review', 'bounded-rework']) {
    copyData(join(root, 'packages/orchestration/src/fixtures/pel-migration', name, 'registered-command-bindings.json'), join(paths.runtimeRoot, 'assets/pel/migration', name, 'registered-command-bindings.json'));
  }

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
