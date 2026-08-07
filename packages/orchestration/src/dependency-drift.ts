/**
 * Dependency-drift reconciler: prove manifest, readiness authority, and
 * bootstrap provisioner agree.
 *
 * Readiness authority is `profileToolIds` (TypeScript), not shell source text.
 * Manifest authority is strict `[[tools]]` records from reference-manifest.toml.
 * Provisioner authority is bounded text from bootstrap-wsl.sh.
 *
 * Exit 0 = agree. Exit 1 = drift. Exit 2 = fail closed.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Layer } from "effect";
import {
  BoundedFs,
  liveBoundedFs,
  type BoundedReadResult,
} from "./queue-services.js";
import {
  TOOL_CHECK_PROFILES,
  type ToolCheckProfile,
} from "./tool-check-cli.js";
import { profileToolIds } from "./tool-check-report.js";
import { resolveRepoRoot } from "./tool-check-run.js";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

export const EXIT_AGREE = 0;
export const EXIT_DRIFT = 1;
export const EXIT_FAIL_CLOSED = 2;

/** Per-input UTF-8 byte bound (1 MiB). */
export const MAX_DRIFT_INPUT_BYTES = 1_048_576;

/** Pseudo-entries: checked by tool-check but not installable tools. */
export const PSEUDO_IDS: ReadonlySet<string> = new Set([
  "foreman_home_fs",
  "foreman_skill",
  "foreman-launch",
]);

/** Deliberately not provisioned (durable transport, install on demand). */
export const UNPROVISIONED_IDS: ReadonlySet<string> = new Set([
  "nats-server",
  "nats-cli",
]);

export const MSG_NO_DRIFT =
  "dependencies: no drift (manifest, tool-check and bootstrap agree)";

export const MSG_DRIFT_FOOTER =
  "DEPENDENCY DRIFT -- records disagree. Reconcile all three, then re-run.";

export const REL_MANIFEST = "env/reference-manifest.toml";
export const REL_BOOTSTRAP = "env/bootstrap-wsl.sh";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ManifestToolRecord = {
  readonly id: string;
  readonly required: boolean;
};

export type CheckerAuthority = {
  readonly checkerIds: readonly string[];
  readonly checkerMust: readonly string[];
};

export type ParseToolsResult =
  | {
      readonly _tag: "Ok";
      readonly records: readonly ManifestToolRecord[];
      readonly ids: readonly string[];
      readonly requiredIds: readonly string[];
    }
  | { readonly _tag: "Error"; readonly reason: string };

export type ReconcileInput = {
  readonly checkerIds: readonly string[];
  readonly checkerMust: readonly string[];
  readonly tools: readonly ManifestToolRecord[];
  readonly bootstrapText: string;
};

export type ReconcileResult = {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
};

