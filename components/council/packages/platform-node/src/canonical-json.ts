/**
 * The application package owns closed-JSON capture and canonical encoding.
 * Platform adapters reuse that boundary and do not implement a second clone.
 */
export {
  canonicalJsonBytes,
  encodeUtf8,
  sortJsonKeys,
  stringifyCanonicalJson,
} from "@council/application";
