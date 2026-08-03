/**
 * Bounded secret-safe redaction helpers for diagnostic surfaces.
 * Compilation itself never logs credentials; these helpers exist for spool
 * and operator-facing text in later packages.
 */

const privateKeyLabel = "[A-Z ]*" + "PRIVATE KEY";

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  new RegExp(
    `-----BEGIN ${privateKeyLabel}-----[\\s\\S]*?-----END ${privateKeyLabel}-----`,
    "g",
  ),
];

export const redactSecrets = (text: string): string => {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
};

export const truncateForDiagnostic = (
  text: string,
  maxChars: number,
): string => {
  if (maxChars < 1) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
};
