/**
 * Lock-primitive atomicity probes for tool-check (mkdir + flock).
 * POSIX/WSL only: Windows hosts get explicit degraded/unknown rows.
 *
 * Evidence classes: syscall | pinned-mechanism | contention | flavour
 *   syscall, pinned-mechanism → may license atomic | non-atomic
 *   contention → non-atomic only
 *   flavour → nothing on its own
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import {
  PathLookup,
  ProcessExec,
  type CapturedProcessResult,
} from "./queue-services.js";
import {
  resolveFsClass,
  resolveRealPath,
  sha256FileSync,
  type FsClass,
  type HostClass,
} from "./tool-check-platform.js";
import type { LockAtomicityRow } from "./tool-check-report.js";

function captureText(r: CapturedProcessResult): string {
  return `${r.stdout}${r.stderr}`.replace(/\r/g, "");
}

export type AtomicityProbeResult = {
  readonly rows: readonly LockAtomicityRow[];
  readonly info: readonly string[];
  readonly trustedAtomic: boolean;
};

export type ProbeOnce = {
  readonly verdict: "atomic" | "non-atomic" | "unknown";
  readonly evidence: string;
  readonly fsClass: FsClass;
  readonly notes: string;
};

export type PinnedRegisterEntry = {
  readonly mechanism: string;
  readonly sha256: string;
  readonly host_class: string;
  readonly trace_artifact: string;
  readonly probe_target: string;
  readonly filesystem_classes: readonly string[];
  readonly verdict: "atomic" | "non-atomic";
  readonly date?: string;
  readonly notes?: string;
};

export type PinnedLookupHit = {
  readonly verdict: "atomic" | "non-atomic";
  readonly filesystem_classes: readonly string[];
  readonly evidence_class: "pinned-mechanism";
};

const PINNED_ALLOWED_KEYS = new Set([
  "mechanism",
  "sha256",
  "host_class",
  "trace_artifact",
  "probe_target",
  "probe_path",
  "filesystem_classes",
  "verdict",
  "date",
  "notes",
]);

function firstLine(s: string): string {
  return s.replace(/\r/g, "").split("\n")[0]?.trim() ?? "";
}

function versionLine(
  bin: string,
): Effect.Effect<string, never, ProcessExec> {
  return Effect.gen(function* () {
    const exec = yield* ProcessExec;
    const r = yield* exec
      .runCaptured({
        command: bin,
        args: ["--version"],
        timeoutMs: 5_000,
        maxOutputBytes: 8_192,
      })
      .pipe(Effect.either);
    if (r._tag === "Left") return "";
    return firstLine(captureText(r.right));
  });
}

function stripTomlComment(line: string): string | null {
  let inStr = false;
  let out = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"' && line[i - 1] !== "\\") inStr = !inStr;
    if (!inStr && ch === "#") break;
    out += ch;
  }
  const t = out.trim();
  return t.length === 0 ? null : t;
}

function parseTomlString(raw: string): string | null {
  if (!(raw.startsWith('"') && raw.endsWith('"'))) return null;
  const inner = raw.slice(1, -1);
  let s = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === "\\") {
      const n = inner[i + 1];
      if (n === undefined) return null;
      if (n === "n") {
        s += "\n";
        i++;
        continue;
      }
      if (n === "t") {
        s += "\t";
        i++;
        continue;
      }
      if (n === "\\" || n === '"') {
        s += n;
        i++;
        continue;
      }
      return null;
    }
    s += ch;
  }
  return s;
}

function parseTomlStringArray(raw: string): string[] | null {
  const t = raw.trim();
  if (!(t.startsWith("[") && t.endsWith("]"))) return null;
  const body = t.slice(1, -1).trim();
  if (body.length === 0) return [];
  const items: string[] = [];
  let i = 0;
  const skipWs = () => {
    while (i < body.length && /\s/.test(body[i]!)) i++;
  };
  skipWs();
  while (i < body.length) {
    if (body[i] !== '"') return null;
    let end = i + 1;
    let s = "";
    while (end < body.length) {
      if (body[end] === "\\" && end + 1 < body.length) {
        s += body[end + 1];
        end += 2;
        continue;
      }
      if (body[end] === '"') break;
      s += body[end];
      end++;
    }
    if (body[end] !== '"') return null;
    items.push(s);
    i = end + 1;
    skipWs();
    if (i >= body.length) break;
    if (body[i] !== ",") return null;
    i++;
    skipWs();
  }
  return items;
}

/**
 * Parse only `[[lock_atomicity.pinned]]` tables. Malformed or unknown-field
 * tables are dropped (never invent a pin).
 */
