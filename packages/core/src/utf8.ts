import {
  malformedUtf8,
  oversizeInput,
  type CoreFailure,
} from "./failures.js";

export const MAX_INPUT_BYTES = 1_048_576;

export function decodeUtf8Fatal(bytes: Uint8Array): string | CoreFailure {
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    return oversizeInput(MAX_INPUT_BYTES);
  }
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    return decoder.decode(bytes);
  } catch {
    return malformedUtf8();
  }
}