export type DriftIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export type DriftRunOptions = {
  /** Explicit repository root (test seam). Default: resolveRepoRoot(). */
  readonly repoRoot?: string;
  /** Injected BoundedFs layer (test seam). */
  readonly layer?: Layer.Layer<BoundedFs>;
  /** Override readiness authority (test seam). */
  readonly authority?: CheckerAuthority;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function sortedUnique(ids: Iterable<string>): readonly string[] {
  return [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Map a binary name to the package that actually delivers it in the provisioner.
 */
export function providedBy(id: string): string {
  switch (id) {
    case "flock":
      return "util-linux";
    case "timeout":
      return "coreutils";
    default:
      return id;
  }
}

/**
 * Build checker sets from an arbitrary list of profile rows (test seam).
 */
export function buildCheckerAuthority(
  rows: readonly {
    readonly must: readonly string[];
    readonly should: readonly string[];
  }[],
): CheckerAuthority {
  const all = new Set<string>();
  const must = new Set<string>();
  for (const row of rows) {
    for (const id of row.must) {
      all.add(id);
      must.add(id);
    }
    for (const id of row.should) {
      all.add(id);
    }
  }
  return {
    checkerIds: sortedUnique(all),
    checkerMust: sortedUnique(must),
  };
}

/**
 * Readiness authority: union of `profileToolIds` across every profile and both
 * WSL states. Does not scrape shell or TypeScript source text.
 */
export function collectCheckerAuthority(): CheckerAuthority {
  const rows: { must: readonly string[]; should: readonly string[] }[] = [];
  for (const profile of TOOL_CHECK_PROFILES) {
    for (const isWsl of [false, true] as const) {
      rows.push(profileToolIds(profile as ToolCheckProfile, isWsl));
    }
  }
  return buildCheckerAuthority(rows);
}

/**
 * Strict `[[tools]]` parser. Binds each id to the required flag in the same
 * record. Ignores unrelated TOML sections. Rejects missing id, duplicate id,
 * missing required, non-boolean required values, and a second required key
 * inside one record (overwrite would suppress tier drift).
 */
export function parseManifestTools(text: string): ParseToolsResult {
  const lines = text.split(/\r?\n/);
  const records: ManifestToolRecord[] = [];
  const seen = new Set<string>();

  let inTools = false;
  let id: string | null = null;
  let required: boolean | null = null;
  let requiredSeen = false;

  const flush = (): string | null => {
    if (!inTools) return null;
    // Only flush when we actually entered a tools table header.
    if (id === null) {
      return "missing id in [[tools]] record";
    }
    if (!requiredSeen || required === null) {
      return "missing required flag in [[tools]] record";
    }
    if (seen.has(id)) {
      return `duplicate id: ${id}`;
    }
    seen.add(id);
    records.push({ id, required });
    id = null;
    required = null;
    requiredSeen = false;
    inTools = false;
    return null;
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (line === "[[tools]]") {
      const err = flush();
      if (err) return { _tag: "Error", reason: err };
      inTools = true;
      id = null;
      required = null;
      requiredSeen = false;
      continue;
    }

    // Any other table header ends the current tools record.
    if (
      inTools &&
      (line.startsWith("[[") || (line.startsWith("[") && !line.startsWith("[[")))
    ) {
      const err = flush();
      if (err) return { _tag: "Error", reason: err };
      // fall through: this header is not [[tools]], so stay out of tools
      continue;
    }

    if (!inTools) continue;

    const idM = /^id\s*=\s*"([^"]*)"\s*$/.exec(line);
    if (idM) {
      if (id !== null) {
        return { _tag: "Error", reason: "duplicate id key in [[tools]] record" };
      }
      const value = idM[1]!;
      if (value.length === 0) {
        return { _tag: "Error", reason: "missing id in [[tools]] record" };
      }
      id = value;
      continue;
    }

    const reqM = /^required\s*=\s*(.+?)\s*$/.exec(line);
    if (reqM) {
      if (requiredSeen) {
        return {
          _tag: "Error",
          reason: "duplicate required key in [[tools]] record",
        };
      }
      const rawVal = reqM[1]!.trim();
      if (rawVal === "true") {
        required = true;
        requiredSeen = true;
      } else if (rawVal === "false") {
        required = false;
        requiredSeen = true;
      } else {
        return {
          _tag: "Error",
          reason: `invalid boolean for required: ${rawVal}`,
        };
      }
      continue;
    }
  }

  const endErr = flush();
  if (endErr) return { _tag: "Error", reason: endErr };

  const ids = sortedUnique(records.map((r) => r.id));
  const requiredIds = sortedUnique(
    records.filter((r) => r.required).map((r) => r.id),
  );
  return { _tag: "Ok", records, ids, requiredIds };
}

/**
 * Pure reconciler. Messages preserve the public diagnostic grammar of the
 * legacy shell gate (relative paths only; no secrets).
 */
export function reconcileDependencyDrift(
  input: ReconcileInput,
): ReconcileResult {
  const stdout: string[] = [];
  const stderr: string[] = [];

  if (input.checkerIds.length === 0) {
    stderr.push(
      "ERROR checker authority is empty — profileToolIds produced zero ids",
    );
    return { exitCode: EXIT_FAIL_CLOSED, stdout, stderr };
  }

  const manifestIds = new Set(input.tools.map((t) => t.id));
  const manifestRequired = new Set(
    input.tools.filter((t) => t.required).map((t) => t.id),
  );
  const checkerIds = sortedUnique(input.checkerIds);
  const checkerMust = new Set(input.checkerMust);
  const bootstrap = input.bootstrapText;

  let drift = false;

  // 1. Checker id must be declared in the manifest (pseudo exempt).
  for (const id of checkerIds) {
    if (PSEUDO_IDS.has(id)) continue;
    if (!manifestIds.has(id)) {
      stdout.push(
        `DRIFT checker gates on '${id}' but env/reference-manifest.toml does not declare it`,
      );
      drift = true;
    }
  }

  // 2. Manifest-only ids → INFO (not drift).
  for (const id of sortedUnique(manifestIds)) {
    if (PSEUDO_IDS.has(id)) continue;
    if (!checkerIds.includes(id)) {
      stdout.push(
        `INFO  manifest declares "${id}" but env/tool-check.sh does not report it`,
      );
    }
  }

  // 3. Provisioner install route (package aliases; unprovisioned → INFO).
  for (const id of checkerIds) {
    if (PSEUDO_IDS.has(id)) continue;
    if (UNPROVISIONED_IDS.has(id)) {
      stdout.push(
        `INFO  "${id}" is gated but deliberately not provisioned (durable transport, installed on demand)`,
      );
      continue;
    }
    const needle = providedBy(id);
    if (!bootstrap.includes(needle)) {
      stdout.push(
        `DRIFT checker gates on '${id}' but env/bootstrap-wsl.sh has no install route for it (looked for '${needle}')`,
      );
      drift = true;
    }
  }

  // 4. Tier agreement: manifest required=true must be checker must.
  for (const id of sortedUnique(manifestRequired)) {
    if (PSEUDO_IDS.has(id)) continue;
    if (!checkerIds.includes(id)) continue;
    if (!checkerMust.has(id)) {
      stdout.push(
        `DRIFT env/reference-manifest.toml marks '${id}' required = true but env/tool-check.sh grades it should_*, so a host without it still reports READY`,
      );
      drift = true;
    }
  }

  if (drift) {
    stdout.push("");
    stdout.push(MSG_DRIFT_FOOTER);
    return { exitCode: EXIT_DRIFT, stdout, stderr };
  }

  stdout.push(MSG_NO_DRIFT);
  return { exitCode: EXIT_AGREE, stdout, stderr };
}

// ---------------------------------------------------------------------------
// Argv + Effect CLI boundary
// ---------------------------------------------------------------------------

/**
 * Strip node binary and script path from process.argv-style input.
 */
export function stripDriftNodeArgv(
  argv: readonly string[],
): readonly string[] {
  let args = [...argv];
  if (
    args.length > 0 &&
    (args[0]!.endsWith("node") ||
      args[0]!.endsWith("node.exe") ||
      args[0]!.includes("/node") ||
      args[0]!.includes("\\node"))
  ) {
    args = args.slice(1);
  }
  if (
    args.length > 0 &&
    (args[0]!.endsWith(".js") ||
      args[0]!.endsWith(".ts") ||
      args[0]!.includes("dependency-drift") ||
      args[0]!.includes("check-drift"))
  ) {
    args = args.slice(1);
  }
  return args;
}

function readLabel(result: BoundedReadResult, rel: string): string | null {
  switch (result._tag) {
    case "Ok":
      return null;
    case "Absent":
      return `ERROR unreadable: ${rel}`;
    case "Unreadable":
      return `ERROR unreadable: ${rel}`;
    case "Oversized":
      return `ERROR oversized: ${rel} (limit ${MAX_DRIFT_INPUT_BYTES} bytes)`;
    case "MalformedUtf8":
      return `ERROR malformed UTF-8: ${rel}`;
    case "IdentityChanged":
      return `ERROR unreadable: ${rel}`;
    default: {
      const _exhaustive: never = result;
      return `ERROR unreadable: ${rel}`;
    }
  }
}

/**
 * Effect CLI: load bounded inputs, parse, reconcile, write diagnostics.
 * Never prints absolute paths.
 */
export function runDependencyDrift(
  argv: readonly string[],
  io: DriftIo,
  options: DriftRunOptions = {},
): Effect.Effect<number> {
  const args = stripDriftNodeArgv(argv);
  if (args.length > 0) {
    io.writeStderr(
      `ERROR invalid arguments: usage: check-drift.sh (no options); unknown: ${args[0]}\n`,
    );
    return Effect.succeed(EXIT_FAIL_CLOSED);
  }

  const repoRoot =
    options.repoRoot ??
    resolveDriftRepoRoot(typeof import.meta !== "undefined" ? import.meta.url : undefined);
  const authority = options.authority ?? collectCheckerAuthority();
  const layer = options.layer ?? liveBoundedFs;

  const program = Effect.gen(function* () {
    const fs = yield* BoundedFs;
    const manifestPath = join(repoRoot, REL_MANIFEST);
    const bootstrapPath = join(repoRoot, REL_BOOTSTRAP);

    const manifestRead = yield* fs.readFileBounded(
      manifestPath,
      MAX_DRIFT_INPUT_BYTES,
    );
    const manifestErr = readLabel(manifestRead, REL_MANIFEST);
    if (manifestErr !== null || manifestRead._tag !== "Ok") {
      io.writeStderr((manifestErr ?? `ERROR unreadable: ${REL_MANIFEST}`) + "\n");
      return EXIT_FAIL_CLOSED;
    }

    const bootstrapRead = yield* fs.readFileBounded(
      bootstrapPath,
      MAX_DRIFT_INPUT_BYTES,
    );
    const bootstrapErr = readLabel(bootstrapRead, REL_BOOTSTRAP);
    if (bootstrapErr !== null || bootstrapRead._tag !== "Ok") {
      io.writeStderr(
        (bootstrapErr ?? `ERROR unreadable: ${REL_BOOTSTRAP}`) + "\n",
      );
      return EXIT_FAIL_CLOSED;
    }

    const parsed = parseManifestTools(manifestRead.text);
    if (parsed._tag === "Error") {
      io.writeStderr(`ERROR malformed tools table: ${parsed.reason}\n`);
      return EXIT_FAIL_CLOSED;
    }

    const result = reconcileDependencyDrift({
      checkerIds: authority.checkerIds,
      checkerMust: authority.checkerMust,
      tools: parsed.records,
      bootstrapText: bootstrapRead.text,
    });

    for (const line of result.stdout) {
      io.writeStdout(line + "\n");
    }
    for (const line of result.stderr) {
      io.writeStderr(line + "\n");
    }
    return result.exitCode;
  });

  return program.pipe(Effect.provide(layer));
}

/**
 * Resolve repository root from this module URL, bundled dist path, or cwd.
 */
export function resolveDriftRepoRoot(url?: string): string {
  if (url !== undefined) {
    try {
      return resolveRepoRoot(url);
    } catch {
      /* fall through */
    }
  }
  // Walk from cwd for env/reference-manifest.toml
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, REL_MANIFEST))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

