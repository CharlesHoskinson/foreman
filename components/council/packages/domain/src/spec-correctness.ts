import type { Sha256Digest } from "@council/schema";
import { decodeStrictSync } from "@council/schema";
import type {
  InventedCompletionV1,
  SpecCorrectnessEvaluationResultV1,
  SpecCorrectnessFindingV1,
  SpecCorrectnessInvalidReasonV1,
  SpecCorrectnessItemResultV1,
  SpecCorrectnessMetricsV1,
  SpecCorrectnessProviderResponseV1,
} from "@council/schema/spec-correctness";
import {
  SpecCorrectnessProviderResponseV1 as ProviderResponseSchema,
  portableEncodeUtf8,
  portableSha256Hex,
} from "@council/schema/spec-correctness";
import MarkdownIt from "markdown-it";
import type { Token } from "markdown-it";

const BASELINE_ITEM_COUNT = 44;
const CR = 0x0d;
const LF = 0x0a;
const NUL = 0x00;

const ITEM_ID = /^(CW|RT)-\d{3}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

/**
 * Exact six-cell coverage-matrix header required before any baseline row is
 * recognized. Cell text is taken from markdown-it header inline tokens.
 */
const CANONICAL_HEADER_CELLS = [
  "ID",
  "Class",
  "Target sprint",
  "Mapped requirement or boundary",
  "Acceptance evidence",
  "Baseline status",
] as const;

/**
 * Pinned markdown-it instance. Linkification and typographic substitutions are
 * off; the parser is the Markdown authority, not rendered HTML. Any document
 * that yields an html_block token, or an html_inline child whose tag name is a
 * CommonMark block-level HTML tag, is rejected by the coverage parser (strict
 * artifact boundary — the tracked matrix has no raw HTML blocks or block-level
 * inline HTML tags). Ordinary non-block inline HTML such as span is allowed.
 */
const markdownIt = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
});

/**
 * Closed CommonMark block-level HTML tag set used by markdown-it 15 for type-6
 * html_block recognition (src/common/html_blocks). Compared case-insensitively
 * against html_inline open/close tag names so prefixed block tags that never
 * become top-level html_block still fail closed.
 */
const COMMONMARK_BLOCK_HTML_TAGS: ReadonlySet<string> = new Set([
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul",
]);

/**
 * Opening or closing tag name from an html_inline token content string.
 * Handles optional attributes after the name. Comments, CDATA, processing
 * instructions, and declarations do not match.
 */
const HTML_INLINE_TAG_NAME = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s/>]|$)/;

const isBlockLevelHtmlInlineContent = (content: string): boolean => {
  const match = HTML_INLINE_TAG_NAME.exec(content);
  if (match === null) {
    return false;
  }
  const tagName = match[1];
  if (tagName === undefined) {
    return false;
  }
  return COMMONMARK_BLOCK_HTML_TAGS.has(tagName.toLowerCase());
};

/**
 * True when the document is non-canonical due to raw HTML: any top-level
 * html_block, or any html_inline child whose tag name is a CommonMark
 * block-level HTML tag. Does not balance tags or inspect rendered HTML.
 */