export function parsePinnedRegisterToml(text: string): PinnedRegisterEntry[] {
  if (typeof text !== "string" || text.includes("\0")) return [];
  const lines = text.split(/\r?\n/);
  const tables: Record<string, string | string[]>[] = [];
  let current: Record<string, string | string[]> | null = null;
  let inPinned = false;

  const flush = () => {
    if (current !== null) tables.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    const line = stripTomlComment(rawLine);
    if (line === null) continue;
    if (line.startsWith("[")) {
      if (line === "[[lock_atomicity.pinned]]") {
        flush();
        current = {};
        inPinned = true;
        continue;
      }
      flush();
      inPinned = false;
      continue;
    }
    if (!inPinned || current === null) continue;
    const eq = line.indexOf("=");
    if (eq < 0) {
      current = null;
      inPinned = false;
      continue;
    }
    const key = line.slice(0, eq).trim();
    const valRaw = line.slice(eq + 1).trim();
    if (!PINNED_ALLOWED_KEYS.has(key) || key in current) {
      current = null;
      inPinned = false;
      continue;
    }
    if (key === "filesystem_classes") {
      const arr = parseTomlStringArray(valRaw);
      if (arr === null) {
        current = null;
        inPinned = false;
        continue;
      }
      current[key] = arr;
    } else {
      const s = parseTomlString(valRaw);
      if (s === null) {
        current = null;
        inPinned = false;
        continue;
      }
      current[key] = s;
    }
  }
  flush();

  const out: PinnedRegisterEntry[] = [];
  for (const t of tables) {
    const mechanism = t["mechanism"];
    const sha256 = t["sha256"];
    const host_class = t["host_class"];
    const trace_artifact = t["trace_artifact"];
    const verdictRaw = t["verdict"];
    if (
      typeof mechanism !== "string" ||
      typeof sha256 !== "string" ||
      typeof host_class !== "string" ||
      typeof trace_artifact !== "string" ||
      typeof verdictRaw !== "string"
    ) {
      continue;
    }
    if (verdictRaw !== "atomic" && verdictRaw !== "non-atomic") continue;
    if (mechanism !== "mkdir" && mechanism !== "flock") continue;
    if (!host_class.trim() || !sha256.trim() || !trace_artifact.trim()) continue;

    let probe_target = "";
    if (typeof t["probe_target"] === "string") {
      probe_target = t["probe_target"];
    } else if (typeof t["probe_path"] === "string") {
      probe_target = t["probe_path"];
    }
    if (mechanism === "mkdir" && !probe_target.trim()) continue;

    // filesystem_classes is required evidence. Never invent a default (e.g.
    // ["local"]) for omitted, empty, or filtered-empty lists — incomplete pins
    // must not promote to pinned-mechanism authority.
    if (!Array.isArray(t["filesystem_classes"])) continue;
    const filesystem_classes = t["filesystem_classes"].filter(
      (c): c is string => typeof c === "string" && c.length > 0,
    );
    if (filesystem_classes.length === 0) continue;
    const allowedFs = new Set(["local", "mnt-drvfs", "network", "fuse"]);
    if (filesystem_classes.some((c) => !allowedFs.has(c))) continue;

    out.push({
      mechanism,
      sha256,
      host_class: host_class.trim(),
      trace_artifact: trace_artifact.trim(),
      probe_target: probe_target.trim(),
      filesystem_classes,
      verdict: verdictRaw,
      ...(typeof t["date"] === "string" ? { date: t["date"] } : {}),
      ...(typeof t["notes"] === "string" ? { notes: t["notes"] } : {}),
    });
  }
  return out;
}

export function validatePinnedTraceContent(args: {
  readonly mechanism: string;
  readonly probeTarget: string;
  readonly content: string;
}): boolean {
  const { mechanism, probeTarget, content } = args;
  if (!content) return false;
  if (mechanism === "mkdir") {
    if (!probeTarget) return false;
    const frag = probeTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re1 = new RegExp(
      `mkdir(at)?\\([^\\n]*${frag}[^\\n]*\\)\\s*=\\s*-1\\s+EEXIST`,
    );
    const re2 = new RegExp(
      `mkdir(at)?\\([^\\n]*${frag}[^\\n]*\\).*(EEXIST|ERROR_ALREADY_EXISTS)`,
    );
    return re1.test(content) || re2.test(content);
  }
  if (mechanism === "flock") {
    const loser =
      /flock\([^)]*LOCK_EX[^)]*LOCK_NB[^)]*\)\s*=\s*-1\s+(EAGAIN|EWOULDBLOCK)/.test(
        content,
      ) ||
      /flock\([^)]*LOCK_NB[^)]*LOCK_EX[^)]*\)\s*=\s*-1\s+(EAGAIN|EWOULDBLOCK)/.test(
        content,
      );
    const holder =
      /flock\([^)]*LOCK_EX[^)]*\)\s*=\s*0/.test(content) ||
      content.includes("holder_acquired=1") ||
      content.includes("HOLDER_PROCEEDED");
    return loser && holder;
  }
  return false;
}

