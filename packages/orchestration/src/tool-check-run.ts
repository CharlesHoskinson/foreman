/**
 * tool-check inventory run: tool rows, skills, atomicity, readiness.
 * Vendor rows use TypeScript vendor-preflight inspect + projection directly.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Layer } from "effect";
import {
  PathLookup,
  ProcessExec,
  livePathLookup,
  liveProcessExec,
  type CapturedProcessResult,
} from "./queue-services.js";
import {
  PreflightClock,
  VendorPreflightFailure,
  inspectVendor,
  livePreflightClock,
} from "./vendor-preflight-live.js";
import { findCapability } from "./vendor-preflight-manifest.js";
import type { VendorCapabilityTableV1 } from "./vendor-preflight-manifest.js";
import {
  projectVendorPreflightToToolCheckRow,
  type ToolCheckRowStatus,
} from "./vendor-preflight-tool-check.js";
import {
  EXIT_INVALID_ARGUMENTS,
  EXIT_NOT_READY,
  EXIT_READY,
  USAGE,
  parseToolCheckArgv,
  type ToolCheckLane,
  type ToolCheckProfile,
} from "./tool-check-cli.js";
import { runAtomicityProbes } from "./tool-check-atomicity.js";
import {
  captureHostnameOs,
  detectWslFromEnv,
  readProcVersion,
  resolveCommonSkillsRoot,
  resolveFsClass,
  resolveRealPath,
} from "./tool-check-platform.js";
import {
  SKILL_IDS,
  profileToolIds,
  renderInventoryJson,
  renderReportText,
  type ReportModel,
  type ToolRow,
  type ToolStatus,
} from "./tool-check-report.js";

function captureText(r: CapturedProcessResult): string {
  return `${r.stdout}${r.stderr}`.replace(/\r/g, "");
}

function firstLine(s: string): string {
  return s.replace(/\r/g, "").split("\n")[0]?.trim() ?? "";
}

export type ToolCheckIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export type ToolCheckRunEnv = {
  readonly repoRoot: string;
  readonly capabilityTable: VendorCapabilityTableV1;
  readonly processEnv?: NodeJS.ProcessEnv;
  readonly nowUtc?: () => string;
  readonly layer?: Layer.Layer<ProcessExec | PathLookup | PreflightClock>;
  /** Test seam: inject vendor row instead of live inspect. */
  readonly vendorRowOverride?: (
    vendor: "grok" | "codex",
  ) => Effect.Effect<ToolRow, never, ProcessExec | PathLookup | PreflightClock>;
};

function homeDir(env: NodeJS.ProcessEnv): string {
  return env.HOME || env.USERPROFILE || "";
}

function whichOrNull(
  name: string,
): Effect.Effect<string | null, never, PathLookup> {
  return Effect.gen(function* () {
    const paths = yield* PathLookup;
    return yield* paths.which(name);
  });
}

function runCmd(
  command: string,
  args: readonly string[],
  timeoutMs = 8_000,
): Effect.Effect<CapturedProcessResult | null, never, ProcessExec> {
  return Effect.gen(function* () {
    const exec = yield* ProcessExec;
    const r = yield* exec
      .runCaptured({
        command,
        args: [...args],
        timeoutMs,
        maxOutputBytes: 64_000,
      })
      .pipe(Effect.either);
    if (r._tag === "Left") return null;
    return r.right;
  });
}

function row(
  id: string,
  status: ToolStatus,
  detail: string,
): ToolRow {
  return { id, status, detail };
}

/**
 * Inspect one known dependency (check_one port).
 */
