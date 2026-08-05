/**
 * Foreman Setup stage (Sprint 3 R4C2): tool-check readiness projection plus
 * vendor-preflight record persistence. Never authenticates a vendor itself.
 *
 * Exit contract:
 *   0 READY
 *   1 NOT-READY
 *   2 invalid arguments
 *   3 runtime / persistence / decode / filesystem boundary failure
 */

import {
  chmodSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  unlinkSync,
  accessSync,
} from "node:fs";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import {
  PathLookup,
  ProcessExec,
  livePathLookup,
  liveProcessExec,
  readFileBoundedSync,
  type CapturedProcessResult,
} from "./queue-services.js";
import {
  PreflightClock,
  livePreflightClock,
} from "./vendor-preflight-live.js";
import {
  PreflightRecordStore,
  PreflightStoreFailure,
  livePreflightRecordStore,
} from "./vendor-preflight-store.js";
import type { VendorPreflightRecordV1 } from "./vendor-preflight-contract.js";
import type { VendorCapabilityTableV1 } from "./vendor-preflight-manifest.js";
import {
  laneReadyFromTools,
  type ReportModel,
} from "./tool-check-report.js";
import {
  runToolCheck,
  resolveRepoRoot,
  type ToolCheckIo,
  type ToolCheckRunEnv,
} from "./tool-check-run.js";
import {
  detectWslFromEnv,
  readProcVersion,
} from "./tool-check-platform.js";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

export const SETUP_PROFILES = ["soft", "hard", "full"] as const;
export type SetupProfile = (typeof SETUP_PROFILES)[number];

export const SETUP_LANES = ["grok", "codex"] as const;
export type SetupLane = (typeof SETUP_LANES)[number];

export const EXIT_READY = 0;
export const EXIT_NOT_READY = 1;
export const EXIT_INVALID_ARGUMENTS = 2;
export const EXIT_BOUNDARY_FAILURE = 3;

export const USAGE =
  "usage: foreman-setup [--profile soft|hard|full] [--lane grok|codex]";

export const MSG_BOUNDARY_FAILURE =
  "foreman-setup: boundary failure (persistence or runtime)";

export const MSG_INTERNAL_FAILURE = "foreman-setup: internal failure";

/** UTF-8 bound for repository durable config TOML. */
export const MAX_DURABLE_CONFIG_BYTES = 1_048_576;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SetupIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export type ParsedSetupArgv =
  | {
      readonly _tag: "Run";
      readonly profile: SetupProfile;
      readonly lane: SetupLane | null;
    }
  | { readonly _tag: "Help" }
  | { readonly _tag: "Invalid"; readonly message: string };

export type LauncherEnsureResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export type SetupRunEnv = {
  readonly repoRoot: string;
  readonly capabilityTable: VendorCapabilityTableV1;
  readonly processEnv?: NodeJS.ProcessEnv;
  readonly nowUtc?: () => string;
  readonly layer?: Layer.Layer<ProcessExec | PathLookup | PreflightClock>;
  readonly storeLayer?: Layer.Layer<PreflightRecordStore>;
  /**
   * Injected launcher ensure (WSL). Default builds the POSIX launcher via
   * ProcessExec when needed. Tests inject a no-op.
   */
  readonly ensureLauncher?: () => Effect.Effect<
    LauncherEnsureResult,
    never,
    ProcessExec | PathLookup
  >;
  /**
   * When set, skip reading repository config.toml for durable.enabled.
   * `null` means "absent / default true — no warning". `undefined` means
   * "read from repo".
   */
  readonly durableEnabled?: boolean | null;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Strip node binary and script path from process.argv-style input.
 */
export function stripSetupNodeArgv(
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
      args[0]!.includes("foreman-setup"))
  ) {
    args = args.slice(1);
  }
  return args;
}

function isProfile(v: string): v is SetupProfile {
  return (SETUP_PROFILES as readonly string[]).includes(v);
}

function isLane(v: string): v is SetupLane {
  return (SETUP_LANES as readonly string[]).includes(v);
}

/**
 * Parse Setup argv. Unknown flags and bad values are Invalid (exit 2).
 */
export function parseSetupArgv(argv: readonly string[]): ParsedSetupArgv {
  const args = stripSetupNodeArgv(argv);
  let profile: SetupProfile = "soft";
  let lane: SetupLane | null = null;

  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (a === "-h" || a === "--help") {
      return { _tag: "Help" };
    }
    if (a === "--profile") {
      const v = args[i + 1];
      if (v === undefined) {
        return { _tag: "Invalid", message: USAGE };
      }
      if (!isProfile(v)) {
        return {
          _tag: "Invalid",
          message: `bad profile: ${v} (soft|hard|full)`,
        };
      }
      profile = v;
      i += 2;
      continue;
    }
    if (a === "--lane") {
      const v = args[i + 1];
      if (v === undefined) {
        return { _tag: "Invalid", message: USAGE };
      }
      if (v === "claude") {
        return {
          _tag: "Invalid",
          message:
            "unsupported --lane claude: T7 removed claude lane advertising because isolated HOME is unverified",
        };
      }
      if (!isLane(v)) {
        return { _tag: "Invalid", message: `bad lane: ${v} (grok|codex)` };
      }
      lane = v;
      i += 2;
      continue;
    }
    return { _tag: "Invalid", message: `unknown arg: ${a}` };
  }

  return { _tag: "Run", profile, lane };
}

