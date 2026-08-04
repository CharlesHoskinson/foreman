/**
 * Strict RFC 3339 date-time validation with real calendar components.
 * Fractional seconds are exact at JavaScript millisecond precision (1–3
 * digits). Longer fractions are rejected (no silent round/truncate).
 */

const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  switch (m) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(y) ? 29 : 28;
    default:
      return 0;
  }
}

/**
 * Parse fractional second digits to whole milliseconds.
 * Accepts 1–3 digits only (pad right with zeros). Rejects longer fractions.
 */
function fracToMs(frac: string | undefined): number | null {
  if (frac === undefined) return 0;
  if (frac.length === 0 || frac.length > 3) return null;
  if (!/^\d+$/.test(frac)) return null;
  // Pad to 3 digits: .1 → 100, .12 → 120, .999 → 999
  const padded = (frac + "000").slice(0, 3);
  return Number(padded);
}

/**
 * Returns epoch milliseconds if `s` is a strict valid RFC 3339 instant;
 * otherwise null.
 */
export function parseRfc3339Ms(s: string): number | null {
  if (typeof s !== "string" || s.length === 0) return null;
  const m = RFC3339.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const fracMs = fracToMs(m[7]);
  if (fracMs === null) return null;
  const offset = m[8]!;

  if (month < 1 || month > 12) return null;
  const dim = daysInMonth(year, month);
  if (day < 1 || day > dim) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  let offsetMin = 0;
  if (offset !== "Z") {
    const sign = offset[0] === "-" ? -1 : 1;
    const oh = Number(offset.slice(1, 3));
    const om = Number(offset.slice(4, 6));
    if (oh > 23 || om > 59) return null;
    offsetMin = sign * (oh * 60 + om);
  }

  // Whole-second UTC epoch from wall components in the stated offset zone.
  const utcWhole =
    Date.UTC(year, month - 1, day, hour, minute, second) -
    offsetMin * 60_000;
  if (!Number.isFinite(utcWhole)) return null;

  // Reject Date-style overflow on the wall components
  const check = new Date(utcWhole + offsetMin * 60_000);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return null;
  }

  return utcWhole + fracMs;
}

export function isRfc3339Instant(s: string): boolean {
  return parseRfc3339Ms(s) !== null;
}

export type ChronologyResult =
  | "ok"
  | "invalid"
  | "expired"
  | "not_yet"
  | "reversed"
  | "recorded_after_approval";

/**
 * Full authorization chronology:
 * recordedAt <= approvedAt <= now < expiresAt
 * and approvedAt < expiresAt.
 */
export function approvalChronologyValid(
  recordedAt: string,
  approvedAt: string,
  expiresAt: string,
  nowMs: number,
): ChronologyResult {
  const r = parseRfc3339Ms(recordedAt);
  const a = parseRfc3339Ms(approvedAt);
  const e = parseRfc3339Ms(expiresAt);
  if (r === null || a === null || e === null) return "invalid";
  if (!(a < e)) return "reversed";
  if (!(r <= a)) return "recorded_after_approval";
  if (!(a <= nowMs)) return "not_yet";
  if (!(nowMs < e)) return "expired";
  return "ok";
}

/** @deprecated use approvalChronologyValid; kept for call sites that only have approval bounds */
export function approvalIntervalValid(
  approvedAt: string,
  expiresAt: string,
  nowMs: number,
): "ok" | "invalid" | "expired" | "not_yet" | "reversed" {
  // Use approvedAt as recordedAt floor for legacy callers
  const c = approvalChronologyValid(approvedAt, approvedAt, expiresAt, nowMs);
  if (c === "recorded_after_approval") return "invalid";
  return c;
}