export function checkOne(
  id: string,
  ctx: {
    readonly repoRoot: string;
    readonly capabilityTable: VendorCapabilityTableV1;
    readonly processEnv: NodeJS.ProcessEnv;
    readonly isWsl: boolean;
    readonly vendorRowOverride?: ToolCheckRunEnv["vendorRowOverride"];
  },
): Effect.Effect<ToolRow, never, ProcessExec | PathLookup | PreflightClock> {
  return Effect.gen(function* () {
    const env = ctx.processEnv;
    const home = homeDir(env);

    switch (id) {
      case "git": {
        const p = yield* whichOrNull("git");
        if (!p) return row("git", "missing", "");
        const r = yield* runCmd(p, ["--version"]);
        return row("git", "ok", r ? firstLine(captureText(r)) : "");
      }
      case "python3": {
        const py3 = yield* whichOrNull("python3");
        const py = py3 ?? (yield* whichOrNull("python"));
        if (!py) return row("python3", "missing", "");
        const verR = yield* runCmd(py, ["--version"]);
        let detail = verR ? firstLine(captureText(verR)) : "";
        if (!py3) {
          return row("python3", "outdated", detail);
        }
        const floor = yield* runCmd(py, [
          "-c",
          "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)",
        ]);
        let status: ToolStatus = "ok";
        if (!floor || floor.exitCode !== 0) {
          status = "outdated";
          detail = `${detail} (need >= 3.11)`;
        }
        const toml = yield* runCmd(py, ["-c", "import tomllib"]);
        if (!toml || toml.exitCode !== 0) {
          status = "outdated";
          detail = `${detail} (tomllib missing)`;
        }
        return row("python3", status, detail);
      }
      case "jq": {
        const p = yield* whichOrNull("jq");
        if (!p) return row("jq", "missing", "");
        const r = yield* runCmd(p, ["--version"]);
        return row("jq", "ok", r ? firstLine(captureText(r)) : "");
      }
      case "coreutils": {
        const stdbuf =
          (yield* whichOrNull("stdbuf")) ?? (yield* whichOrNull("gstdbuf"));
        if (!stdbuf) return row("coreutils", "missing", "");
        const r = yield* runCmd(stdbuf, ["--version"]);
        return row("coreutils", "ok", r ? firstLine(captureText(r)) : "");
      }
      case "bash": {
        const p = yield* whichOrNull("bash");
        if (!p) return row("bash", "missing", "");
        const r = yield* runCmd(p, ["--version"]);
        return row("bash", "ok", r ? firstLine(captureText(r)) : "");
      }
      case "nats-server": {
        const p = yield* whichOrNull("nats-server");
        if (!p) return row("nats-server", "missing", "");
        const r = yield* runCmd(p, ["--version"]);
        return row("nats-server", "ok", r ? firstLine(captureText(r)) : "");
      }
      case "nats-cli": {
        const p = yield* whichOrNull("nats");
        if (!p) return row("nats-cli", "missing", "");
        const r = yield* runCmd(p, ["--version"]);
        return row("nats-cli", "ok", r ? firstLine(captureText(r)) : "");
      }
      case "grok":
      case "codex":
        return yield* checkVendorRow(id, ctx);
      case "node": {
        const p = yield* whichOrNull("node");
        if (!p) return row("node", "missing", "");
        const r = yield* runCmd(p, ["--version"]);
        return row("node", "ok", r ? firstLine(captureText(r)) : "");
      }
      case "npm": {
        const p = yield* whichOrNull("npm");
        if (!p) return row("npm", "missing", "");
        const r = yield* runCmd(p, ["--version"]);
        return row("npm", "ok", r ? firstLine(captureText(r)) : "");
      }
      case "docker": {
        const p = yield* whichOrNull("docker");
        if (!p) return row("docker", "missing", "");
        const info = yield* runCmd(p, ["info"], 15_000);
        if (info && info.exitCode === 0) {
          const ver = yield* runCmd(p, [
            "version",
            "--format",
            "{{.Server.Version}}",
          ]);
          const detail = ver
            ? firstLine(captureText(ver))
            : firstLine(
                captureText(
                  (yield* runCmd(p, ["--version"])) ?? {
                    exitCode: 0,
                    stdout: "",
                    stderr: "",
                  },
                ),
              );
          return row("docker", "ok", detail);
        }
        return row(
          "docker",
          "degraded",
          "docker binary present but daemon not reachable",
        );
      }
      case "shellcheck": {
        const p = yield* whichOrNull("shellcheck");
        if (!p) return row("shellcheck", "missing", "");
        const r = yield* runCmd(p, ["--version"]);
        const detail = r
          ? captureText(r).split("\n").slice(0, 2).join(" ").trim()
          : "";
        return row("shellcheck", "ok", detail);
      }
      case "bats": {
        const p = yield* whichOrNull("bats");
        if (p) {
          const r = yield* runCmd(p, ["--version"]);
          return row("bats", "ok", r ? firstLine(captureText(r)) : "");
        }
        const staged = join(home, ".foreman/tools/bats-core/bin/bats");
        const paths = yield* PathLookup;
        if (yield* paths.isExecutable(staged)) {
          const r = yield* runCmd(staged, ["--version"]);
          return row("bats", "ok", r ? firstLine(captureText(r)) : "");
        }
        return row("bats", "missing", "");
      }
      case "markdownlint-cli2": {
        const p = yield* whichOrNull("markdownlint-cli2");
        if (!p) return row("markdownlint-cli2", "missing", "");
        const r = yield* runCmd(p, ["--version"]);
        return row(
          "markdownlint-cli2",
          "ok",
          r ? firstLine(captureText(r)) : "",
        );
      }
      case "strace": {
        const p = yield* whichOrNull("strace");
        if (p) {
          const r = yield* runCmd(p, ["--version"]);
          return row("strace", "ok", r ? firstLine(captureText(r)) : "");
        }
        return row(
          "strace",
          "missing",
          "lock atomicity cannot be licensed without it (syscall evidence)",
        );
      }
      case "codespell": {
        const p = yield* whichOrNull("codespell");
        if (p) {
          const r = yield* runCmd(p, ["--version"]);
          if (r && r.exitCode === 0) {
            return row("codespell", "ok", firstLine(captureText(r)));
          }
        }
        for (const pyName of ["python3", "python"] as const) {
          const py = yield* whichOrNull(pyName);
          if (!py) continue;
          const r = yield* runCmd(py, ["-m", "codespell_lib", "--version"]);
          if (r && r.exitCode === 0) {
            return row(
              "codespell",
              "ok",
              `python3 -m codespell_lib ${firstLine(captureText(r))}`,
            );
          }
        }
        return row("codespell", "missing", "");
      }
      case "bun": {
        const p = yield* whichOrNull("bun");
        if (!p) return row("bun", "missing", "");
        const r = yield* runCmd(p, ["--version"]);
        const detail = r ? firstLine(captureText(r)) : "";
        if (detail === "1.3.14") return row("bun", "ok", detail);
        return row(
          "bun",
          "outdated",
          `${detail} (expected 1.3.14 pin; winget does not self-pin)`,
        );
      }
      case "pueue": {
        const p = yield* whichOrNull("pueue");
        if (p) {
          const r = yield* runCmd(p, ["--version"]);
          return row("pueue", "ok", r ? firstLine(captureText(r)) : "");
        }
        const paths = yield* PathLookup;
        for (const candidate of [
          join(home, ".foreman/tools/pueue/pueue"),
          join(home, ".foreman/tools/pueue/pueue.exe"),
        ]) {
          if (yield* paths.isExecutable(candidate)) {
            const r = yield* runCmd(candidate, ["--version"]);
            return row("pueue", "ok", r ? firstLine(captureText(r)) : "");
          }
        }
        return row("pueue", "missing", "");
      }
      case "lychee": {
        let lychee = env.LYCHEE || (yield* whichOrNull("lychee")) || "";
        if (!lychee && env.LOCALAPPDATA) {
          const winget = join(
            env.LOCALAPPDATA,
            "Microsoft/WinGet/Links/lychee.exe",
          );
          if (existsSync(winget)) lychee = winget;
        }
        if (!lychee) return row("lychee", "missing", "");
        const r = yield* runCmd(lychee, ["--version"]);
        if (r && r.exitCode === 0) {
          return row("lychee", "ok", firstLine(captureText(r)));
        }
        return row("lychee", "missing", "");
      }
      case "flock": {
        const p = yield* whichOrNull("flock");
        if (!p) return row("flock", "missing", "");
        return row("flock", "ok", p);
      }
      case "gh": {
        const p = yield* whichOrNull("gh");
        if (!p) return row("gh", "missing", "");
        const r = yield* runCmd(p, ["--version"]);
        return row("gh", "ok", r ? firstLine(captureText(r)) : "");
      }
      case "timeout": {
        const p =
          (yield* whichOrNull("timeout")) ?? (yield* whichOrNull("gtimeout"));
        if (!p) return row("timeout", "missing", "");
        return row("timeout", "ok", p);
      }
      case "foreman_skill": {
        const candidates = [
          join(home, ".claude/skills/foreman/SKILL.md"),
          join(home, ".agents/skills/foreman/SKILL.md"),
          join(home, ".grok/skills/foreman/SKILL.md"),
        ];
        if (candidates.some((c) => existsSync(c))) {
          return row(
            "foreman_skill",
            "ok",
            "skill linked under ~/.claude|agents|grok/skills/foreman",
          );
        }
        if (existsSync(join(ctx.repoRoot, "skills/foreman/SKILL.md"))) {
          return row(
            "foreman_skill",
            "degraded",
            "repo has skill but not installed to home (run install.sh)",
          );
        }
        return row("foreman_skill", "missing", "");
      }
      case "foreman-launch": {
        const flRoot = ctx.repoRoot;
        const suffix =
          process.platform === "win32" ||
          /^MINGW|^MSYS|^CYGWIN/i.test(process.platform)
            ? ".exe"
            : "";
        const flBin =
          env.FOREMAN_LAUNCH ||
          join(flRoot, `launcher/dist/foreman-launch${suffix}`);
        const paths = yield* PathLookup;
        if (yield* paths.isExecutable(flBin)) {
          return row("foreman-launch", "ok", flBin);
        }
        const bun = yield* whichOrNull("bun");
        if (bun) {
          return row(
            "foreman-launch",
            "missing",
            `NOT-READY: ${flBin} absent; build it: (cd launcher && bun run build:posix)`,
          );
        }
        return row(
          "foreman-launch",
          "degraded",
          `DEGRADED: ${flBin} absent and bun is not installed (bun is should-tier); install bun, then run: (cd launcher && bun run build:posix)`,
        );
      }
      case "foreman_home_fs": {
        const fhPath = env.FOREMAN_HOME || join(home, ".foreman");
        const fsClass = yield* resolveFsClass(fhPath);
        if (fsClass === "mnt-drvfs" || fsClass === "network") {
          return row(
            "foreman_home_fs",
            "degraded",
            `${fhPath} class=${fsClass} (event log fsync guarantees do not hold on this filesystem)`,
          );
        }
        return row("foreman_home_fs", "ok", `${fhPath} class=${fsClass}`);
      }
      default:
        return row(id, "unknown", `no checker for ${id}`);
    }
  });
}

