/**
 * Exact UTC second-precision timestamps: YYYY-MM-DDTHH:mm:ssZ with a real
 * calendar instant. No fractional seconds and no numeric offsets.
 */

const UTC_SECOND =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

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

/** True when `s` is exact UTC second precision with a real calendar instant. */
export function isUtcSecondTimestamp(s: string): boolean {
  if (typeof s !== "string" || s.length === 0) return false;
  const m = UTC_SECOND.exec(s);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (month < 1 || month > 12) return false;
  const dim = daysInMonth(year, month);
  if (day < 1 || day > dim) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;

  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(utc)) return false;
  const check = new Date(utc);
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() + 1 === month &&
    check.getUTCDate() === day &&
    check.getUTCHours() === hour &&
    check.getUTCMinutes() === minute &&
    check.getUTCSeconds() === second
  );
}
