/**
 * Embedded capability table for the compiled vendor-preflight runtime.
 *
 * At build time, scripts/build-runtime.ts injects the canonical capability
 * JSON and its SHA-256 digest via esbuild `define` symbols:
 *   __FOREMAN_VENDOR_CAPS_JSON__
 *   __FOREMAN_VENDOR_CAPS_DIGEST__
 *
 * When those symbols are empty (source/test runs), loaders may call
 * `loadCapabilityTableFromTomlText` with the authored TOML instead.
 */

import {
  decodeVendorCapabilityTableV1,
  parseVendorCapabilitiesFromToml,
  type VendorCapabilityTableV1,
} from "./vendor-preflight-manifest.js";
import {
  isVendorPreflightContractFailure,
} from "./vendor-preflight-contract.js";

declare const __FOREMAN_VENDOR_CAPS_JSON__: string | undefined;
declare const __FOREMAN_VENDOR_CAPS_DIGEST__: string | undefined;

function readDefine(name: "json" | "digest"): string {
  try {
    if (name === "json") {
      return typeof __FOREMAN_VENDOR_CAPS_JSON__ === "string"
        ? __FOREMAN_VENDOR_CAPS_JSON__
        : "";
    }
    return typeof __FOREMAN_VENDOR_CAPS_DIGEST__ === "string"
      ? __FOREMAN_VENDOR_CAPS_DIGEST__
      : "";
  } catch {
    return "";
  }
}

/**
 * Return the capability table embedded in the bundle, or null when running
 * from source without injection.
 */
export function tryGetEmbeddedCapabilityTable(): VendorCapabilityTableV1 | null {
  const raw = readDefine("json");
  if (raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const table = decodeVendorCapabilityTableV1(parsed);
  if (isVendorPreflightContractFailure(table)) return null;
  return table;
}

export function getEmbeddedCapabilityDigest(): string | null {
  const d = readDefine("digest");
  return d.length > 0 ? d : null;
}

export function loadCapabilityTableFromTomlText(
  text: string,
): VendorCapabilityTableV1 {
  const table = parseVendorCapabilitiesFromToml(text);
  if (isVendorPreflightContractFailure(table)) {
    throw new Error(
      `vendor capability table invalid: ${table.reason}`,
    );
  }
  return table;
}