function checkVendorRow(
  vendor: "grok" | "codex",
  ctx: {
    readonly capabilityTable: VendorCapabilityTableV1;
    readonly vendorRowOverride?: ToolCheckRunEnv["vendorRowOverride"];
  },
): Effect.Effect<ToolRow, never, ProcessExec | PathLookup | PreflightClock> {
  return Effect.gen(function* () {
    if (ctx.vendorRowOverride) {
      const overridden = yield* ctx.vendorRowOverride(vendor);
      if (overridden.id !== vendor) {
        return row(vendor, "degraded", "vendor-preflight row vendor mismatch");
      }
      return overridden;
    }
    const capability = findCapability(ctx.capabilityTable, vendor);
    if (capability === null) {
      return row(
        vendor,
        "degraded",
        "vendor capability not configured in capability table",
      );
    }
    const either = yield* inspectVendor(capability).pipe(Effect.either);
    if (either._tag === "Left") {
      const err = either.left;
      const detail =
        err instanceof VendorPreflightFailure
          ? `vendor-preflight boundary failure: ${err.reason}`
          : "vendor-preflight internal failure";
      return row(vendor, "degraded", detail);
    }
    const record = either.right;
    // Vendor binding: refuse a record that does not match the requested vendor.
    if (record.vendor !== vendor) {
      return row(vendor, "degraded", "vendor-preflight row vendor mismatch");
    }
    const projected = projectVendorPreflightToToolCheckRow(record);
    if (projected.vendor !== vendor) {
      return row(vendor, "degraded", "vendor-preflight row vendor mismatch");
    }
    const status = projected.status as ToolCheckRowStatus;
    // Detail is already sanitized and bounded by the projection.
    if (!projected.detail || projected.detail.length === 0) {
      return row(vendor, "degraded", "vendor-preflight row detail empty");
    }
    return row(vendor, status, projected.detail);
  });
}

