import { Effect } from "effect";
import {
  canonicalize,
  decodeUtf8Fatal,
  isCoreFailure,
  MAX_INPUT_BYTES,
  parseJsonRejectDuplicateKeys,
} from "@foreman/core";
import { admitCheck } from "./admit.js";
import { loadCommittedAuthority, mapAuthorityError } from "./authority.js";
import { relocateArtifact } from "./relocate.js";
import {
  Clock,
  GitIdentity,
  type MutationProbe,
} from "./services.js";
import {
  decodeAdmissionRequest,
  mapCoreFailure,
  type AdmissionRequest,
  type CheckResult,
  type DenialReason,
  type RelocateResult,
} from "./schema.js";

export type CliIo = {
  readonly writeStdout: (line: string) => void;
  readonly writeStderr: (line: string) => void;
};

function emitLine(io: CliIo, value: unknown): void {
  io.writeStdout(canonicalize(value) + "\n");
}

function failedResult(reason: DenialReason): CheckResult {
  return { schemaVersion: 1, _tag: "Failed", reason };
}

function parseArgv(argv: readonly string[]):
  | {
      command: "check" | "relocate-artifact";
      repoRoot: string;
    }
  | { error: true } {
  let args = [...argv];
  if (
    args.length > 0 &&
    (args[0]!.endsWith("node") || args[0]!.includes("node.exe"))
  ) {
    args = args.slice(1);
  }
  if (
    args.length > 0 &&
    (args[0]!.endsWith(".js") ||
      args[0]!.endsWith(".ts") ||
      args[0]!.includes("destruction-guard"))
  ) {
    args = args.slice(1);
  }

  if (args.length === 0) return { error: true };
  const command = args[0];
  if (command !== "check" && command !== "relocate-artifact") {
    return { error: true };
  }

  let repoRoot: string | null = null;
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i]!;
    // Reject legacy --register: caller cannot select authority path
    if (a === "--register") {
      return { error: true };
    }
    if (a === "--repo-root") {
      const v = args[i + 1];
      if (!v || v.startsWith("--")) return { error: true };
      repoRoot = v;
      i += 1;
    } else {
      return { error: true };
    }
  }

  if (!repoRoot) return { error: true };

  return {
    command,
    repoRoot,
  };
}

function parseStdinRequest(
  stdinBytes: Uint8Array,
): AdmissionRequest | { fail: DenialReason } {
  if (stdinBytes.byteLength > MAX_INPUT_BYTES) {
    return { fail: "oversize_input" };
  }
  const text = decodeUtf8Fatal(stdinBytes);
  if (isCoreFailure(text)) {
    return { fail: mapCoreFailure(text) };
  }
  const parsed = parseJsonRejectDuplicateKeys(text);
  if (isCoreFailure(parsed)) {
    return { fail: mapCoreFailure(parsed) };
  }
  const req = decodeAdmissionRequest(parsed);
  if (isCoreFailure(req)) {
    return { fail: mapCoreFailure(req) };
  }
  return req;
}

export function runCli(
  argv: readonly string[],
  stdinBytes: Uint8Array,
  io: CliIo,
): Effect.Effect<number, never, GitIdentity | Clock | MutationProbe> {
  return Effect.gen(function* () {
    const parsed = parseArgv(argv);
    if ("error" in parsed) {
      emitLine(io, failedResult("schema_mismatch"));
      return 64;
    }

    const reqOrFail = parseStdinRequest(stdinBytes);
    if ("fail" in reqOrFail) {
      emitLine(io, failedResult(reqOrFail.fail));
      return 1;
    }
    const request = reqOrFail;

    const clock = yield* Clock;

    if (parsed.command === "check") {
      const authE = yield* Effect.either(
        loadCommittedAuthority(parsed.repoRoot),
      );
      if (authE._tag === "Left") {
        emitLine(io, failedResult(mapAuthorityError(authE.left)));
        return 1;
      }
      const auth = authE.right;
      const nowMs = yield* clock.nowMs();
      const result: CheckResult = admitCheck(
        auth.register,
        auth.registerSha256,
        request,
        nowMs,
        auth.snapshot,
      );
      emitLine(io, result);
      return result._tag === "Authorized" ? 0 : 1;
    }

    const result: RelocateResult = yield* relocateArtifact({
      repoRoot: parsed.repoRoot,
      request,
    });
    emitLine(io, result);
    return result._tag === "Completed" ? 0 : 1;
  });
}