const hasNonCanonicalHtmlTokens = (tokens: readonly Token[]): boolean => {
  for (const token of tokens) {
    if (token.type === "html_block") {
      return true;
    }
    if (token.type !== "inline") {
      continue;
    }
    const children = token.children;
    if (children === null) {
      continue;
    }
    for (const child of children) {
      if (
        child.type === "html_inline" &&
        isBlockLevelHtmlInlineContent(child.content)
      ) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Canonical baseline IDs from the accepted r5 OpenSpec: CW-001..CW-037 then
 * RT-001..RT-007. Generated algorithmically so source never holds a copied
 * 44-element literal. Order is UTF-8 byte order for these ASCII IDs.
 */
const buildCanonicalBaselineIds = (): readonly string[] => {
  const ids: string[] = [];
  for (let index = 1; index <= 37; index += 1) {
    ids.push(`CW-${String(index).padStart(3, "0")}`);
  }
  for (let index = 1; index <= 7; index += 1) {
    ids.push(`RT-${String(index).padStart(3, "0")}`);
  }
  return ids;
};

const CANONICAL_BASELINE_IDS = buildCanonicalBaselineIds();

export type SpecCorrectnessEvidenceArtifactV1 = {
  readonly alias: string;
  readonly sha256: Sha256Digest;
  readonly bytes: Uint8Array;
};

export type SpecCorrectnessEvaluatorPrimitivesV1 = {
  readonly sha256: (bytes: Uint8Array) => Sha256Digest;
  readonly decodeUtf8: (bytes: Uint8Array) => string | null;
};

/**
 * Evaluator input. Provider data is unknown and must be strictly decoded;
 * callers cannot bypass the schema boundary with a TypeScript assertion.
 */
export type EvaluateSpecCorrectnessV1Input = {
  readonly coverageMatrixBytes: Uint8Array;
  readonly response: unknown;
  readonly evidenceArtifacts: readonly SpecCorrectnessEvidenceArtifactV1[];
  readonly sha256: SpecCorrectnessEvaluatorPrimitivesV1["sha256"];
  readonly decodeUtf8: SpecCorrectnessEvaluatorPrimitivesV1["decodeUtf8"];
};

const invalid = (
  reason: SpecCorrectnessInvalidReasonV1,
): SpecCorrectnessEvaluationResultV1 => ({
  schemaVersion: 1,
  _tag: "Invalid",
  reason,
});

const snapshotBytes = (bytes: Uint8Array): Uint8Array => Uint8Array.from(bytes);

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
};

/**
 * Explicit UTF-8 byte-order comparator. Baseline IDs are ASCII, so each code
 * unit equals its UTF-8 byte, but the comparator still walks bytes.
 */
const compareUtf8ByteOrder = (left: string, right: string): number => {
  const leftLength = left.length;
  const rightLength = right.length;
  const limit = leftLength < rightLength ? leftLength : rightLength;
  for (let index = 0; index < limit; index += 1) {
    const delta = left.charCodeAt(index) - right.charCodeAt(index);
    if (delta !== 0) {
      return delta;
    }
  }
  return leftLength - rightLength;
};

const compareDigestByteOrder = (left: string, right: string): number =>
  compareUtf8ByteOrder(left, right);

const asciiBytes = (text: string): Uint8Array => {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff;
  }
  return bytes;
};

const concatBytes = (parts: readonly Uint8Array[]): Uint8Array => {
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/**
 * Collect inline tokens for each cell in a table row. Walks from the current
 * tr_open token until tr_close. Returns null when the row is not a well-formed
 * sequence of th/td cells with inline children.
 */
const collectRowCellInlines = (
  tokens: readonly Token[],
  trOpenIndex: number,
): readonly (readonly Token[])[] | null => {
  const cells: (readonly Token[])[] = [];
  let index = trOpenIndex + 1;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) {
      return null;
    }
    if (token.type === "tr_close") {
      return cells;
    }
    if (token.type === "th_open" || token.type === "td_open") {
      const inline = tokens[index + 1];
      const close = tokens[index + 2];
      if (
        inline === undefined ||
        close === undefined ||
        inline.type !== "inline" ||
        (close.type !== "th_close" && close.type !== "td_close")
      ) {
        return null;
      }
      cells.push(inline.children ?? []);
      index += 3;
      continue;
    }
    return null;
  }
  return null;
};

/**
 * Header cell text: exactly one plain text token whose content equals the
 * required header label.
 */
const headerCellText = (children: readonly Token[]): string | null => {
  if (children.length !== 1) {
    return null;
  }
  const only = children[0];
  if (only === undefined || only.type !== "text") {
    return null;
  }
  return only.content;
};

const isExactCoverageHeader = (
  cellInlines: readonly (readonly Token[])[],
): boolean => {
  if (cellInlines.length !== CANONICAL_HEADER_CELLS.length) {
    return false;
  }
  for (let index = 0; index < CANONICAL_HEADER_CELLS.length; index += 1) {
    const text = headerCellText(cellInlines[index] ?? []);
    if (text !== CANONICAL_HEADER_CELLS[index]) {
      return false;
    }
  }
  return true;
};

/**
 * Accept a first-cell ID only when inline content is exactly one plain text
 * token or one code_inline token equal to CW-NNN or RT-NNN.
 */
