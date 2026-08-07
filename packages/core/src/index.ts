export type { CoreFailure } from "./failures.js";
export {
  CORE_FAILURE_BRAND,
  isCoreFailure,
  malformedUtf8,
  oversizeInput,
  nonCanonicalJson,
  duplicateJsonKey,
  invalidJson,
  unknownField,
  schemaMismatch,
} from "./failures.js";
export { decodeUtf8Fatal, MAX_INPUT_BYTES } from "./utf8.js";
export { sha256Hex } from "./sha256.js";
export {
  parseJsonRejectDuplicateKeys,
  canonicalize,
  isCanonicalJsonText,
} from "./canonical-json.js";
export {
  expectObject,
  expectString,
  expectNumber,
  expectArray,
  rejectUnknownKeys,
  expectExactLiteral,
  isSha256Hex,
  isCommitSha40,
} from "./decode.js";
export { readFdBounded, boundBytes } from "./bounded-read.js";
