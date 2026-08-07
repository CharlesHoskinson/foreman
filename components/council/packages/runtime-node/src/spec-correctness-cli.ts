#!/usr/bin/env node
import { stringifyCanonicalJson } from "@council/application";
import { decodeStrictSync } from "@council/schema";
import {
  decodeSpecCorrectnessCliRequestV1,
  SpecCorrectnessAdmissionResultV1,
  type SpecCorrectnessAdmissionResultV1 as SpecCorrectnessAdmissionResult,
  type SpecCorrectnessCliRequestV1,
} from "@council/schema/spec-correctness-admission";
import { executeSpecCorrectnessRequest } from "./spec-correctness-program.js";

export const MAX_STDIN_BYTES = 1_048_576;
export const MAX_STDOUT_BYTES = 1_048_576;
export const MAX_STDERR_BYTES = 4_096;

export type SpecCorrectnessCliIo = {
  readonly stdin: AsyncIterable<Uint8Array>;
  readonly writeStdout: (bytes: Uint8Array) => Promise<void>;
  readonly writeStderr: (bytes: Uint8Array) => Promise<void>;
  readonly execute: (
    request: SpecCorrectnessCliRequestV1,
  ) => Promise<SpecCorrectnessAdmissionResult>;
};

const writeStreamBytes = (
  stream: NodeJS.WriteStream,
  bytes: Uint8Array,
): Promise<void> =>
  new Promise((resolve, reject) => {
    stream.write(bytes, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const nodeIo: SpecCorrectnessCliIo = {
  stdin: process.stdin,
  writeStdout: (bytes) => writeStreamBytes(process.stdout, bytes),
  writeStderr: (bytes) => writeStreamBytes(process.stderr, bytes),
  execute: executeSpecCorrectnessRequest,
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const USAGE_LINE = "usage: council-spec-correctness < request.json\n";

/**
 * Static rejected result for invalid CLI input or stdout overflow. Contains no
 * paths, secrets, or raw provider text. Canonical encoding is far below
 * MAX_STDOUT_BYTES.
 */
const STATIC_PARSE_FAILURE: SpecCorrectnessAdmissionResult = decodeStrictSync(
  SpecCorrectnessAdmissionResultV1,
  {
    schemaVersion: 1,
    _tag: "Rejected",
    failure: {
      stage: "parse",
      reason: "spec-correctness CLI input or result failed strict decoding",
      retry: "changed_preflight",
    },
    evaluation: null,
    quorumEligible: false,
    candidateDisposition: "changes_requested",
  },
);

const STATIC_STDOUT_OVERFLOW_FAILURE: SpecCorrectnessAdmissionResult =
  decodeStrictSync(SpecCorrectnessAdmissionResultV1, {
    schemaVersion: 1,
    _tag: "Rejected",
    failure: {
      stage: "parse",
      reason: "spec-correctness CLI stdout result exceeds the closed bound",
      retry: "changed_preflight",
    },
    evaluation: null,
    quorumEligible: false,
    candidateDisposition: "changes_requested",
  });

/**
 * Encode text as UTF-8 and cap the result at maxBytes. When truncating, back up
 * over continuation bytes so the write ends on a character boundary.
 */
const encodeUtf8Bounded = (text: string, maxBytes: number): Uint8Array => {
  const encoded = textEncoder.encode(text);
  if (encoded.byteLength <= maxBytes) {
    return encoded;
  }
  let end = maxBytes;
  while (end > 0) {
    const byte = encoded[end];
    if (byte === undefined || (byte & 0xc0) !== 0x80) {
      break;
    }
    end -= 1;
  }
  return encoded.subarray(0, end);
};

const writeStderrBounded = async (
  io: SpecCorrectnessCliIo,
  message: string,
): Promise<void> => {
  await io.writeStderr(encodeUtf8Bounded(message, MAX_STDERR_BYTES));
};

const encodeResultLine = (result: SpecCorrectnessAdmissionResult): Uint8Array =>
  textEncoder.encode(`${stringifyCanonicalJson(result)}\n`);

const writeResultLine = async (
  io: SpecCorrectnessCliIo,
  result: SpecCorrectnessAdmissionResult,
): Promise<number> => {
  const bytes = encodeResultLine(result);
  if (bytes.byteLength > MAX_STDOUT_BYTES) {
    // Valid result too large: emit static secret-safe Rejected JSON instead.
    const fallback = encodeResultLine(STATIC_STDOUT_OVERFLOW_FAILURE);
    if (fallback.byteLength > MAX_STDOUT_BYTES) {
      // Defensive: static fallback must always fit; never write oversized body.
      await writeStderrBounded(io, "stdout result exceeds closed bound\n");
      return 1;
    }
    await io.writeStdout(fallback);
    return 1;
  }
  await io.writeStdout(bytes);
  return result._tag === "CompletedApproved" ? 0 : 1;
};

const writeStaticParseFailure = async (
  io: SpecCorrectnessCliIo,
): Promise<number> => writeResultLine(io, STATIC_PARSE_FAILURE);

/**
 * Read stdin until EOF or until cumulative bytes exceed MAX_STDIN_BYTES.
 * On overflow, stop iteration immediately and return null (no decode path).
 */
const readStdinBounded = async (
  stdin: AsyncIterable<Uint8Array>,
): Promise<Uint8Array | null> => {
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stdin) {
    total += chunk.byteLength;
    if (total > MAX_STDIN_BYTES) {
      return null;
    }
    parts.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
};

export const runSpecCorrectnessCli = async (
  args: readonly string[],
  io: SpecCorrectnessCliIo,
): Promise<number> => {
  if (args.length > 0) {
    await writeStderrBounded(io, USAGE_LINE);
    return 64;
  }

  const stdinBytes = await readStdinBounded(io.stdin);
  if (stdinBytes === null) {
    return writeStaticParseFailure(io);
  }

  let request: SpecCorrectnessCliRequestV1;
  try {
    const text = textDecoder.decode(stdinBytes);
    const parsed: unknown = JSON.parse(text);
    request = decodeSpecCorrectnessCliRequestV1(parsed);
  } catch {
    return writeStaticParseFailure(io);
  }

  let result: SpecCorrectnessAdmissionResult;
  try {
    const raw = await io.execute(request);
    result = decodeStrictSync(SpecCorrectnessAdmissionResultV1, raw);
  } catch {
    return writeStaticParseFailure(io);
  }

  return writeResultLine(io, result);
};

if (import.meta.main) {
  void runSpecCorrectnessCli(process.argv.slice(2), nodeIo).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = 1;
    },
  );
}