const parseFirstCellItemId = (children: readonly Token[]): string | null => {
  if (children.length !== 1) {
    return null;
  }
  const only = children[0];
  if (only === undefined) {
    return null;
  }
  if (only.type !== "text" && only.type !== "code_inline") {
    return null;
  }
  if (!ITEM_ID.test(only.content)) {
    return null;
  }
  return only.content;
};

/**
 * Split a physical table row the way markdown-it 15 `escapedSplit` does: a
 * pipe immediately preceded by a backslash is cell content, regardless of the
 * total backslash run length. An unescaped pipe is a cell delimiter.
 */
const escapedSplitRawCells = (body: string): readonly string[] => {
  const result: string[] = [];
  const max = body.length;
  let pos = 0;
  let isEscaped = false;
  let lastPos = 0;
  let current = "";
  while (pos < max) {
    const ch = body.charCodeAt(pos);
    if (ch === 0x7c /* | */) {
      if (!isEscaped) {
        result.push(current + body.slice(lastPos, pos));
        current = "";
        lastPos = pos + 1;
      } else {
        // Drop the escaping backslash; keep the pipe as content.
        current += body.slice(lastPos, pos - 1);
        lastPos = pos;
      }
    }
    isEscaped = ch === 0x5c; /* \ */
    pos += 1;
  }
  result.push(current + body.slice(lastPos));
  return result;
};

/**
 * Raw canonical-row splitter. Accepts zero through three leading spaces,
 * requires leading and trailing outer pipes, and returns exactly six trimmed
 * physical cells or null for every other shape.
 */
const splitRawCanonicalRow = (line: string): readonly string[] | null => {
  let leadingSpaces = 0;
  while (leadingSpaces < line.length && line[leadingSpaces] === " ") {
    leadingSpaces += 1;
  }
  if (leadingSpaces > 3) {
    return null;
  }
  const body = line.slice(leadingSpaces);
  if (body.length < 2) {
    return null;
  }
  if (!body.startsWith("|") || !body.endsWith("|")) {
    return null;
  }
  const parts = escapedSplitRawCells(body);
  // Outer pipes produce empty leading and trailing segments when they are
  // real delimiters (not escaped content).
  if (parts.length < 2) {
    return null;
  }
  if (parts[0] !== "" || parts[parts.length - 1] !== "") {
    return null;
  }
  const inner = parts.slice(1, -1).map((cell) => cell.trim());
  if (inner.length !== 6) {
    return null;
  }
  return inner;
};

/**
 * Raw first-cell ID: exact plain CW-NNN / RT-NNN, or one matching backticked
 * code span. Entity-encoded or otherwise alternate spellings are rejected.
 */
const parseRawFirstCellItemId = (rawCell: string): string | null => {
  if (ITEM_ID.test(rawCell)) {
    return rawCell;
  }
  if (rawCell.length >= 2 && rawCell.startsWith("`") && rawCell.endsWith("`")) {
    const inner = rawCell.slice(1, -1);
    if (ITEM_ID.test(inner)) {
      return inner;
    }
  }
  return null;
};

/**
 * Exact raw header labels. Rejects entity, emphasis, code, or other alternate
 * source spelling even when markdown-it token text would decode to the label.
 */
const isExactRawCoverageHeader = (cells: readonly string[]): boolean => {
  if (cells.length !== CANONICAL_HEADER_CELLS.length) {
    return false;
  }
  for (let index = 0; index < CANONICAL_HEADER_CELLS.length; index += 1) {
    if (cells[index] !== CANONICAL_HEADER_CELLS[index]) {
      return false;
    }
  }
  return true;
};

/**
 * Resolve the single physical source line for a table row from tr_open.map.
 * Multi-line map ranges are rejected so normalized tokens cannot hide split
 * source rows.
 */
const physicalSourceLineForRow = (
  sourceLines: readonly string[],
  trOpen: Token,
): string | null => {
  const map = trOpen.map;
  if (map === null) {
    return null;
  }
  const start = map[0];
  const end = map[1];
  if (end !== start + 1) {
    return null;
  }
  const line = sourceLines[start];
  if (line === undefined) {
    return null;
  }
  return line;
};

/**
 * Split physical source lines for row-form checks. A CR is removed only when
 * it immediately precedes LF (Windows CRLF). Bare CR is ordinary content and
 * is not a line break. Other whitespace is preserved exactly.
 */
