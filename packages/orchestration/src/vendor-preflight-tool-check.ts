/**
 * Pure projection from VendorPreflightRecordV1 to the tool-check row shape.
 * Sprint 3 R4B — Setup adapter. No process I/O.
 */

import type {
  VendorId,
  VendorPreflightRecordV1,
} from "./vendor-preflight-contract.js";

/** Closed tool-check status domain for vendor readiness rows. */
export const TOOL_CHECK_ROW_STATUSES = [
  "ok",
  "missing",
  "outdated",
  "not_authenticated",
  "degraded",
] as const;
export type ToolCheckRowStatus = (typeof TOOL_CHECK_ROW_STATUSES)[number];

/** Vendors accepted by the tool-check-row CLI adapter command. */
export const TOOL_CHECK_ROW_VENDORS = ["grok", "codex"] as const;
export type ToolCheckRowVendorId = (typeof TOOL_CHECK_ROW_VENDORS)[number];

/** UTF-8 byte bound for a single TSV detail field. */
export const MAX_TOOL_CHECK_DETAIL_BYTES = 512;

export type ToolCheckRowV1 = {
  readonly vendor: VendorId;
  readonly status: ToolCheckRowStatus;
  readonly detail: string;
};

/**
 * Replace tab/CR/LF, collapse whitespace, and truncate to the detail bound.
 * Result never contains tab, CR, or LF.
 */
export function sanitizeToolCheckDetail(raw: string): string {
  let s = raw.replace(/[\t\r\n]+/g, " ").replace(/ +/g, " ").trim();
  if (s.length === 0) {
    return "no detail";
  }
  if (Buffer.byteLength(s, "utf8") <= MAX_TOOL_CHECK_DETAIL_BYTES) {
    return s;
  }
  // Truncate on UTF-8 code unit boundaries.
  let end = s.length;
  while (end > 0 && Buffer.byteLength(s.slice(0, end), "utf8") > MAX_TOOL_CHECK_DETAIL_BYTES) {
    end -= 1;
  }
  // Leave room for ellipsis when possible.
  const ellipsis = "…";
  const ellipsisBytes = Buffer.byteLength(ellipsis, "utf8");
  while (
    end > 0 &&
    Buffer.byteLength(s.slice(0, end), "utf8") + ellipsisBytes >
      MAX_TOOL_CHECK_DETAIL_BYTES
  ) {
    end -= 1;
  }
  return (end > 0 ? s.slice(0, end) : "") + ellipsis;
}

function joinDetailParts(parts: readonly (string | null | undefined)[]): string {
  const cleaned: string[] = [];
  for (const p of parts) {
    if (p === null || p === undefined) continue;
    const t = p.trim();
    if (t.length === 0) continue;
    cleaned.push(t);
  }
  if (cleaned.length === 0) return "no detail";
  return cleaned.join(" — ");
}

/**
 * Map a vendor-preflight record to a tool-check row.
 *
 * Priority (first match wins):
 * 1. missing CLI → missing
 * 2. positive signed-out evidence → not_authenticated
 * 3. authentication unknown → degraded
 * 4. authenticated and below floor → outdated
 * 5. currency unknown → degraded
 * 6. fully ready → ok
 *
 * Only not_authenticated detail may contain a login instruction.
 * Unknown authentication uses diagnose remediation only.
 */
export function projectVendorPreflightToToolCheckRow(
  record: VendorPreflightRecordV1,
): ToolCheckRowV1 {
  const disc = record.facts.discoverable.value;
  const auth = record.facts.authenticated.value;
  const curr = record.facts.current.value;
  const rem = record.remediation;
  const ver = record.reportedVersion;

  let status: ToolCheckRowStatus;
  let detailRaw: string;

  if (disc === "missing") {
    status = "missing";
    detailRaw = joinDetailParts([
      rem.kind === "install" ? rem.instruction : null,
      record.facts.discoverable.reason,
    ]);
  } else if (auth === "not-authenticated") {
    status = "not_authenticated";
    // Only this status may carry the vendor login instruction.
    detailRaw = joinDetailParts([
      ver,
      rem.kind === "login" ? rem.instruction : record.facts.authenticated.reason,
    ]);
  } else if (auth === "unknown") {
    status = "degraded";
    // Diagnose only — never a login instruction.
    detailRaw = joinDetailParts([
      rem.kind === "diagnose" ? rem.instruction : null,
      record.facts.authenticated.reason,
    ]);
  } else if (auth === "authenticated" && curr === "outdated") {
    status = "outdated";
    detailRaw = joinDetailParts([
      ver,
      record.facts.current.reason,
      rem.kind === "update" ? rem.instruction : null,
    ]);
  } else if (curr === "unknown" || disc === "unknown") {
    status = "degraded";
    detailRaw = joinDetailParts([
      rem.kind === "diagnose" ? rem.instruction : null,
      curr === "unknown"
        ? record.facts.current.reason
        : record.facts.discoverable.reason,
    ]);
  } else {
    // Fully ready (discoverable + authenticated + current).
    status = "ok";
    detailRaw = joinDetailParts([ver, record.facts.current.reason]);
  }

  return {
    vendor: record.vendor,
    status,
    detail: sanitizeToolCheckDetail(detailRaw),
  };
}

/**
 * Format a row as exactly three tab-separated fields (no trailing LF).
 * Detail is re-sanitized so the line cannot embed field separators.
 */
export function formatToolCheckRowTsv(row: ToolCheckRowV1): string {
  const detail = sanitizeToolCheckDetail(row.detail);
  return `${row.vendor}\t${row.status}\t${detail}`;
}

export function isToolCheckRowVendorId(v: string): v is ToolCheckRowVendorId {
  return (TOOL_CHECK_ROW_VENDORS as readonly string[]).includes(v);
}