function pathIsInsideRoot(candidate: string, root: string): boolean {
  try {
    const realCand = realpathSync(candidate);
    const realRoot = realpathSync(root);
    if (realCand === realRoot) return true;
    const rel = relative(realRoot, realCand);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  } catch {
    return false;
  }
}

function resolveTracePath(
  artifact: string,
  repoRoot: string,
): string | null {
  const candidates = isAbsolute(artifact)
    ? [artifact]
    : [join(repoRoot, artifact), artifact];
  for (const c of candidates) {
    try {
      if (!existsSync(c)) continue;
      const st = lstatSync(c);
      if (st.isSymbolicLink()) return null;
      if (!st.isFile() || st.size === 0) continue;
      if (!pathIsInsideRoot(c, repoRoot)) return null;
      return c;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Closed pinned-evidence lookup. Never invents a pin. Rejects malformed
 * fields, wrong host/digest, absent/empty/out-of-root/symlink traces, invalid
 * verdict/classes, mkdir without probe_target, and traces that do not prove
 * the mechanism predicate.
 */
export function lookupPinnedVerdict(args: {
  readonly mechanism: "mkdir" | "flock" | string;
  readonly sha256: string;
  readonly hostClass: HostClass | string;
  readonly repoRoot: string;
  readonly manifestPath?: string;
}): PinnedLookupHit | null {
  const sha = args.sha256.trim();
  if (!sha) return null;
  const manifest =
    args.manifestPath ??
    join(args.repoRoot, "env", "reference-manifest.toml");
  let text: string;
  try {
    if (!existsSync(manifest)) return null;
    const st = lstatSync(manifest);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    text = readFileSync(manifest, "utf8");
  } catch {
    return null;
  }
  const entries = parsePinnedRegisterToml(text);
  for (const entry of entries) {
    if (entry.mechanism !== args.mechanism) continue;
    if (entry.sha256.toLowerCase() !== sha.toLowerCase()) continue;
    if (!entry.host_class || entry.host_class !== args.hostClass) return null;
    const tracePath = resolveTracePath(entry.trace_artifact, args.repoRoot);
    if (!tracePath) return null;
    let content: string;
    try {
      content = readFileSync(tracePath, "utf8");
    } catch {
      return null;
    }
    if (
      !validatePinnedTraceContent({
        mechanism: entry.mechanism,
        probeTarget: entry.probe_target,
        content,
      })
    ) {
      return null;
    }
    return {
      verdict: entry.verdict,
      filesystem_classes: entry.filesystem_classes,
      evidence_class: "pinned-mechanism",
    };
  }
  return null;
}

/** Count mutual-exclusion violations in an ENTER/EXIT contention sample. */
export function countMkdirContentionViolations(traceText: string): number {
  let depth = 0;
  let violations = 0;
  for (const line of traceText.split(/\r?\n/)) {
    const t = line.trim();
    if (t === "ENTER") {
      depth += 1;
      if (depth > 1) violations += 1;
    } else if (t === "EXIT") {
      depth -= 1;
    }
  }
  return violations;
}

function sleepMsAsync(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

/**
 * Bounded wait for a child exit event (or already-exited). Does not block the
 * event loop, so exit notifications are observed promptly.
 */
function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onExit);
      resolve();
    };
    const onExit = (): void => {
      finish();
    };
    const timer = setTimeout(finish, Math.max(0, timeoutMs));
    child.once("exit", onExit);
    child.once("error", onExit);
    // Re-check after attaching listeners (race with concurrent exit).
    if (child.exitCode !== null || child.signalCode !== null) {
      finish();
    }
  });
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  pollMs = 20,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleepMsAsync(Math.min(pollMs, remaining));
  }
  return predicate();
}

async function reapChild(
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  await waitForChildExit(child, timeoutMs);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    await waitForChildExit(child, 500);
  }
}

/**
 * Eight-racer mkdir contention sample. Observed overlap → non-atomic/contention;
 * clean sample → unknown/contention (never licenses atomic).
 *
 * Parent waits are asynchronous so child exit events are observed promptly.
 * Child-side short sleeps remain in the racer scripts only.
 */