const splitPhysicalSourceLines = (text: string): readonly string[] => {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== LF) {
      continue;
    }
    const end =
      index > start && text.charCodeAt(index - 1) === CR ? index - 1 : index;
    lines.push(text.slice(start, end));
    start = index + 1;
  }
  lines.push(text.slice(start));
  return lines;
};

/**
 * Parse baseline IDs from real markdown-it table tokens only. Accepts tables
 * whose header is the exact six-cell coverage matrix header in both raw source
 * and token text. Validates each body row with the raw-row splitter and requires
 * the raw first-cell ID to equal the markdown-it inline ID. Ends a candidate
 * table at the first malformed raw row, raw ID, token row, or mismatch. Fenced
 * code, indented code, and tab-indented lines never yield table tokens under the
 * pinned parser options. Any html_block token, or any html_inline child whose
 * tag name is a CommonMark block-level HTML tag (including div), fails closed
 * with zero IDs — the canonical coverage matrix contains no raw HTML, blank-
 * line-closed openers can leave contributing tables between opener and closer,
 * and prefixed block tags can otherwise emit as html_inline and fail open.
 * Ordinary non-block inline HTML such as span is not rejected.
 */
export const parseCoverageMatrixBaselineIds = (
  matrixText: string,
): readonly string[] => {
  const sourceLines = splitPhysicalSourceLines(matrixText);
  const tokens = markdownIt.parse(matrixText, {});

  // Strict artifact boundary: any raw HTML block, or any block-level HTML tag
  // emitted as html_inline, makes the document non-canonical. Do not attempt
  // to balance or strip HTML. Ordinary non-block inline HTML is allowed.
  if (hasNonCanonicalHtmlTokens(tokens)) {
    return [];
  }

  const ids: string[] = [];
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined || token.type !== "table_open") {
      index += 1;
      continue;
    }

    // Locate thead header row.
    let headerCells: readonly (readonly Token[])[] | null = null;
    let headerTrOpen: Token | null = null;
    let cursor = index + 1;
    while (cursor < tokens.length) {
      const current = tokens[cursor];
      if (current === undefined || current.type === "table_close") {
        break;
      }
      if (current.type === "thead_open") {
        cursor += 1;
        while (cursor < tokens.length) {
          const theadToken = tokens[cursor];
          if (theadToken === undefined || theadToken.type === "thead_close") {
            break;
          }
          if (theadToken.type === "tr_open") {
            headerTrOpen = theadToken;
            headerCells = collectRowCellInlines(tokens, cursor);
            // Skip to tr_close.
            while (
              cursor < tokens.length &&
              tokens[cursor]?.type !== "tr_close"
            ) {
              cursor += 1;
            }
          }
          cursor += 1;
        }
        break;
      }
      cursor += 1;
    }

    const headerPhysical =
      headerTrOpen === null
        ? null
        : physicalSourceLineForRow(sourceLines, headerTrOpen);
    const headerRawCells =
      headerPhysical === null ? null : splitRawCanonicalRow(headerPhysical);
    const headerOk =
      headerCells !== null &&
      isExactCoverageHeader(headerCells) &&
      headerRawCells !== null &&
      isExactRawCoverageHeader(headerRawCells);

    if (!headerOk) {
      // Advance past this table without collecting IDs.
      while (index < tokens.length && tokens[index]?.type !== "table_close") {
        index += 1;
      }
      index += 1;
      continue;
    }

    // Collect body rows under tbody until table_close or malformed row.
    let collecting = true;
    while (index < tokens.length) {
      const current = tokens[index];
      if (current === undefined) {
        break;
      }
      if (current.type === "table_close") {
        index += 1;
        break;
      }
      if (collecting && current.type === "tr_open") {
        // Skip header rows (already handled); only body td rows contribute.
        const firstOpen = tokens[index + 1];
        const isBodyRow = firstOpen?.type === "td_open";
        if (isBodyRow) {
          const physicalLine = physicalSourceLineForRow(sourceLines, current);
          const rawCells =
            physicalLine === null ? null : splitRawCanonicalRow(physicalLine);
          if (rawCells === null) {
            collecting = false;
          } else {
            const rawId = parseRawFirstCellItemId(rawCells[0] ?? "");
            const rowCells = collectRowCellInlines(tokens, index);
            if (rawId === null || rowCells === null || rowCells.length !== 6) {
              collecting = false;
            } else {
              const tokenId = parseFirstCellItemId(rowCells[0] ?? []);
              if (tokenId === null || tokenId !== rawId) {
                // Plain non-ID, code-inline non-ID, entity-encoded raw ID,
                // token/raw mismatch, or any other first-cell shape ends this
                // candidate table.
                collecting = false;
              } else {
                ids.push(tokenId);
              }
            }
          }
        }
      }
      index += 1;
    }
  }

  return ids;
};