function checkSkills(
  repoRoot: string,
  processEnv: NodeJS.ProcessEnv,
  commonSkillsRoot: string | null,
): ToolRow[] {
  const home = homeDir(processEnv);
  const out: ToolRow[] = [];
  for (const id of SKILL_IDS) {
    const skillPath = join(home, ".claude/skills", id);
    const repoSkillDir = join(repoRoot, "skills", id);
    if (!existsSync(repoSkillDir)) {
      out.push(
        row(
          id,
          "missing",
          `repo skill directory missing: skills/${id}`,
        ),
      );
      continue;
    }
    let repoSkillPath: string;
    try {
      repoSkillPath = realpathSync(repoSkillDir);
    } catch {
      repoSkillPath = repoSkillDir;
    }
    try {
      const st = lstatSync(skillPath);
      if (st.isSymbolicLink()) {
        let linkTarget = readlinkSync(skillPath);
        if (!isAbsolute(linkTarget)) {
          linkTarget = join(dirname(skillPath), linkTarget);
        }
        if (existsSync(linkTarget)) {
          try {
            linkTarget = realpathSync(linkTarget);
          } catch {
            /* keep */
          }
        }
        const commonMatch =
          commonSkillsRoot !== null &&
          linkTarget === join(commonSkillsRoot, id);
        if (linkTarget === repoSkillPath || commonMatch) {
          out.push(
            row(id, "ok", `linked at ~/.claude/skills/${id}`),
          );
        } else {
          out.push(row(id, "warn", "present but not linked to repo"));
        }
      } else if (existsSync(skillPath)) {
        out.push(row(id, "warn", "present but not linked to repo"));
      } else {
        out.push(
          row(id, "missing", `not linked at ~/.claude/skills/${id}`),
        );
      }
    } catch {
      out.push(
        row(id, "missing", `not linked at ~/.claude/skills/${id}`),
      );
    }
  }
  return out;
}

