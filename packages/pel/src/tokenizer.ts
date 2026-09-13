import type { SourceSpan } from "./ast.js";
import { diagnostic } from "./diagnostics.js";
import type { PelDiagnostic } from "./diagnostics.js";
import type { PelProfileV1 } from "./profile.js";
import { PEL_PROFILE } from "./profile.js";
import type { Result } from "./types.js";
export interface PelToken {
  readonly kind:
    | "number"
    | "string"
    | "boolean"
    | "nil"
    | "key"
    | "symbol"
    | "caret"
    | "open-call"
    | "close-call"
    | "open-list"
    | "close-list"
    | "quote"
    | "pipe";
  readonly span: SourceSpan;
  readonly value?: string | number | boolean;
}
interface Point {
  byte: number;
  line: number;
  column: number;
}
export interface PelTokenization {
  readonly tokens: readonly PelToken[];
  readonly end: SourceSpan;
}
const pointSpan = (a: Point, b: Point): SourceSpan => ({
  start: a.byte,
  end: b.byte,
  line: a.line,
  column: a.column,
  endLine: b.line,
  endColumn: b.column,
});
const keyChar = (c: string) => /^[A-Za-z0-9_\-+*/\\?!<>=.]$/.test(c);
const boundary = (c: string) => /\s/u.test(c) || "()[]'\";^|>▷".includes(c);
export function tokenizePel(
  source: Uint8Array,
  profile: PelProfileV1 = PEL_PROFILE,
): Result<PelTokenization, readonly PelDiagnostic[]> {
  let point: Point = { byte: 0, line: 1, column: 1 };
  const origin = pointSpan(point, point);
  for (const [name, value] of Object.entries(profile.limits))
    if (!Number.isSafeInteger(value) || value < 0)
      return {
        ok: false,
        error: [
          diagnostic(
            "PEL_LIMIT",
            origin,
            "Limits must be finite nonnegative safe integers",
            { bound: name, consumed: value },
          ),
        ],
      };
  if (source.byteLength > profile.limits.maxSourceBytes)
    return {
      ok: false,
      error: [
        diagnostic(
          "PEL_LIMIT",
          { ...origin, end: source.byteLength },
          "Source byte limit exceeded",
          { bound: "maxSourceBytes", consumed: source.byteLength },
        ),
      ],
    };
  const chars: string[] = [];
  const points: Point[] = [];
  let previousCR = false;
  for (let offset = 0; offset < source.length; ) {
    const lead = source[offset]!;
    let width =
      lead < 0x80
        ? 1
        : lead >= 0xc2 && lead <= 0xdf
          ? 2
          : lead >= 0xe0 && lead <= 0xef
            ? 3
            : lead >= 0xf0 && lead <= 0xf4
              ? 4
              : 0;
    let scalar = width === 1 ? lead : lead & (0x7f >> width);
    for (let n = 1; n < width; n++) {
      const b = source[offset + n];
      if (b === undefined || b < 0x80 || b > 0xbf) {
        width = 0;
        break;
      }
      scalar = (scalar << 6) | (b & 0x3f);
    }
    if (
      width === 0 ||
      (width === 2 && scalar < 0x80) ||
      (width === 3 && scalar < 0x800) ||
      (width === 4 && scalar < 0x10000) ||
      scalar > 0x10ffff ||
      (scalar >= 0xd800 && scalar <= 0xdfff)
    )
      return {
        ok: false,
        error: [
          diagnostic(
            "PEL_LEX",
            {
              ...pointSpan(point, point),
              end: offset + 1,
              endColumn: point.column + 1,
            },
            "Invalid UTF-8 scalar",
          ),
        ],
      };
    const char = String.fromCodePoint(scalar);
    points.push(point);
    chars.push(char);
    offset += width;
    point = {
      byte: offset,
      line:
        point.line + (char === "\r" || (char === "\n" && !previousCR) ? 1 : 0),
      column: char === "\r" || char === "\n" ? 1 : point.column + 1,
    };
    previousCR = char === "\r";
  }
  points.push(point);
  let i = 0;
  const tokens: PelToken[] = [];
  const span = (a: number, b: number) => pointSpan(points[a]!, points[b]!);
  const fail = (
    start: number,
    message: string,
    help?: string,
  ): Result<PelTokenization, readonly PelDiagnostic[]> => ({
    ok: false,
    error: [
      diagnostic(
        "PEL_LEX",
        span(start, Math.max(start + 1, i)),
        message,
        help ? { help } : {},
      ),
    ],
  });
  while (i < chars.length) {
    const c = chars[i]!;
    if (/\s/u.test(c)) {
      i++;
      continue;
    }
    if (c === ";") {
      while (i < chars.length && chars[i] !== "\r" && chars[i] !== "\n") i++;
      continue;
    }
    const start = i;
    let token: PelToken;
    const punctuation: Record<string, PelToken["kind"]> = {
      "(": "open-call",
      ")": "close-call",
      "[": "open-list",
      "]": "close-list",
      "'": "quote",
      "^": "caret",
    };
    if (punctuation[c]) {
      i++;
      token = { kind: punctuation[c]!, span: span(start, i) };
    } else if (c === "|" && chars[i + 1] === ">") {
      i += 2;
      token = { kind: "pipe", span: span(start, i) };
    } else if (c === "|" || c === ">" || c === "▷") {
      i++;
      return fail(
        start,
        "Invalid pipe or symbol character",
        c === "▷" ? "Use |> for a pipe" : undefined,
      );
    } else if (c === '"') {
      i++;
      let value = "";
      let closed = false;
      while (i < chars.length) {
        const ch = chars[i++]!;
        if (ch === '"') {
          closed = true;
          break;
        }
        if (ch !== "\\") {
          value += ch;
          continue;
        }
        const escape = chars[i++];
        if (escape === undefined) {
          i = chars.length;
          return fail(start, "Unterminated string escape");
        }
        const simple: Record<string, string> = {
          n: "\n",
          r: "\r",
          t: "\t",
          b: "\b",
          f: "\f",
          v: "\v",
          "0": "\0",
          "\\": "\\",
          '"': '"',
        };
        if (Object.hasOwn(simple, escape)) {
          value += simple[escape];
          continue;
        }
        const count =
          escape === "x" ? 2 : escape === "u" ? 4 : escape === "U" ? 8 : 0;
        if (!count) return fail(start, "Unknown string escape");
        const hex = chars.slice(i, i + count).join("");
        if (hex.length !== count || !/^[0-9a-fA-F]+$/.test(hex))
          return fail(start, "Malformed scalar escape");
        i += count;
        const scalar = Number.parseInt(hex, 16);
        if (scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff))
          return fail(start, "Escape is not a Unicode scalar");
        value += String.fromCodePoint(scalar);
      }
      if (!closed) return fail(start, "Unterminated string");
      token = { kind: "string", value, span: span(start, i) };
    } else if (c === ":") {
      i++;
      while (i < chars.length && keyChar(chars[i]!)) i++;
      if (i === start + 1)
        return fail(start, "A keyword requires KEY characters");
      token = {
        kind: "key",
        value: chars.slice(start + 1, i).join(""),
        span: span(start, i),
      };
    } else {
      while (i < chars.length && !boundary(chars[i]!)) i++;
      const text = chars.slice(start, i).join("");
      if (text.startsWith("#")) {
        if (text !== "#t" && text !== "#f" && text !== "#nil")
          return fail(start, "Unknown hash constant");
        token =
          text === "#nil"
            ? { kind: "nil", span: span(start, i) }
            : { kind: "boolean", value: text === "#t", span: span(start, i) };
      } else if (/^-?[0-9]/.test(text)) {
        if (!/^-?[0-9]+(?:\.[0-9]+)?$/.test(text))
          return fail(start, "Malformed numeric literal");
        const [whole, fraction = ""] = text.replace(/^-/u, "").split(".");
        const digits = whole!.replace(/^0+/u, "") || "0";
        const maximum = String(Number.MAX_SAFE_INTEGER);
        if (
          digits.length > maximum.length ||
          (digits.length === maximum.length &&
            (digits > maximum ||
              (digits === maximum && /[1-9]/u.test(fraction))))
        )
          return fail(start, "Numeric literal is outside the safe range");
        const value = Number(text);
        token = {
          kind: "number",
          value: Object.is(value, -0) ? 0 : value,
          span: span(start, i),
        };
      } else token = { kind: "symbol", value: text, span: span(start, i) };
    }
    if (tokens.length >= profile.limits.maxTokens)
      return {
        ok: false,
        error: [
          diagnostic("PEL_LIMIT", token.span, "Token limit exceeded", {
            bound: "maxTokens",
            consumed: tokens.length + 1,
          }),
        ],
      };
    tokens.push(token);
  }
  return { ok: true, value: { tokens, end: span(i, i) } };
}
