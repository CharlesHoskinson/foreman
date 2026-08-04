import { readSync } from "node:fs";
import {
  malformedUtf8,
  oversizeInput,
  type CoreFailure,
} from "./failures.js";
import { MAX_INPUT_BYTES } from "./utf8.js";

/**
 * Read at most maxBytes+1 from a file descriptor without allocating unbounded
 * input. Rejects when more than maxBytes are available.
 */
export function readFdBounded(
  fd: number,
  maxBytes: number = MAX_INPUT_BYTES,
): Uint8Array | CoreFailure {
  if (maxBytes < 0 || !Number.isInteger(maxBytes)) {
    return oversizeInput(MAX_INPUT_BYTES);
  }
  const cap = maxBytes + 1;
  const buf = Buffer.allocUnsafe(cap);
  let offset = 0;
  while (offset < cap) {
    let n: number;
    try {
      n = readSync(fd, buf, offset, cap - offset, null);
    } catch {
      return malformedUtf8();
    }
    if (n === 0) break;
    offset += n;
  }
  if (offset > maxBytes) {
    return oversizeInput(maxBytes);
  }
  return new Uint8Array(buf.buffer, buf.byteOffset, offset);
}

/**
 * Bound a buffer already in memory: reject if longer than maxBytes.
 */
export function boundBytes(
  data: Uint8Array,
  maxBytes: number = MAX_INPUT_BYTES,
): Uint8Array | CoreFailure {
  if (data.byteLength > maxBytes) {
    return oversizeInput(maxBytes);
  }
  return data;
}
