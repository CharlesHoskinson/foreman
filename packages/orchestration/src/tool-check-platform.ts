/**
 * Platform probes for tool-check: WSL detection, host class, filesystem class.
 * POSIX/WSL-only helpers degrade explicitly on unsupported Windows hosts.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import {
  PathLookup,
  ProcessExec,
  type CapturedProcessResult,
} from "./queue-services.js";

export type FsClass = "local" | "mnt-drvfs" | "network" | "fuse";
export type HostClass =
  | "linux-native"
  | "wsl-linux"
  | "msys2-git-bash"
  | "windows-native";

function captureText(r: CapturedProcessResult): string {
  return `${r.stdout}${r.stderr}`.replace(/\r/g, "");
}

export function detectWslFromEnv(
  env: NodeJS.ProcessEnv,
  procVersionText: string | null,
): { isWsl: boolean; overrideNote: string | null } {
  const force = env.FOREMAN_TEST_WSL_FORCE;
  if (force === "1") {
    return {
      isWsl: true,
      overrideNote:
        "[foreman] TEST OVERRIDE: FOREMAN_TEST_WSL_FORCE=1 forced WSL detection to wsl=1",
    };
  }
  if (force === "0") {
    return {
      isWsl: false,
      overrideNote:
        "[foreman] TEST OVERRIDE: FOREMAN_TEST_WSL_FORCE=0 forced WSL detection to wsl=0",
    };
  }
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) {
    return { isWsl: true, overrideNote: null };
  }
  if (procVersionText && /microsoft|wsl/i.test(procVersionText)) {
    return { isWsl: true, overrideNote: null };
  }
  return { isWsl: false, overrideNote: null };
}

/**
 * Derive host class from captured OS name + WSL flag + optional override.
 * Pure seam: never reads ambient process.platform. Windows is detected from
 * the provided osName (Windows_NT from captureHostnameOs, or win32 when that
 * is the captured platform string). MSYS/Cygwin uname forms take precedence.
 */
export function checkHostClass(
  env: NodeJS.ProcessEnv,
  osName: string,
  isWsl: boolean,
): HostClass {
  if (env.FOREMAN_LOCK_HOST_CLASS) {
    const v = env.FOREMAN_LOCK_HOST_CLASS.trim();
    if (
      v === "linux-native" ||
      v === "wsl-linux" ||
      v === "msys2-git-bash" ||
      v === "windows-native"
    ) {
      return v;
    }
  }
  const os = osName.trim();
  // MSYS/Cygwin Git-Bash style uname -s values precede windows-native.
  if (/^MINGW|^MSYS|^CYGWIN/i.test(os)) {
    return "msys2-git-bash";
  }
  // Windows from injected/captured osName only — not ambient process.platform.
  if (/^win32$/i.test(os) || /^Windows(_NT)?$/i.test(os)) {
    return "windows-native";
  }
  if (isWsl) return "wsl-linux";
  return "linux-native";
}

/**
 * Classify filesystem for lock coverage. Best-effort; defaults to local.
 */
export function checkFsClassFromProbe(
  path: string,
  fstype: string,
  mountTarget: string,
): FsClass {
  const probe = path;
  if (probe.startsWith("//") || probe.startsWith("\\\\")) {
    return "network";
  }
  const ft = fstype.toLowerCase();
  if (
    ft === "nfs" ||
    ft === "nfs4" ||
    ft === "cifs" ||
    ft === "smb" ||
    ft === "smb3" ||
    ft === "smbfs" ||
    ft === "afs" ||
    ft === "ncpfs"
  ) {
    return "network";
  }
  if (
    probe.startsWith("/mnt/") ||
    mountTarget === "/mnt" ||
    mountTarget.startsWith("/mnt/")
  ) {
    return "mnt-drvfs";
  }
  if (ft === "fuse" || ft.startsWith("fuse.") || ft === "fuseblk") {
    return "fuse";
  }
  return "local";
}

