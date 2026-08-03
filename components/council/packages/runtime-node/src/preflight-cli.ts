import {
  decodePreflightCliRequestV1,
  decodeStrictSync,
  PromptPreflightResultV1,
  type PreflightCliRequestV1,
  type PromptPreflightResultV1 as PromptPreflightResult,
} from "@council/schema";

export const MAX_STDIN_BYTES = 1_048_576;
export const MAX_STDERR_BYTES = 4_096;

export type PreflightCliIo = {
  readonly stdin: AsyncIterable<Uint8Array>;
  readonly writeStdout: (bytes: Uint8Array) => Promise<void>;
  readonly writeStderr: (bytes: Uint8Array) => Promise<void>;
  readonly execute: (
    request: PreflightCliRequestV1,
  ) => Promise<PromptPreflightResult>;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const USAGE_LINE = "usage: council-preflight < request.json\n";

const STATIC_PARSE_FAILURE: PromptPreflightResult = decodeStrictSync(
  PromptPreflightResultV1,
  {
    _tag: "failure",
    schemaVersion: 1,
    failure: {
      stage: "parse",
      reason: "preflight CLI input or result failed strict decoding",
      retry: "changed_preflight",
    },
    terminal: null,
  },
);

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
  io: PreflightCliIo,
  message: string,
): Promise<void> => {
  await io.writeStderr(encodeUtf8Bounded(message, MAX_STDERR_BYTES));
};

const writeResultLine = async (
  io: PreflightCliIo,
  result: PromptPreflightResult,
): Promise<number> => {
  await io.writeStdout(textEncoder.encode(`${JSON.stringify(result)}\n`));
  return result._tag === "ready" ? 0 : 1;
};

const writeStaticParseFailure = async (io: PreflightCliIo): Promise<number> =>
  writeResultLine(io, STATIC_PARSE_FAILURE);

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

export const runPreflightCli = async (
  args: readonly string[],
  io: PreflightCliIo,
): Promise<number> => {
  if (args.length > 0) {
    await writeStderrBounded(io, USAGE_LINE);
    return 64;
  }

  const stdinBytes = await readStdinBounded(io.stdin);
  if (stdinBytes === null) {
    return writeStaticParseFailure(io);
  }

  let request: PreflightCliRequestV1;
  try {
    const text = textDecoder.decode(stdinBytes);
    const parsed: unknown = JSON.parse(text);
    request = decodePreflightCliRequestV1(parsed);
  } catch {
    return writeStaticParseFailure(io);
  }

  let result: PromptPreflightResult;
  try {
    const raw = await io.execute(request);
    result = decodeStrictSync(PromptPreflightResultV1, raw);
  } catch {
    return writeStaticParseFailure(io);
  }

  return writeResultLine(io, result);
};