const countDispositions = (
  itemResults: readonly SpecCorrectnessItemResultV1[],
): {
  readonly mappedItemCount: number;
  readonly evidencedDeferCount: number;
  readonly omittedItemCount: number;
  readonly contradictionCount: number;
  readonly unevidencedDeferCount: number;
} => {
  let mappedItemCount = 0;
  let evidencedDeferCount = 0;
  let omittedItemCount = 0;
  let contradictionCount = 0;
  let unevidencedDeferCount = 0;
  for (const item of itemResults) {
    switch (item.disposition) {
      case "mapped":
        mappedItemCount += 1;
        break;
      case "evidenced_defer":
        evidencedDeferCount += 1;
        break;
      case "omitted":
        omittedItemCount += 1;
        break;
      case "contradiction":
        contradictionCount += 1;
        break;
      case "unevidenced_defer":
        unevidencedDeferCount += 1;
        break;
    }
  }
  return {
    mappedItemCount,
    evidencedDeferCount,
    omittedItemCount,
    contradictionCount,
    unevidencedDeferCount,
  };
};

const buildMetrics = (
  counts: ReturnType<typeof countDispositions>,
  inventedCompletionCount: number,
): SpecCorrectnessMetricsV1 => {
  const covered = counts.mappedItemCount + counts.evidencedDeferCount;
  return {
    schemaVersion: 1,
    baselineItemCount: BASELINE_ITEM_COUNT,
    mappedItemCount: counts.mappedItemCount,
    evidencedDeferCount: counts.evidencedDeferCount,
    omittedItemCount: counts.omittedItemCount,
    contradictionCount: counts.contradictionCount,
    unevidencedDeferCount: counts.unevidencedDeferCount,
    inventedCompletionCount,
    coverageRatio: {
      numerator: covered,
      denominator: BASELINE_ITEM_COUNT,
    },
  };
};

/**
 * Call an injected SHA-256 canary against a disposable copy. Portable digest
 * is always computed from the unexposed canonical bytes. Mutation of the
 * disposable copy fails closed as primitive_input_mutation.
 */
const callSha256 = (
  sha256: SpecCorrectnessEvaluatorPrimitivesV1["sha256"],
  canonical: Uint8Array,
):
  | { readonly ok: true; readonly digest: Sha256Digest }
  | {
      readonly ok: false;
      readonly reason: SpecCorrectnessInvalidReasonV1;
    } => {
  const portable = portableSha256Hex(canonical);
  const disposable = snapshotBytes(canonical);
  let callbackDigest: unknown;
  try {
    callbackDigest = sha256(disposable);
  } catch {
    return { ok: false, reason: "primitive_throw" };
  }
  if (!bytesEqual(disposable, canonical)) {
    return { ok: false, reason: "primitive_input_mutation" };
  }
  if (
    typeof callbackDigest !== "string" ||
    !SHA256_HEX.test(callbackDigest) ||
    callbackDigest !== portable
  ) {
    return { ok: false, reason: "digest_disagreement" };
  }
  return { ok: true, digest: portable };
};

/**
 * True when the UTF-16 string contains any unpaired high or low surrogate.
 * Well-formed surrogate pairs (U+10000..U+10FFFF) are accepted.
 */
const hasUnpairedSurrogate = (text: string): boolean => {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= text.length) {
        return true;
      }
      const next = text.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
};

const UTF8_BOM_0 = 0xef;
const UTF8_BOM_1 = 0xbb;
const UTF8_BOM_2 = 0xbf;