export function nearestExistingPath(path: string): string {
  let probe = path;
  while (probe !== "/" && probe !== "." && probe !== "" && !existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  if (!existsSync(probe)) return process.platform === "win32" ? path : "/";
  return probe;
}

/**
 * Resolve fs class for a path using findmnt/df when available.
 */
export function resolveFsClass(
  path: string,
): Effect.Effect<FsClass, never, ProcessExec | PathLookup> {
  return Effect.gen(function* () {
    if (process.platform === "win32") {
      if (path.startsWith("\\\\") || path.startsWith("//")) return "network";
      return "local";
    }
    const probe = nearestExistingPath(path);
    const paths = yield* PathLookup;
    const findmnt = yield* paths.which("findmnt");
    const exec = yield* ProcessExec;
    let fstype = "";
    let target = "";
    if (findmnt) {
      const ft = yield* exec
        .runCaptured({
          command: findmnt,
          args: ["-n", "-o", "FSTYPE", "-T", probe],
          timeoutMs: 3_000,
          maxOutputBytes: 4_096,
        })
        .pipe(Effect.either);
      if (ft._tag === "Right") {
        fstype = captureText(ft.right).trim().split("\n")[0] ?? "";
      }
      const tg = yield* exec
        .runCaptured({
          command: findmnt,
          args: ["-n", "-o", "TARGET", "-T", probe],
          timeoutMs: 3_000,
          maxOutputBytes: 4_096,
        })
        .pipe(Effect.either);
      if (tg._tag === "Right") {
        target = captureText(tg.right).trim().split("\n")[0] ?? "";
      }
    } else {
      const dfBin = yield* paths.which("df");
      if (dfBin) {
        const df = yield* exec
          .runCaptured({
            command: dfBin,
            args: ["-T", probe],
            timeoutMs: 3_000,
            maxOutputBytes: 8_192,
          })
          .pipe(Effect.either);
        if (df._tag === "Right") {
          const lines = captureText(df.right).trim().split("\n");
          const last = lines[lines.length - 1] ?? "";
          const parts = last.trim().split(/\s+/);
          if (parts.length >= 2) {
            fstype = parts[1] ?? "";
            target = parts[parts.length - 1] ?? "";
          }
        }
      }
    }
    return checkFsClassFromProbe(probe, fstype, target);
  });
}

export function checkProcVersion(): string | null {
  try {
    return readFileSync("/proc/version", "utf8");
  } catch {
    return null;
  }
}

export function resolveRealPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

export function checkSha256FileSync(path: string): string {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return "";
    const real = resolveRealPath(path);
    const buf = readFileSync(real);
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return "";
  }
}

/**
 * Locate common git skills root (shared worktree layout).
 */
export function resolveCommonSkillsRoot(
  repoRoot: string,
): Effect.Effect<string | null, never, ProcessExec | PathLookup> {
  return Effect.gen(function* () {
    const paths = yield* PathLookup;
    const git = yield* paths.which("git");
    if (!git) return null;
    const exec = yield* ProcessExec;
    const r = yield* exec
      .runCaptured({
        command: git,
        args: [
          "-C",
          repoRoot,
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ],
        timeoutMs: 5_000,
        maxOutputBytes: 8_192,
      })
      .pipe(Effect.either);
    if (r._tag === "Left") return null;
    const commonDir = captureText(r.right).trim().split("\n")[0] ?? "";
    if (!commonDir) return null;
    const skills = join(dirname(commonDir), "skills");
    if (existsSync(skills)) {
      try {
        return realpathSync(skills);
      } catch {
        return skills;
      }
    }
    return null;
  });
}

export function captureHostnameOs(): Effect.Effect<
  { host: string; os: string },
  never,
  ProcessExec | PathLookup
> {
  return Effect.gen(function* () {
    const paths = yield* PathLookup;
    const exec = yield* ProcessExec;
    let host = "unknown";
    let os: string = process.platform;
    const hn = yield* paths.which("hostname");
    if (hn) {
      const r = yield* exec
        .runCaptured({
          command: hn,
          args: [],
          timeoutMs: 2_000,
          maxOutputBytes: 1_024,
        })
        .pipe(Effect.either);
      if (r._tag === "Right") {
        const t = captureText(r.right).trim();
        if (t) host = t.split("\n")[0] ?? t;
      }
    }
    const uname = yield* paths.which("uname");
    if (uname) {
      const r = yield* exec
        .runCaptured({
          command: uname,
          args: ["-s"],
          timeoutMs: 2_000,
          maxOutputBytes: 1_024,
        })
        .pipe(Effect.either);
      if (r._tag === "Right") {
        const t = captureText(r.right).trim();
        if (t) os = t.split("\n")[0] ?? t;
      }
    } else if (process.platform === "win32") {
      os = "Windows_NT";
    }
    return { host, os };
  });
}