export async function runMkdirContentionSample(
  mkdirBin: string,
  workParent: string,
): Promise<{ violations: number; notes: string }> {
  let base: string;
  try {
    base = mkdtempSync(join(workParent, "fm-mkdir-ct."));
  } catch {
    base = mkdtempSync(join(tmpdir(), "fm-mkdir-ct."));
  }
  const lock = join(base, "lock");
  const trace = join(base, "t");
  writeFileSync(trace, "");
  const children: ChildProcess[] = [];
  try {
    for (let i = 0; i < 8; i++) {
      // Child racer: brief setTimeout-style sleep via Atomics is local to the
      // child process and does not block the parent event loop.
      const code = `
const {spawnSync}=require("node:child_process");
const {appendFileSync,rmdirSync}=require("node:fs");
const mkdirBin=${JSON.stringify(mkdirBin)};
const lock=${JSON.stringify(lock)};
const trace=${JSON.stringify(trace)};
let tries=0;
while(true){
  const r=spawnSync(mkdirBin,["--",lock],{stdio:"ignore"});
  if(r.status===0)break;
  tries++;
  if(tries>200)process.exit(1);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
}
appendFileSync(trace,"ENTER\\n");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
appendFileSync(trace,"EXIT\\n");
try{rmdirSync(lock);}catch{}
`;
      children.push(
        spawn(process.execPath, ["-e", code], {
          stdio: "ignore",
          detached: false,
        }),
      );
    }
    const overallMs = 15_000;
    const started = Date.now();
    await Promise.all(
      children.map(async (c) => {
        const remaining = Math.max(0, overallMs - (Date.now() - started));
        await waitForChildExit(c, remaining);
        if (c.exitCode === null && c.signalCode === null) {
          await reapChild(c, 1_000);
        }
      }),
    );
    const text = readFileSync(trace, "utf8");
    const violations = countMkdirContentionViolations(text);
    if (violations > 0) {
      return {
        violations,
        notes: `contention observed ${violations} mutual-exclusion violations (8 racers)`,
      };
    }
    return {
      violations: 0,
      notes:
        "clean 8-racer sample; contention cannot license atomic (still unknown)",
    };
  } finally {
    await Promise.all(children.map((c) => reapChild(c, 500)));
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function resolveMountTarget(
  path: string,
): Effect.Effect<string, never, ProcessExec | PathLookup> {
  return Effect.gen(function* () {
    if (process.platform === "win32") return path;
    const paths = yield* PathLookup;
    const findmnt = yield* paths.which("findmnt");
    const exec = yield* ProcessExec;
    if (findmnt) {
      const r = yield* exec
        .runCaptured({
          command: findmnt,
          args: ["-n", "-o", "TARGET", "-T", path],
          timeoutMs: 3_000,
          maxOutputBytes: 4_096,
        })
        .pipe(Effect.either);
      if (r._tag === "Right") {
        const t = captureText(r.right).trim().split("\n")[0] ?? "";
        if (t) return t;
      }
    }
    return path;
  });
}

function isExistingWritableDir(path: string): boolean {
  if (!path) return false;
  try {
    if (!existsSync(path)) return false;
    accessSync(path, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Select probe roots by distinct (filesystem class, mount target) keys.
 * Falls back to a bounded portable default (os.tmpdir()) when no writable
 * candidate exists. Never returns a nonexistent path: an invalid explicit
 * fallback may be replaced by tmpdir() when that is writable, otherwise the
 * result is empty.
 */
export function pickProbeRoots(args?: {
  readonly candidates?: readonly string[];
  readonly fallback?: string;
}): Effect.Effect<string[], never, ProcessExec | PathLookup> {
  return Effect.gen(function* () {
    const portableDefault = tmpdir();
    const candidates =
      args?.candidates ??
      [
        process.env.TMPDIR ||
          process.env.TEMP ||
          process.env.TMP ||
          portableDefault,
        portableDefault,
        process.env.HOME || process.env.USERPROFILE || "",
        // POSIX-only extras; skipped automatically when absent (Windows).
        "/tmp",
        "/var/tmp",
      ];
    const fallback = args?.fallback ?? portableDefault;
    const roots: string[] = [];
    const seenKeys = new Set<string>();

    for (const r of candidates) {
      if (!r) continue;
      if (!isExistingWritableDir(r)) continue;
      const fsClass = yield* resolveFsClass(r);
      const mount = yield* resolveMountTarget(r);
      const key = `${fsClass}\0${mount}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      roots.push(r);
    }
    if (roots.length === 0) {
      if (isExistingWritableDir(fallback)) {
        roots.push(fallback);
      } else if (
        fallback !== portableDefault &&
        isExistingWritableDir(portableDefault)
      ) {
        roots.push(portableDefault);
      }
      // else: empty — never invent a ghost probe root
    }
    return roots;
  });
}

/**
 * Probe mkdir atomicity once on workParent. Uses strace when available;
 * otherwise runs an eight-racer contention sample.
 */
export function probeMkdirOnce(
  mkdirBin: string,
  workParent: string,
): Effect.Effect<ProbeOnce, never, ProcessExec | PathLookup> {
  return Effect.gen(function* () {
    const fsClass = yield* resolveFsClass(workParent);
    if (process.platform === "win32") {
      return {
        verdict: "unknown" as const,
        evidence: "flavour",
        fsClass,
        notes: "POSIX strace mkdir probe unsupported on windows-native host",
      };
    }

    let work: string;
    try {
      work = mkdtempSync(join(workParent, "fm-mkdir-probe."));
    } catch {
      try {
        work = mkdtempSync(join(tmpdir(), "fm-mkdir-probe."));
      } catch {
        return {
          verdict: "unknown" as const,
          evidence: "flavour",
          fsClass,
          notes: "could not create probe workdir",
        };
      }
    }
    const lock = join(work, "x");
    try {
      mkdirSync(lock);
    } catch {
      /* may already exist */
    }

    const paths = yield* PathLookup;
    const strace = yield* paths.which("strace");
    const exec = yield* ProcessExec;

    if (strace) {
      const traceFile = join(work, "strace.trace");
      const r = yield* exec
        .runCaptured({
          command: strace,
          args: [
            "-f",
            "-e",
            "trace=mkdir,mkdirat,statx,stat,newfstatat",
            "-o",
            traceFile,
            mkdirBin,
            "--",
            lock,
          ],
          timeoutMs: 15_000,
          maxOutputBytes: 256_000,
        })
        .pipe(Effect.either);

      const traceRc =
        r._tag === "Right"
          ? r.right.exitCode
          : r.left.reason === "timeout"
            ? 124
            : 1;
      let trace = "";
      let hasTrace = false;
      try {
        if (existsSync(traceFile)) {
          const st = readFileSync(traceFile);
          hasTrace = st.byteLength > 0;
          trace = st.toString("utf8");
        }
      } catch {
        hasTrace = false;
      }

      let verdict: ProbeOnce["verdict"] = "unknown";
      let evidence = "syscall";
      let notes = "";

      if (!hasTrace) {
        verdict = "unknown";
        evidence = "syscall";
        notes = `tracer did not run (strace exit=${traceRc}; no trace output)`;
      } else if (
        /mkdir(at)?\([^)]*\/x[^)]*\)\s*=\s*-1\s+EEXIST/.test(trace)
      ) {
        verdict = "atomic";
        evidence = "syscall";
        notes = "mkdir(2) on probe target; kernel returned EEXIST";
      } else if (
        /statx\(/.test(trace) &&
        !/mkdir(at)?\([^)]*\/x[^)]*\)\s*=\s*-1\s+EEXIST/.test(trace)
      ) {
        if (!/mkdir(at)?\([^)]*\/x/.test(trace)) {
          verdict = "non-atomic";
          evidence = "syscall";
          notes = "userspace statx check; no mkdir(2) EEXIST (TOCTOU)";
        } else {
          verdict = "unknown";
          evidence = "syscall";
          notes =
            "mkdir syscall observed without clear EEXIST signature on target";
        }
      } else {
        verdict = "unknown";
        evidence = "syscall";
        notes = "strace inconclusive for mkdir mechanism";
      }

      try {
        rmSync(work, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      return { verdict, evidence, fsClass, notes };
    }

    // No strace: flavour alone cannot license; run eight-racer contention.
    const ver = yield* versionLine(mkdirBin);
    let flavourNote: string;
    if (/[Uu]utils|uutils/.test(ver)) {
      flavourNote = "flavour=uutils (no strace; flavour licenses nothing)";
    } else {
      flavourNote = "no strace; flavour alone cannot license";
    }
    void flavourNote;

    const sample = yield* Effect.promise(() =>
      runMkdirContentionSample(mkdirBin, workParent),
    );
    const verdict: ProbeOnce["verdict"] =
      sample.violations > 0 ? "non-atomic" : "unknown";
    const evidence = "contention";
    const notes = sample.notes;

    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }

    return { verdict, evidence, fsClass, notes };
  });
}

/**
 * Probe flock atomicity: holder acquires LOCK_EX, then loser under strace must
 * observe LOCK_EX|LOCK_NB returning EAGAIN/EWOULDBLOCK. Holder acquisition is
 * independently observed via marker before the loser is licensed.
 */
export function probeFlockOnce(
  flockBin: string,
  workParent: string,
): Effect.Effect<ProbeOnce, never, ProcessExec | PathLookup> {
  return Effect.gen(function* () {
    const fsClass = yield* resolveFsClass(workParent);
    if (process.platform === "win32") {
      return {
        verdict: "unknown" as const,
        evidence: "flavour",
        fsClass,
        notes: "POSIX flock probe unsupported on windows-native host",
      };
    }
    const paths = yield* PathLookup;
    const isExe = yield* paths.isExecutable(flockBin);
    if (!isExe) {
      return {
        verdict: "unknown" as const,
        evidence: "flavour",
        fsClass,
        notes: "flock binary missing",
      };
    }

    let work: string;
    try {
      work = mkdtempSync(join(workParent, "fm-flock-probe."));
    } catch {
      work = mkdtempSync(join(tmpdir(), "fm-flock-probe."));
    }
    const lockf = join(work, "lockfile");
    const marker = join(work, "holder_ready");
    writeFileSync(lockf, "");

    const strace = yield* paths.which("strace");
    if (!strace) {
      try {
        rmSync(work, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      return {
        verdict: "unknown" as const,
        evidence: "flavour",
        fsClass,
        notes: "no strace; flock flavour alone cannot license atomic",
      };
    }

    // Holder: flock -n lockfile <cmd> acquires exclusive lock then runs cmd.
    // Marker is written only after acquisition (cmd runs under the held lock).
    // Child-side hold sleep is local to the holder process only.
    const holderCode = `
const {writeFileSync}=require("node:fs");
writeFileSync(${JSON.stringify(marker)}, "holder_acquired=1\\n");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2000);
`;
    const holder = spawn(
      flockBin,
      ["-n", lockf, process.execPath, "-e", holderCode],
      { stdio: "ignore" },
    );

    // Wait for holder acquisition marker (bounded ~2.5s), non-blocking parent.
    const markerReady = yield* Effect.promise(() =>
      waitUntil(() => existsSync(marker), 2_500, 20),
    );

    let verdict: ProbeOnce["verdict"] = "unknown";
    let evidence = "syscall";
    let notes = "strace inconclusive for flock mechanism";
    const exec = yield* ProcessExec;

    if (!markerReady) {
      yield* Effect.promise(() => reapChild(holder, 2_000));
      verdict = "unknown";
      evidence = "syscall";
      notes = "holder did not proceed; cannot license flock atomicity";
    } else {
      // Loser under strace while holder still holds the lock.
      const r = yield* exec
        .runCaptured({
          command: strace,
          args: [
            "-e",
            "trace=flock,fcntl",
            flockBin,
            "-n",
            lockf,
            process.execPath,
            "-e",
            "process.exit(0)",
          ],
          timeoutMs: 5_000,
          maxOutputBytes: 64_000,
        })
        .pipe(Effect.either);

      yield* Effect.promise(() => reapChild(holder, 3_000));

      let trace = "";
      if (r._tag === "Right") {
        trace = captureText(r.right);
      }

      // Independent holder observation required before loser licenses atomic.
      let holderObserved = false;
      try {
        holderObserved = readFileSync(marker, "utf8").includes(
          "holder_acquired=1",
        );
      } catch {
        holderObserved = false;
      }

      if (
        holderObserved &&
        (/flock\([^)]*LOCK_EX[^)]*LOCK_NB[^)]*\)\s*=\s*-1\s+(EAGAIN|EWOULDBLOCK)/.test(
          trace,
        ) ||
          /flock\([^)]*LOCK_NB[^)]*LOCK_EX[^)]*\)\s*=\s*-1\s+(EAGAIN|EWOULDBLOCK)/.test(
            trace,
          ))
      ) {
        verdict = "atomic";
        notes =
          "flock(2) LOCK_EX|LOCK_NB; kernel returned EWOULDBLOCK/EAGAIN to loser; holder proceeded";
      } else if (/flock\(/.test(trace)) {
        notes =
          "flock syscall observed without LOCK_EX|LOCK_NB EAGAIN/EWOULDBLOCK";
      } else if (r._tag === "Left" || (r._tag === "Right" && !trace)) {
        notes = "strace inconclusive for flock mechanism";
      }
    }

    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return { verdict, evidence, fsClass, notes };
  });
}

/**
 * Run mkdir + flock atomicity probes and assemble inventory rows.
 */
export function runAtomicityProbes(args: {
  readonly timestamp: string;
  readonly profile: string;
  readonly hostClass: HostClass;
  readonly repoRoot: string;
  readonly processEnv?: NodeJS.ProcessEnv;
}): Effect.Effect<AtomicityProbeResult, never, ProcessExec | PathLookup> {
  return Effect.gen(function* () {
    const rows: LockAtomicityRow[] = [];
    const info: string[] = [];
    let trustedAtomic = false;
    const paths = yield* PathLookup;
    const roots = yield* pickProbeRoots();
    const ts = args.timestamp;
    const env = args.processEnv ?? process.env;
    const manifestOverride = env.FOREMAN_LOCK_MANIFEST;

    if (process.platform === "win32") {
      // Still consult pin register for mkdir on Windows/Git-Bash style hosts.
      const mkdirResolved =
        (yield* paths.which("mkdir.exe")) ?? (yield* paths.which("mkdir"));
      if (mkdirResolved) {
        const mkdirBin = resolveRealPath(mkdirResolved);
        const ver = yield* versionLine(mkdirResolved);
        const sha = sha256FileSync(mkdirBin);
        let verdict: ProbeOnce["verdict"] = "unknown";
        let evidence = "flavour";
        let fsClasses: string[] = ["local"];
        let notes =
          "Windows/Git-Bash host: no syscall tracer in TS path; flavour alone licenses nothing; use pinned-mechanism register for mkdir trust";
        const pin = lookupPinnedVerdict({
          mechanism: "mkdir",
          sha256: sha,
          hostClass: args.hostClass,
          repoRoot: args.repoRoot,
          ...(typeof manifestOverride === "string" &&
          manifestOverride.length > 0
            ? { manifestPath: manifestOverride }
            : {}),
        });
        if (pin) {
          verdict = pin.verdict;
          evidence = pin.evidence_class;
          fsClasses = [...pin.filesystem_classes];
          notes =
            "pinned-mechanism from register (host_class match + validated trace); fallback reachable";
          if (verdict === "atomic") trustedAtomic = true;
        }
        rows.push({
          mechanism: "mkdir",
          path: mkdirBin,
          version: ver,
          sha256: sha,
          verdict,
          evidence_class: evidence,
          filesystem_classes: fsClasses,
          timestamp: ts,
          notes,
        });
      } else {
        rows.push({
          mechanism: "mkdir",
          path: "",
          version: "",
          sha256: "",
          verdict: "unknown",
          evidence_class: "flavour",
          filesystem_classes: [],
          timestamp: ts,
          notes: "mkdir not found on Windows PATH",
        });
      }
      rows.push({
        mechanism: "flock",
        path: "",
        version: "",
        sha256: "",
        verdict: "unknown",
        evidence_class: "flavour",
        filesystem_classes: [],
        timestamp: ts,
        notes:
          "flock not on Windows PATH (expected for Git-Bash; mkdir fallback uses pinned-mechanism)",
      });
      if (!trustedAtomic) {
        info.push(
          "NOT-READY risk: no lock mechanism earned a trusted atomic verdict on this host",
        );
      }
      return { rows, info, trustedAtomic };
    }

    // --- mkdir ---
    const mkdirResolved = yield* paths.which("mkdir");
    if (mkdirResolved) {
      const mkdirBin = resolveRealPath(mkdirResolved);
      const ver = yield* versionLine(mkdirResolved);
      const sha = sha256FileSync(mkdirBin);
      const classVerdict = new Map<string, string>();
      const notesAcc: string[] = [];
      let bestVerdict: ProbeOnce["verdict"] = "unknown";
      let bestEvidence = "flavour";

      for (const r of roots) {
        const once = yield* probeMkdirOnce(mkdirResolved, r);
        classVerdict.set(once.fsClass, once.verdict);
        notesAcc.push(`${once.fsClass}:${once.notes}`);
        if (once.verdict === "non-atomic") {
          bestVerdict = "non-atomic";
          bestEvidence = once.evidence;
        } else if (once.verdict === "atomic" && bestVerdict !== "non-atomic") {
          bestVerdict = "atomic";
          bestEvidence = once.evidence;
        } else if (bestVerdict === "unknown" && once.evidence !== "flavour") {
          bestEvidence = once.evidence;
        }
      }

      if (bestVerdict !== "atomic" && bestVerdict !== "non-atomic") {
        const pin = lookupPinnedVerdict({
          mechanism: "mkdir",
          sha256: sha,
          hostClass: args.hostClass,
          repoRoot: args.repoRoot,
          ...(typeof manifestOverride === "string" &&
          manifestOverride.length > 0
            ? { manifestPath: manifestOverride }
            : {}),
        });
        if (pin) {
          bestVerdict = pin.verdict;
          bestEvidence = pin.evidence_class;
          for (const c of pin.filesystem_classes) {
            classVerdict.set(c, pin.verdict);
          }
          notesAcc.push(`pin:${pin.verdict}`);
        }
      }

      const fsCsv: string[] = [];
      for (const cl of ["local", "mnt-drvfs", "network", "fuse"] as const) {
        if (classVerdict.get(cl) === bestVerdict) fsCsv.push(cl);
      }
      rows.push({
        mechanism: "mkdir",
        path: mkdirBin,
        version: ver,
        sha256: sha,
        verdict: bestVerdict,
        evidence_class: bestEvidence,
        filesystem_classes: fsCsv,
        timestamp: ts,
        notes: notesAcc.join("; "),
      });
      if (
        bestVerdict === "atomic" &&
        (bestEvidence === "syscall" || bestEvidence === "pinned-mechanism")
      ) {
        trustedAtomic = true;
      }
      if (bestVerdict === "non-atomic") {
        info.push(`mkdir: non-atomic (${bestEvidence}) path=${mkdirBin}`);
      }
    }

    // --- flock ---
    const flockResolved = yield* paths.which("flock");
    if (flockResolved) {
      const flockBin = resolveRealPath(flockResolved);
      let ver = `flock ${firstLine(
        yield* versionLine(flockResolved).pipe(Effect.map((v) => v)),
      )}`;
      if (ver === "flock " || ver === "flock") {
        ver = `flock:${flockResolved}`;
      }
      const sha = sha256FileSync(flockBin);
      const classVerdict = new Map<string, string>();
      const notesAcc: string[] = [];
      let bestVerdict: ProbeOnce["verdict"] = "unknown";
      let bestEvidence = "flavour";

      for (const r of roots) {
        const once = yield* probeFlockOnce(flockResolved, r);
        classVerdict.set(once.fsClass, once.verdict);
        notesAcc.push(`${once.fsClass}:${once.notes}`);
        if (once.verdict === "non-atomic") {
          bestVerdict = "non-atomic";
          bestEvidence = once.evidence;
        } else if (once.verdict === "atomic" && bestVerdict !== "non-atomic") {
          bestVerdict = "atomic";
          bestEvidence = once.evidence;
        } else if (bestVerdict === "unknown" && once.evidence !== "flavour") {
          bestEvidence = once.evidence;
        }
      }

      if (bestVerdict !== "atomic" && bestVerdict !== "non-atomic") {
        const pin = lookupPinnedVerdict({
          mechanism: "flock",
          sha256: sha,
          hostClass: args.hostClass,
          repoRoot: args.repoRoot,
          ...(typeof manifestOverride === "string" &&
          manifestOverride.length > 0
            ? { manifestPath: manifestOverride }
            : {}),
        });
        if (pin) {
          bestVerdict = pin.verdict;
          bestEvidence = pin.evidence_class;
          for (const c of pin.filesystem_classes) {
            classVerdict.set(c, pin.verdict);
          }
          notesAcc.push(`pin:${pin.verdict}`);
        }
      }

      const fsCsv: string[] = [];
      for (const cl of ["local", "mnt-drvfs", "network", "fuse"] as const) {
        if (classVerdict.get(cl) === bestVerdict) fsCsv.push(cl);
      }
      rows.push({
        mechanism: "flock",
        path: flockBin,
        version: ver,
        sha256: sha,
        verdict: bestVerdict,
        evidence_class: bestEvidence,
        filesystem_classes: fsCsv,
        timestamp: ts,
        notes: notesAcc.join("; "),
      });
      if (
        bestVerdict === "atomic" &&
        (bestEvidence === "syscall" || bestEvidence === "pinned-mechanism")
      ) {
        trustedAtomic = true;
      }
    } else {
      rows.push({
        mechanism: "flock",
        path: "",
        version: "",
        sha256: "",
        verdict: "unknown",
        evidence_class: "flavour",
        filesystem_classes: [],
        timestamp: ts,
        notes: "flock not on PATH",
      });
    }

    let mkdirNonAtomic = false;
    let flockTrusted = false;
    for (const row of rows) {
      if (row.mechanism === "mkdir" && row.verdict === "non-atomic") {
        mkdirNonAtomic = true;
      }
      if (
        row.mechanism === "flock" &&
        row.verdict === "atomic" &&
        (row.evidence_class === "syscall" ||
          row.evidence_class === "pinned-mechanism")
      ) {
        flockTrusted = true;
      }
    }
    if (mkdirNonAtomic && flockTrusted) {
      info.push(
        "INFO: mkdir non-atomic but flock present and trusted for probed filesystem class(es) — durable locks use flock",
      );
    }
    if (!trustedAtomic) {
      info.push(
        "NOT-READY risk: no lock mechanism earned a trusted atomic verdict on this host",
      );
    }

    return { rows, info, trustedAtomic };
  });
}

// Silence unused imports used only on some platforms / dead paths.
void unlinkSync;
void rmdirSync;
void resolve;
void sep;