/**
 * True when `canonical` begins with exactly one UTF-8 BOM (EF BB BF) and
 * `reencoded` equals the remaining bytes after that single BOM. Does not
 * strip or normalize any other prefix.
 */
const matchesStandardBomStripping = (
  canonical: Uint8Array,
  reencoded: Uint8Array,
): boolean => {
  if (
    canonical.length < 3 ||
    canonical[0] !== UTF8_BOM_0 ||
    canonical[1] !== UTF8_BOM_1 ||
    canonical[2] !== UTF8_BOM_2
  ) {
    return false;
  }
  if (reencoded.length !== canonical.length - 3) {
    return false;
  }
  for (let index = 0; index < reencoded.length; index += 1) {
    if (reencoded[index] !== canonical[index + 3]) {
      return false;
    }
  }
  return true;
};

/**
 * Call an injected UTF-8 decoder against a disposable copy. Treats the return
 * as unknown; only string or null are accepted. Mutation, invalid returns,
 * throws, unpaired surrogates, and byte substitution fail closed. Standard
 * fatal TextDecoder BOM stripping is accepted only when canonical bytes begin
 * with EF BB BF and re-encoding the well-formed return equals the remaining
 * bytes after that one BOM.
 */
const callDecodeUtf8 = (
  decodeUtf8: SpecCorrectnessEvaluatorPrimitivesV1["decodeUtf8"],
  canonical: Uint8Array,
):
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: SpecCorrectnessInvalidReasonV1 }
  | { readonly ok: false; readonly utf8Invalid: true } => {
  const disposable = snapshotBytes(canonical);
  let decoded: unknown;
  try {
    decoded = decodeUtf8(disposable);
  } catch {
    return { ok: false, reason: "primitive_throw" };
  }
  if (!bytesEqual(disposable, canonical)) {
    return { ok: false, reason: "primitive_input_mutation" };
  }
  if (decoded === null) {
    return { ok: false, utf8Invalid: true };
  }
  if (typeof decoded !== "string") {
    return { ok: false, reason: "primitive_return_invalid" };
  }
  if (hasUnpairedSurrogate(decoded)) {
    return { ok: false, reason: "primitive_return_invalid" };
  }
  let reencoded: Uint8Array;
  try {
    reencoded = portableEncodeUtf8(decoded);
  } catch {
    return { ok: false, reason: "primitive_return_invalid" };
  }
  if (bytesEqual(reencoded, canonical)) {
    return { ok: true, text: decoded };
  }
  if (matchesStandardBomStripping(canonical, reencoded)) {
    return { ok: true, text: decoded };
  }
  return { ok: false, reason: "decoder_byte_substitution" };
};

const validateArtifacts = (
  artifacts: readonly {
    readonly alias: string;
    readonly sha256: Sha256Digest;
    readonly bytes: Uint8Array;
  }[],
  sha256: SpecCorrectnessEvaluatorPrimitivesV1["sha256"],
): SpecCorrectnessInvalidReasonV1 | null => {
  const aliases = new Set<string>();
  for (const artifact of artifacts) {
    if (aliases.has(artifact.alias)) {
      return "duplicate_artifact_alias";
    }
    aliases.add(artifact.alias);
    const digestResult = callSha256(sha256, artifact.bytes);
    if (!digestResult.ok) {
      return digestResult.reason;
    }
    if (digestResult.digest !== artifact.sha256) {
      return "artifact_digest_mismatch";
    }
  }
  return null;
};

const inventionRecordPayload = (
  artifactSha256: string,
  startByte: number,
  endByte: number,
  slice: Uint8Array,
): Uint8Array =>
  concatBytes([
    asciiBytes(artifactSha256),
    new Uint8Array([NUL]),
    asciiBytes(String(startByte)),
    new Uint8Array([NUL]),
    asciiBytes(String(endByte)),
    new Uint8Array([NUL]),
    slice,
  ]);

