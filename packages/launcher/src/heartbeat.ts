/**
 * Frozen heartbeat line schema and pure validation.
 * Field set is binding for T2 consumers.
 */

export const HEARTBEAT_KEYS = [
  "ts",
  "launcher_pid",
  "pid",
  "job_id",
  "alive",
  "stdout_bytes",
  "stderr_bytes",
  "elapsed_s",
] as const;

export type HeartbeatKey = (typeof HEARTBEAT_KEYS)[number];

export type HeartbeatLine = {
  readonly ts: string;
  readonly launcher_pid: number;
  readonly pid: number;
  readonly job_id: string;
  readonly alive: boolean;
  readonly stdout_bytes: number;
  readonly stderr_bytes: number;
  readonly elapsed_s: number;
};

export type HeartbeatValidation =
  | { readonly _tag: "Ok"; readonly line: HeartbeatLine }
  | { readonly _tag: "Invalid"; readonly reason: string };

export function formatHeartbeatLine(line: HeartbeatLine): string {
  // Key order matches frozen field set for stable single-line appends.
  const obj: Record<HeartbeatKey, string | number | boolean> = {
    ts: line.ts,
    launcher_pid: line.launcher_pid,
    pid: line.pid,
    job_id: line.job_id,
    alive: line.alive,
    stdout_bytes: line.stdout_bytes,
    stderr_bytes: line.stderr_bytes,
    elapsed_s: line.elapsed_s,
  };
  return JSON.stringify(obj) + "\n";
}

export function buildHeartbeatLine(input: {
  readonly nowMs: number;
  readonly startedAtMs: number;
  readonly launcherPid: number;
  readonly childPid: number;
  readonly jobId: string;
  readonly alive: boolean;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
}): HeartbeatLine {
  return {
    ts: new Date(input.nowMs).toISOString(),
    launcher_pid: input.launcherPid,
    pid: input.childPid,
    job_id: input.jobId,
    alive: input.alive,
    stdout_bytes: input.stdoutBytes,
    stderr_bytes: input.stderrBytes,
    elapsed_s: Number(((input.nowMs - input.startedAtMs) / 1000).toFixed(3)),
  };
}

export function validateHeartbeatLineText(text: string): HeartbeatValidation {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { _tag: "Invalid", reason: "empty" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { _tag: "Invalid", reason: "not_json" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { _tag: "Invalid", reason: "not_object" };
  }
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const expected = [...HEARTBEAT_KEYS].sort();
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    return { _tag: "Invalid", reason: "key_set" };
  }
  if (typeof obj["ts"] !== "string") {
    return { _tag: "Invalid", reason: "ts" };
  }
  if (typeof obj["launcher_pid"] !== "number" || !Number.isFinite(obj["launcher_pid"])) {
    return { _tag: "Invalid", reason: "launcher_pid" };
  }
  if (typeof obj["pid"] !== "number" || !Number.isFinite(obj["pid"])) {
    return { _tag: "Invalid", reason: "pid" };
  }
  if (typeof obj["job_id"] !== "string") {
    return { _tag: "Invalid", reason: "job_id" };
  }
  if (typeof obj["alive"] !== "boolean") {
    return { _tag: "Invalid", reason: "alive" };
  }
  if (typeof obj["stdout_bytes"] !== "number" || !Number.isFinite(obj["stdout_bytes"])) {
    return { _tag: "Invalid", reason: "stdout_bytes" };
  }
  if (typeof obj["stderr_bytes"] !== "number" || !Number.isFinite(obj["stderr_bytes"])) {
    return { _tag: "Invalid", reason: "stderr_bytes" };
  }
  if (typeof obj["elapsed_s"] !== "number" || !Number.isFinite(obj["elapsed_s"])) {
    return { _tag: "Invalid", reason: "elapsed_s" };
  }
  return {
    _tag: "Ok",
    line: {
      ts: obj["ts"],
      launcher_pid: obj["launcher_pid"],
      pid: obj["pid"],
      job_id: obj["job_id"],
      alive: obj["alive"],
      stdout_bytes: obj["stdout_bytes"],
      stderr_bytes: obj["stderr_bytes"],
      elapsed_s: obj["elapsed_s"],
    },
  };
}

/** First non-empty line must be a valid heartbeat (detach handoff). */
export function firstValidHeartbeatLine(
  content: string,
): HeartbeatValidation {
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    return validateHeartbeatLineText(line);
  }
  return { _tag: "Invalid", reason: "no_line" };
}

/** Detach handoff poll bound in milliseconds. */
export const DETACH_HANDOFF_BOUND_MS = 5000;
