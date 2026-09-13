import type { SourceSpan } from "./ast.js";
import type { JsonValue } from "./types.js";
export const PEL_DIAGNOSTIC_CODES = [
  "PEL_LEX",
  "PEL_PARSE",
  "PEL_UNBOUND_SYMBOL",
  "PEL_UNINITIALIZED_BINDING",
  "PEL_DUPLICATE_BINDING",
  "PEL_TYPE",
  "PEL_ARGUMENT_MODE",
  "PEL_ARGUMENT_NAME",
  "PEL_ARITY",
  "PEL_INDEX",
  "PEL_NUMERIC_DOMAIN",
  "PEL_CARET_SCOPE",
  "PEL_DEPENDENCY_CYCLE",
  "PEL_LIMIT",
  "PEL_HOST_RESULT",
  "PEL_HOST_FAILURE",
  "PEL_REGISTRY",
  "PEL_CONTINUATION_MISMATCH",
] as const;
export type PelDiagnosticCode = (typeof PEL_DIAGNOSTIC_CODES)[number];
export interface PelDiagnostic {
  readonly code: PelDiagnosticCode;
  readonly severity: "error";
  readonly span: SourceSpan;
  readonly relatedSpans: readonly SourceSpan[];
  readonly message: string;
  readonly expectedForms: readonly string[];
  readonly signature?: string;
  readonly help?: string;
  readonly bound?: string;
  readonly consumed?: number;
  readonly hostFailure?: {
    readonly code: string;
    readonly message: string;
    readonly cause?: JsonValue;
  };
}
export function diagnostic(
  code: PelDiagnosticCode,
  span: SourceSpan,
  message: string,
  extra: Partial<
    Omit<PelDiagnostic, "code" | "severity" | "span" | "message">
  > = {},
): PelDiagnostic {
  return {
    code,
    severity: "error",
    span,
    message,
    relatedSpans: [],
    expectedForms: [],
    ...extra,
  };
}
export function renderPelDiagnostic(
  source: Uint8Array,
  error: PelDiagnostic,
): string {
  const lines = new TextDecoder().decode(source).split(/\r\n|\r|\n/);
  const line = lines[error.span.line - 1] ?? "";
  const length =
    error.span.endLine === error.span.line
      ? error.span.endColumn - error.span.column
      : [...line].length - error.span.column + 2;
  return [
    `${error.code} at ${error.span.line}:${error.span.column}: ${error.message}`,
    `${error.span.line}: ${line}`,
    `${" ".repeat(String(error.span.line).length + 2 + Math.max(0, error.span.column - 1))}${"^".repeat(Math.max(1, length))}`,
    ...(error.expectedForms.length
      ? [`Expected: ${error.expectedForms.join(", ")}`]
      : []),
    ...(error.signature ? [`Signature: ${error.signature}`] : []),
    ...(error.help ? [error.help] : []),
  ].join("\n");
}