const validateInventions = (
  inventions: readonly InventedCompletionV1[],
  artifacts: readonly {
    readonly alias: string;
    readonly sha256: Sha256Digest;
    readonly bytes: Uint8Array;
  }[],
  primitives: SpecCorrectnessEvaluatorPrimitivesV1,
): SpecCorrectnessInvalidReasonV1 | null => {
  const byAlias = new Map<
    string,
    {
      readonly alias: string;
      readonly sha256: Sha256Digest;
      readonly bytes: Uint8Array;
    }
  >();
  for (const artifact of artifacts) {
    byAlias.set(artifact.alias, artifact);
  }

  const seenDigests = new Set<string>();
  let previousDigest: string | null = null;

  for (const invention of inventions) {
    const artifact = byAlias.get(invention.artifactAlias);
    if (artifact === undefined) {
      return "unknown_invention_artifact";
    }
    if (artifact.sha256 !== invention.artifactSha256) {
      return "artifact_digest_mismatch";
    }

    const { startByte, endByte } = invention;
    if (
      !Number.isSafeInteger(startByte) ||
      !Number.isSafeInteger(endByte) ||
      startByte < 0 ||
      endByte <= startByte ||
      endByte > artifact.bytes.length
    ) {
      return "invention_range_invalid";
    }

    if (startByte !== 0 && artifact.bytes[startByte - 1] !== LF) {
      return "invention_start_misaligned";
    }
    if (
      endByte !== artifact.bytes.length &&
      artifact.bytes[endByte - 1] !== LF
    ) {
      return "invention_end_misaligned";
    }

    // Canonical slice snapshot — later checks and callbacks never see a live
    // view into the artifact buffer.
    const sliceCanonical = snapshotBytes(
      artifact.bytes.subarray(startByte, endByte),
    );
    if (sliceCanonical.length === 0) {
      return "invention_range_invalid";
    }

    const decodeResult = callDecodeUtf8(primitives.decodeUtf8, sliceCanonical);
    if (!decodeResult.ok) {
      if ("utf8Invalid" in decodeResult) {
        return "invention_slice_invalid_utf8";
      }
      return decodeResult.reason;
    }

    const claimDigestResult = callSha256(primitives.sha256, sliceCanonical);
    if (!claimDigestResult.ok) {
      return claimDigestResult.reason;
    }
    if (claimDigestResult.digest !== invention.claimSha256) {
      return "invention_claim_digest_mismatch";
    }

    const recordPayload = snapshotBytes(
      inventionRecordPayload(
        invention.artifactSha256,
        startByte,
        endByte,
        sliceCanonical,
      ),
    );
    const recordDigestResult = callSha256(primitives.sha256, recordPayload);
    if (!recordDigestResult.ok) {
      return recordDigestResult.reason;
    }
    if (recordDigestResult.digest !== invention.recordSha256) {
      return "invention_record_digest_mismatch";
    }

    if (seenDigests.has(invention.recordSha256)) {
      return "duplicate_invention_digest";
    }
    seenDigests.add(invention.recordSha256);

    if (
      previousDigest !== null &&
      compareDigestByteOrder(previousDigest, invention.recordSha256) > 0
    ) {
      return "invention_records_unsorted";
    }
    previousDigest = invention.recordSha256;
  }

  return null;
};

const hasMetricDefect = (
  counts: ReturnType<typeof countDispositions>,
  inventedCompletionCount: number,
): boolean =>
  counts.omittedItemCount > 0 ||
  counts.contradictionCount > 0 ||
  counts.unevidencedDeferCount > 0 ||
  inventedCompletionCount > 0 ||
  counts.mappedItemCount + counts.evidencedDeferCount !== BASELINE_ITEM_COUNT;

const hasActionableDefect = (
  counts: ReturnType<typeof countDispositions>,
  inventedCompletionCount: number,
  findings: readonly SpecCorrectnessFindingV1[],
): boolean =>
  hasMetricDefect(counts, inventedCompletionCount) || findings.length > 0;

/**
 * Pure SpecCorrectnessV1 evaluator. Counts and outcome are host-derived from
 * item results, invention records, and findings. Provider-supplied counts are
 * ignored. Injected primitives are canaries, not roots of trust: each call
 * receives a disposable copy and cannot mutate the canonical snapshot.
 */