/**
 * Operator-facing login instruction. Matches the legacy Setup shell strings
 * for grok/codex. Never returns absolute paths.
 */
export function authInstruction(vendor: string): string {
  switch (vendor) {
    case "grok":
      return "grok login --device-code";
    case "codex":
      return "codex login  (interactive/localhost — run in a persistent shell via: ! codex login) OR headless: printenv OPENAI_API_KEY | codex login --with-api-key";
    case "claude":
      return "claude auth login";
    default:
      return `(no known auth instruction for ${vendor})`;
  }
}

export function resolveForemanHome(env: NodeJS.ProcessEnv): string {
  if (env.FOREMAN_HOME && env.FOREMAN_HOME.length > 0) {
    return env.FOREMAN_HOME;
  }
  const home = env.HOME || env.USERPROFILE || "";
  return join(home, ".foreman");
}

export function resolvePreflightRecordPath(
  foremanHome: string,
  vendor: string,
): string {
  return join(foremanHome, "preflight", `${vendor}.json`);
}

/**
 * Read `durable.enabled` from repository TOML text. Returns null when the
 * key is absent. Does not apply environment overrides — Setup reports the
 * committed TOML value only.
 */
export function parseDurableEnabledFromToml(text: string): boolean | null {
  // Minimal section parse: look for [durable] then enabled = true|false.
  const lines = text.split(/\r?\n/);
  let inDurable = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      inDurable = section[1] === "durable";
      continue;
    }
    if (!inDurable) continue;
    const m = line.match(/^enabled\s*=\s*(true|false)\s*(?:#.*)?$/i);
    if (m) {
      return m[1]!.toLowerCase() === "true";
    }
  }
  return null;
}

function readDurableEnabledFromRepo(repoRoot: string): boolean | null {
  const path = join(repoRoot, ".foreman", "config.toml");
  const bounded = readFileBoundedSync(path, MAX_DURABLE_CONFIG_BYTES);
  if (bounded._tag !== "Ok") return null;
  return parseDurableEnabledFromToml(bounded.text);
}

function launcherPresent(repoRoot: string): boolean {
  const posix = join(repoRoot, "launcher", "dist", "foreman-launch");
  const win = join(repoRoot, "launcher", "dist", "foreman-launch.exe");
  return isExecutablePath(posix) || isExecutablePath(win);
}

function isExecutablePath(p: string): boolean {
  try {
    accessSync(p, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function captureText(r: CapturedProcessResult): string {
  return `${r.stdout}${r.stderr}`.replace(/\r/g, "");
}

/**
 * Verify a launcher executable self-identifies as foreman-launch.
 */
export function launcherRunnable(
  launcherPath: string,
  run: (args: readonly string[]) => Effect.Effect<CapturedProcessResult | null>,
): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    if (!isExecutablePath(launcherPath)) return false;
    const r = yield* run(["--version"]);
    if (r === null) return false;
    const line = captureText(r).split("\n")[0]?.trim() ?? "";
    return line.startsWith("foreman-launch ");
  });
}

/**
 * WSL-only POSIX launcher ensure. Injected ProcessExec runs the external
 * `bun run build:posix` command. Absent bun is a warning, not NOT-READY.
 * Build failure is NOT-READY.
 */