export type ToolCheckResult = {
  readonly exitCode: number;
  readonly body: string;
  readonly model: ReportModel | null;
};

/**
 * Run a full tool-check inventory once.
 */
export function runToolCheck(
  argv: readonly string[],
  io: ToolCheckIo,
  env: ToolCheckRunEnv,
): Effect.Effect<ToolCheckResult> {
  return Effect.gen(function* () {
    const parsed = parseToolCheckArgv(argv);
    if (parsed._tag === "Help") {
      io.writeStdout(USAGE + "\n");
      return { exitCode: EXIT_READY, body: USAGE, model: null };
    }
    if (parsed._tag === "Invalid") {
      io.writeStderr(parsed.message + "\n");
      return {
        exitCode: EXIT_INVALID_ARGUMENTS,
        body: parsed.message,
        model: null,
      };
    }

    const processEnv = env.processEnv ?? process.env;
    const baseLayer =
      env.layer ??
      Layer.mergeAll(liveProcessExec, livePathLookup, livePreflightClock);

    const program = Effect.gen(function* () {
      const clock = yield* PreflightClock;
      const now =
        env.nowUtc?.() ??
        (yield* clock.nowUtcRfc3339()).replace(/\.\d{3}Z$/, "Z");
      // Prefer second-precision Z timestamps like the shell date -u format
      // when using live clock with milliseconds — keep full ISO if present.
      const time = env.nowUtc
        ? env.nowUtc()
        : (yield* clock.nowUtcRfc3339());
      void now;

      const { host, os } = yield* captureHostnameOs();
      const wslDet = detectWslFromEnv(processEnv, readProcVersion());
      if (wslDet.overrideNote) {
        io.writeStderr(wslDet.overrideNote + "\n");
      }
      const isWsl = wslDet.isWsl;
      const { must, should } = profileToolIds(parsed.profile, isWsl);

      const seen = new Set<string>();
      const tools: ToolRow[] = [];
      for (const id of [...must, ...should]) {
        if (seen.has(id)) continue;
        seen.add(id);
        tools.push(
          yield* checkOne(id, {
            repoRoot: env.repoRoot,
            capabilityTable: env.capabilityTable,
            processEnv,
            isWsl,
            vendorRowOverride: env.vendorRowOverride,
          }),
        );
      }

      const commonSkills = yield* resolveCommonSkillsRoot(env.repoRoot);
      const skills = checkSkills(env.repoRoot, processEnv, commonSkills);

      const missing: string[] = [];
      const outdated: string[] = [];
      const degraded: string[] = [];
      const notAuth: string[] = [];
      for (const t of tools) {
        if (t.status === "missing") missing.push(t.id);
        else if (t.status === "outdated") outdated.push(t.id);
        else if (t.status === "degraded") degraded.push(t.id);
        else if (t.status === "not_authenticated") notAuth.push(t.id);
      }

      const mustFail: string[] = [];
      for (const id of must) {
        const t = tools.find((x) => x.id === id);
        if (t && t.status !== "ok") {
          mustFail.push(`${id}:${t.status}`);
        }
      }

      // WSL hard/full: missing launcher blocks when reported missing.
      if (isWsl && (parsed.profile === "hard" || parsed.profile === "full")) {
        const fl = tools.find((t) => t.id === "foreman-launch");
        if (fl && fl.status === "missing") {
          if (!mustFail.includes("foreman-launch:missing")) {
            mustFail.push("foreman-launch:missing");
          }
        }
      }

      const atomic = yield* runAtomicityProbes({
        timestamp: time,
        profile: parsed.profile,
        hostClass: "linux-native",
      });

      if (parsed.profile === "durable" && !atomic.trustedAtomic) {
        mustFail.push("lock_atomicity:no_trusted_atomic_mechanism");
      }

      const ready = mustFail.length === 0;
      const model: ReportModel = {
        profile: parsed.profile,
        host,
        os,
        wsl: isWsl,
        time,
        repo: resolveRealPath(env.repoRoot),
        tools,
        skills,
        lockAtomicity: atomic.rows,
        lockAtomicityInfo: atomic.info,
        ready,
        mustFail,
        lane: parsed.lane,
      };

      const body = parsed.json
        ? renderInventoryJson(model)
        : renderReportText(model);

      io.writeStdout(body + "\n");

      if (parsed.out) {
        try {
          mkdirSync(dirname(parsed.out), { recursive: true });
          writeFileSync(parsed.out, body + "\n", "utf8");
          io.writeStderr(`[tool-check] wrote ${parsed.out}\n`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          io.writeStderr(`[tool-check] failed to write ${parsed.out}: ${msg}\n`);
        }
      }

      return {
        exitCode: ready ? EXIT_READY : EXIT_NOT_READY,
        body,
        model,
      } satisfies ToolCheckResult;
    });

    return yield* program.pipe(Effect.provide(baseLayer));
  }).pipe(
    Effect.catchAllDefect(() =>
      Effect.sync(() => {
        io.writeStderr("tool-check: internal failure\n");
        return {
          exitCode: EXIT_INVALID_ARGUMENTS,
          body: "tool-check: internal failure",
          model: null,
        } satisfies ToolCheckResult;
      }),
    ),
  );
}

export function resolveRepoRoot(url: string = import.meta.url): string {
  const file = fileURLToPath(url);
  const normalized = file.replace(/\\/g, "/");
  if (normalized.includes("/skills/foreman/runtime/dist/")) {
    return resolveRealPath(join(dirname(file), "../../../.."));
  }
  if (normalized.includes("/packages/orchestration/src/")) {
    return resolveRealPath(join(dirname(file), "../../.."));
  }
  let dir = dirname(file);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "env/reference-manifest.toml"))) {
      return resolveRealPath(dir);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolveRealPath(process.cwd());
}

export type { ToolCheckProfile, ToolCheckLane };