export const evaluateSpecCorrectnessV1 = (
  input: EvaluateSpecCorrectnessV1Input,
): SpecCorrectnessEvaluationResultV1 => {
  const matrixSnapshot = snapshotBytes(input.coverageMatrixBytes);
  const artifactSnapshots = input.evidenceArtifacts.map((artifact) => ({
    alias: artifact.alias,
    sha256: artifact.sha256,
    bytes: snapshotBytes(artifact.bytes),
  }));

  let response: SpecCorrectnessProviderResponseV1;
  try {
    response = decodeStrictSync(ProviderResponseSchema, input.response);
  } catch {
    return invalid("provider_response_invalid");
  }

  const matrixDecode = callDecodeUtf8(input.decodeUtf8, matrixSnapshot);
  if (!matrixDecode.ok) {
    if ("utf8Invalid" in matrixDecode) {
      return invalid("coverage_matrix_invalid_utf8");
    }
    return invalid(matrixDecode.reason);
  }
  const matrixText = matrixDecode.text;

  const parsedIds = parseCoverageMatrixBaselineIds(matrixText);
  const seenMatrixIds = new Set<string>();
  for (const id of parsedIds) {
    if (seenMatrixIds.has(id)) {
      return invalid("duplicate_matrix_id");
    }
    seenMatrixIds.add(id);
  }
  if (parsedIds.length !== BASELINE_ITEM_COUNT) {
    return invalid("baseline_id_count_invalid");
  }

  const canonicalSet = new Set(CANONICAL_BASELINE_IDS);
  if (parsedIds.length !== CANONICAL_BASELINE_IDS.length) {
    return invalid("baseline_set_mismatch");
  }
  for (const id of parsedIds) {
    if (!canonicalSet.has(id)) {
      return invalid("baseline_set_mismatch");
    }
  }
  for (const id of CANONICAL_BASELINE_IDS) {
    if (!seenMatrixIds.has(id)) {
      return invalid("baseline_set_mismatch");
    }
  }

  const baselineIds = CANONICAL_BASELINE_IDS;

  const itemResults = response.itemResults;
  const resultIds = itemResults.map((item) => item.itemId);
  const seenResultIds = new Set<string>();
  for (const id of resultIds) {
    if (seenResultIds.has(id)) {
      return invalid("duplicate_item_result_id");
    }
    seenResultIds.add(id);
  }

  const baselineSet = new Set(baselineIds);
  for (const id of resultIds) {
    if (!baselineSet.has(id)) {
      return invalid("unknown_item_result_id");
    }
  }

  if (resultIds.length !== baselineIds.length) {
    return invalid("item_result_order_mismatch");
  }
  for (let index = 0; index < baselineIds.length; index += 1) {
    if (resultIds[index] !== baselineIds[index]) {
      return invalid("item_result_order_mismatch");
    }
  }

  const artifactError = validateArtifacts(artifactSnapshots, input.sha256);
  if (artifactError !== null) {
    return invalid(artifactError);
  }

  const inventionError = validateInventions(
    response.inventedCompletions,
    artifactSnapshots,
    { sha256: input.sha256, decodeUtf8: input.decodeUtf8 },
  );
  if (inventionError !== null) {
    return invalid(inventionError);
  }

  const counts = countDispositions(itemResults);
  const inventedCompletionCount = response.inventedCompletions.length;
  const findings = response.findings;
  const metrics = buildMetrics(counts, inventedCompletionCount);
  const defect = hasActionableDefect(counts, inventedCompletionCount, findings);

  if (response.outcome === "abstain") {
    // Abstention cannot suppress dissent: any finding, defect disposition, or
    // invention is a closed invalid reason, never Valid/abstain.
    if (defect) {
      return invalid("declared_abstain_with_defect");
    }
    return {
      schemaVersion: 1,
      _tag: "Valid",
      outcome: "abstain",
      metrics,
      evidenceGaps: response.evidenceGaps,
      nextAction: response.nextAction,
    };
  }

  if (response.outcome === "accept" && findings.length > 0) {
    return invalid("declared_accept_with_findings");
  }

  if (!defect) {
    if (response.outcome === "accept") {
      return {
        schemaVersion: 1,
        _tag: "Valid",
        outcome: "accept",
        metrics,
        findings: [],
      };
    }
    return invalid("declared_changes_without_defect");
  }

  if (response.outcome === "changes_requested") {
    return {
      schemaVersion: 1,
      _tag: "Valid",
      outcome: "changes_requested",
      metrics,
      findings: [...findings],
    };
  }

  return invalid("declared_accept_with_defect");
};