// ---------------------------------------------------------------------------
// Bundled entry (skills/foreman/runtime/dist/dependency-drift.js)
// ---------------------------------------------------------------------------

function writeFully(
  stream: NodeJS.WriteStream,
  text: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      stream.off("error", onError);
      reject(err);
    };
    stream.once("error", onError);
    stream.write(text, (err) => {
      stream.off("error", onError);
      if (err) reject(err);
      else resolve();
    });
  });
}

const isMain =
  process.argv[1] !== undefined &&
  (() => {
    try {
      return fileURLToPath(import.meta.url) === process.argv[1];
    } catch {
      return false;
    }
  })();

if (isMain) {
  const pending: Promise<void>[] = [];
  const io: DriftIo = {
    writeStdout: (text) => {
      pending.push(writeFully(process.stdout, text));
    },
    writeStderr: (text) => {
      pending.push(writeFully(process.stderr, text));
    },
  };
  Effect.runPromise(runDependencyDrift(process.argv, io)).then(
    async (code) => {
      try {
        await Promise.all(pending);
      } catch {
        /* still set exit */
      }
      process.exitCode = code;
    },
    async () => {
      pending.push(
        writeFully(process.stderr, "dependency-drift: internal failure\n"),
      );
      try {
        await Promise.all(pending);
      } catch {
        /* ignore */
      }
      process.exitCode = EXIT_FAIL_CLOSED;
    },
  );
}