export function ensurePosixLauncher(
  repoRoot: string,
  processEnv: NodeJS.ProcessEnv,
  log: (msg: string) => void,
): Effect.Effect<LauncherEnsureResult, never, ProcessExec | PathLookup> {
  return Effect.gen(function* () {
    const wsl = detectWslFromEnv(processEnv, readProcVersion());
    if (wsl.overrideNote) {
      log(wsl.overrideNote.replace(/^\[foreman\]\s*/, ""));
    }
    if (!wsl.isWsl) {
      return { ok: true as const };
    }

    const launcherRel = "launcher/dist/foreman-launch";
    const launcher = join(repoRoot, launcherRel);
    const launcherDir = join(repoRoot, "launcher", "dist");
    const exec = yield* ProcessExec;
    const paths = yield* PathLookup;

    const runVersion = (bin: string) =>
      exec
        .runCaptured({
          command: bin,
          args: ["--version"],
          timeoutMs: 8_000,
          maxOutputBytes: 4_096,
        })
        .pipe(
          Effect.map((r) => r as CapturedProcessResult),
          Effect.catchAll(() => Effect.succeed(null as CapturedProcessResult | null)),
        );

    if (yield* launcherRunnable(launcher, () => runVersion(launcher))) {
      log(`launcher already built: ${launcherRel}`);
      return { ok: true as const };
    }

    // Remove non-runnable leftover.
    try {
      if (existsSync(launcher) || lstatSyncSoft(launcher)) {
        log(`WARN: removing non-runnable launcher before rebuild: ${launcherRel}`);
        try {
          unlinkSync(launcher);
        } catch {
          log("ERROR: could not remove non-runnable launcher");
          return { ok: false as const, reason: "launcher_remove_failed" };
        }
      }
    } catch {
      /* absent is fine */
    }

    const bunPath = yield* paths.which("bun");
    if (bunPath === null) {
      log(
        "WARN: bun is unavailable; POSIX launcher remains absent. Install bun, then run: (cd launcher && bun run build:posix)",
      );
      return { ok: true as const };
    }

    try {
      mkdirSync(launcherDir, { recursive: true });
    } catch {
      log("ERROR: could not create launcher output directory");
      return { ok: false as const, reason: "launcher_dir_failed" };
    }

    let buildDir: string;
    try {
      buildDir = mkdtempSync(join(launcherDir, ".foreman-launch.build."));
    } catch {
      log("ERROR: could not create temporary launcher build directory");
      return { ok: false as const, reason: "launcher_tmpdir_failed" };
    }
    const buildLauncher = join(buildDir, "foreman-launch");

    log("building POSIX launcher: (cd launcher && bun run build:posix)");
    const buildResult = yield* exec
      .runCaptured({
        command: bunPath,
        args: ["run", "build:posix", "--outfile", buildLauncher],
        timeoutMs: 120_000,
        maxOutputBytes: 256_000,
        cwd: join(repoRoot, "launcher"),
      })
      .pipe(Effect.either);

    if (buildResult._tag === "Left" || buildResult.right.exitCode !== 0) {
      cleanupBuild(buildDir, buildLauncher, launcher);
      log("ERROR: POSIX launcher build failed");
      return { ok: false as const, reason: "launcher_build_failed" };
    }

    if (!(yield* launcherRunnable(buildLauncher, () => runVersion(buildLauncher)))) {
      cleanupBuild(buildDir, buildLauncher, launcher);
      log("ERROR: POSIX launcher build completed without runnable executable output");
      return { ok: false as const, reason: "launcher_not_runnable" };
    }

    try {
      renameSync(buildLauncher, launcher);
      try {
        chmodSync(launcher, 0o755);
      } catch {
        /* best-effort */
      }
    } catch {
      cleanupBuild(buildDir, buildLauncher, launcher);
      log("ERROR: could not publish POSIX launcher atomically");
      return { ok: false as const, reason: "launcher_publish_failed" };
    }
    try {
      rmSync(buildDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    log(`built launcher: ${launcherRel}`);
    return { ok: true as const };
  });
}

function lstatSyncSoft(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function cleanupBuild(
  buildDir: string,
  buildLauncher: string,
  launcher: string,
): void {
  try {
    unlinkSync(buildLauncher);
  } catch {
    /* ignore */
  }
  try {
    if (existsSync(launcher) && !isExecutablePath(launcher)) {
      unlinkSync(launcher);
    }
  } catch {
    /* ignore */
  }
  try {
    rmSync(buildDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function notAuthenticatedVendors(model: ReportModel | null): readonly string[] {
  if (model === null) return [];
  return model.tools
    .filter((t) => t.status === "not_authenticated")
    .map((t) => t.id);
}

function setupReady(
  model: ReportModel | null,
  toolCheckExit: number,
  lane: SetupLane | null,
): boolean {
  if (model === null) return toolCheckExit === 0;
  if (lane !== null) {
    return laneReadyFromTools(model.tools, lane) === true;
  }
  return model.ready;
}

// ---------------------------------------------------------------------------
// Main run
// ---------------------------------------------------------------------------

/**
 * Run Setup once. Writes the tool-check report, optional durable warning,
 * login instructions for positive not-authenticated evidence only, and
 * SETUP: READY|NOT-READY. Persists each requested vendor preflight record
 * under FOREMAN_HOME/preflight/<vendor>.json before returning exit 1.
 */
export function runForemanSetup(
  argv: readonly string[],
  io: SetupIo,
  env: SetupRunEnv,
): Effect.Effect<number> {
  return Effect.gen(function* () {
    const parsed = parseSetupArgv(argv);
    if (parsed._tag === "Help") {
      io.writeStdout(USAGE + "\n");
      return EXIT_READY;
    }
    if (parsed._tag === "Invalid") {
      io.writeStderr(parsed.message + "\n");
      return EXIT_INVALID_ARGUMENTS;
    }

    const processEnv = env.processEnv ?? process.env;
    const baseLayer =
      env.layer ??
      Layer.mergeAll(liveProcessExec, livePathLookup, livePreflightClock);
    const storeLayer = env.storeLayer ?? livePreflightRecordStore;

    const log = (msg: string) => {
      io.writeStderr(`[foreman] ${msg}\n`);
    };

    // --- WSL launcher ensure ------------------------------------------------
    const ensure =
      env.ensureLauncher ??
      (() => ensurePosixLauncher(env.repoRoot, processEnv, log));
    const launcherResult = yield* ensure().pipe(Effect.provide(baseLayer));
    if (!launcherResult.ok) {
      io.writeStdout("SETUP: NOT-READY\n");
      return EXIT_NOT_READY;
    }

    // --- durable.enabled reporting (repo TOML only) -------------------------
    const durable =
      env.durableEnabled !== undefined
        ? env.durableEnabled
        : readDurableEnabledFromRepo(env.repoRoot);
    if (durable === false) {
      const launcherStatus = launcherPresent(env.repoRoot)
        ? "present"
        : "absent";
      io.writeStdout(
        `SETUP CONFIG: durable.enabled=false differs from the shipped true default that prevents a subagent backgrounding a long command and ending its turn; launcher=${launcherStatus}\n`,
      );
    }

    // --- tool-check with single-probe record capture ------------------------
    const captured = new Map<string, VendorPreflightRecordV1>();
    const tcIo: ToolCheckIo = {
      writeStdout: (t) => io.writeStdout(t),
      writeStderr: (t) => io.writeStderr(t),
    };
    const tcArgv = [
      "--profile",
      parsed.profile,
      ...(parsed.lane !== null ? (["--lane", parsed.lane] as const) : []),
    ];
    const tcEnv: ToolCheckRunEnv = {
      repoRoot: env.repoRoot,
      capabilityTable: env.capabilityTable,
      processEnv,
      ...(env.nowUtc !== undefined ? { nowUtc: env.nowUtc } : {}),
      ...(env.layer !== undefined ? { layer: env.layer } : {}),
      onVendorRecord: (record) =>
        Effect.sync(() => {
          captured.set(record.vendor, record);
        }),
    };

    const tcResult = yield* runToolCheck(tcArgv, tcIo, tcEnv);

    // --- persist requested vendors ------------------------------------------
    const vendorsToPersist: readonly SetupLane[] =
      parsed.lane !== null ? [parsed.lane] : ["grok", "codex"];
    const foremanHome = resolveForemanHome(processEnv);

    for (const vendor of vendorsToPersist) {
      const record = captured.get(vendor);
      if (record === undefined) {
        // No live inspect record (capability missing / override path). Skip
        // persist rather than inventing a record; readiness still projects
        // from the tool-check report.
        continue;
      }
      if (record.vendor !== vendor) {
        io.writeStderr(MSG_BOUNDARY_FAILURE + "\n");
        return EXIT_BOUNDARY_FAILURE;
      }
      const dest = resolvePreflightRecordPath(foremanHome, vendor);
      const writeEither = yield* Effect.gen(function* () {
        const store = yield* PreflightRecordStore;
        yield* store.write(dest, record);
      }).pipe(Effect.provide(storeLayer), Effect.either);

      if (writeEither._tag === "Left") {
        const err = writeEither.left;
        // Sanitized public diagnostic: no absolute paths, stacks, or bytes.
        if (err instanceof PreflightStoreFailure) {
          io.writeStderr(
            `foreman-setup: preflight persist failed (${err.reason})\n`,
          );
        } else {
          io.writeStderr(MSG_BOUNDARY_FAILURE + "\n");
        }
        // Never report READY after a persistence failure.
        return EXIT_BOUNDARY_FAILURE;
      }
    }

    // --- login instructions: positive not-authenticated only ----------------
    const notAuth = notAuthenticatedVendors(tcResult.model);
    for (const v of notAuth) {
      io.writeStdout(`${v}: NOT-READY -- run ${authInstruction(v)}\n`);
    }

    // --- readiness projection -----------------------------------------------
    const ready = setupReady(tcResult.model, tcResult.exitCode, parsed.lane);
    if (ready) {
      io.writeStdout("SETUP: READY\n");
      return EXIT_READY;
    }
    io.writeStdout("SETUP: NOT-READY\n");
    return EXIT_NOT_READY;
  }).pipe(
    Effect.catchAllDefect(() =>
      Effect.sync(() => {
        io.writeStderr(MSG_INTERNAL_FAILURE + "\n");
        return EXIT_BOUNDARY_FAILURE;
      }),
    ),
  );
}

export { resolveRepoRoot };
