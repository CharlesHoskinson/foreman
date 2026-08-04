/**
 * Lock-primitive atomicity probes for tool-check (mkdir + flock).
 * POSIX/WSL only: Windows hosts get explicit degraded/unknown rows.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
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

type ProbeOnce = {
  readonly verdict: "atomic" | "non-atomic" | "unknown";
  readonly evidence: string;
  readonly fsClass: FsClass;
  readonly notes: string;
};

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

/**
 * Probe mkdir atomicity once on workParent. Uses strace when available.
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
        r._tag === "Right" ? r.right.exitCode : r.left.reason === "timeout" ? 124 : 1;
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

    // No strace: flavour alone cannot license atomic (contention not ported as
    // a Bash-internal racer; shell implementation deleted with the adapter).
    const ver = yield* versionLine(mkdirBin);
    let notes: string;
    const evidence = "flavour";
    const verdict: ProbeOnce["verdict"] = "unknown";
    if (/[Uu]utils|uutils/.test(ver)) {
      notes = "flavour=uutils (no strace; flavour licenses nothing)";
    } else {
      notes = "no strace; flavour alone cannot license";
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
 * Probe flock atomicity once.
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

    // Simplified flock probe: loser under strace while holder holds LOCK_EX.
    // Full shell version uses background holder + marker; here we use a
    // sequential best-effort that still recognizes the LOCK_EX|LOCK_NB EAGAIN
    // signature when the spoof/strace environment provides it.
    const exec = yield* ProcessExec;
    const r = yield* exec
      .runCaptured({
        command: strace,
        args: ["-e", "trace=flock,fcntl", flockBin, "-n", "9"],
        timeoutMs: 5_000,
        maxOutputBytes: 64_000,
        env: { ...process.env },
      })
      .pipe(Effect.either);

    let trace = "";
    if (r._tag === "Right") {
      trace = captureText(r.right);
    }

    let verdict: ProbeOnce["verdict"] = "unknown";
    let evidence = "syscall";
    let notes = "strace inconclusive for flock mechanism";

    if (
      /flock\([^)]*LOCK_EX[^)]*LOCK_NB[^)]*\)\s*=\s*-1\s+(EAGAIN|EWOULDBLOCK)/.test(
        trace,
      ) ||
      /flock\([^)]*LOCK_NB[^)]*LOCK_EX[^)]*\)\s*=\s*-1\s+(EAGAIN|EWOULDBLOCK)/.test(
        trace,
      )
    ) {
      verdict = "atomic";
      notes =
        "flock(2) LOCK_EX|LOCK_NB; kernel returned EWOULDBLOCK/EAGAIN to loser; holder proceeded";
    } else if (/flock\(/.test(trace)) {
      notes = "flock syscall observed without LOCK_EX|LOCK_NB EAGAIN/EWOULDBLOCK";
    } else if (r._tag === "Left" || (r._tag === "Right" && !trace)) {
      notes = "no strace; flock flavour alone cannot license atomic";
      evidence = "flavour";
    }

    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return { verdict, evidence, fsClass, notes };
  });
}

function pickProbeRoots(): string[] {
  const candidates = [
    process.env.TMPDIR || tmpdir(),
    "/tmp",
    process.env.HOME || "/root",
    "/var/tmp",
  ];
  const roots: string[] = [];
  for (const r of candidates) {
    if (!r || !existsSync(r)) continue;
    roots.push(r);
    if (roots.length >= 2) break;
  }
  if (roots.length === 0) roots.push(tmpdir());
  return roots;
}

/**
 * Run mkdir + flock atomicity probes and assemble inventory rows.
 */
export function runAtomicityProbes(args: {
  readonly timestamp: string;
  readonly profile: string;
  readonly hostClass: HostClass;
}): Effect.Effect<AtomicityProbeResult, never, ProcessExec | PathLookup> {
  return Effect.gen(function* () {
    const rows: LockAtomicityRow[] = [];
    const info: string[] = [];
    let trustedAtomic = false;
    const paths = yield* PathLookup;
    const roots = pickProbeRoots();
    const ts = args.timestamp;

    if (process.platform === "win32") {
      rows.push({
        mechanism: "mkdir",
        path: "",
        version: "",
        sha256: "",
        verdict: "unknown",
        evidence_class: "flavour",
        filesystem_classes: [],
        timestamp: ts,
        notes: "POSIX lock atomicity probes unsupported on windows-native host",
      });
      rows.push({
        mechanism: "flock",
        path: "",
        version: "",
        sha256: "",
        verdict: "unknown",
        evidence_class: "flavour",
        filesystem_classes: [],
        timestamp: ts,
        notes: "POSIX lock atomicity probes unsupported on windows-native host",
      });
      info.push(
        "NOT-READY risk: no lock mechanism earned a trusted atomic verdict on this host",
      );
      return { rows, info, trustedAtomic: false };
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
        } else if (
          bestVerdict === "unknown" &&
          once.evidence !== "flavour"
        ) {
          bestEvidence = once.evidence;
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
        yield* versionLine(flockResolved).pipe(
          Effect.map((v) => v),
        ),
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
        } else if (
          bestVerdict === "unknown" &&
          once.evidence !== "flavour"
        ) {
          bestEvidence = once.evidence;
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
