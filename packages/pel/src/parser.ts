import { createHash } from "node:crypto";
import { combineSpans } from "./ast.js";
import type { PelNode, PelProgram, SourceSpan } from "./ast.js";
import { diagnostic } from "./diagnostics.js";
import type { PelDiagnostic } from "./diagnostics.js";
import { PEL_PROFILE } from "./profile.js";
import type { PelProfileV1 } from "./profile.js";
import { tokenizePel } from "./tokenizer.js";
import type { PelToken } from "./tokenizer.js";
import type { Result } from "./types.js";
type NodeFields = PelNode extends infer N
  ? N extends PelNode
    ? Omit<N, "nodeId" | "span">
    : never
  : never;
class ParseFailure {
  constructor(readonly error: PelDiagnostic) {}
}
export function parsePel(
  source: Uint8Array,
  profile: PelProfileV1 = PEL_PROFILE,
): Result<PelProgram, readonly PelDiagnostic[]> {
  const lexed = tokenizePel(source, profile);
  if (!lexed.ok) return lexed;
  const { tokens, end } = lexed.value;
  let at = 0;
  let astNodes = 0;
  let syntaxDepthPeak = 0;
  const sourceDigest = createHash("sha256").update(source).digest("hex");
  const currentSpan = () => tokens[at]?.span ?? end;
  const node = (fields: NodeFields, span: SourceSpan): PelNode => {
    astNodes++;
    if (astNodes > profile.limits.maxAstNodes)
      throw new ParseFailure(
        diagnostic("PEL_LIMIT", span, "AST node limit exceeded", {
          bound: "maxAstNodes",
          consumed: astNodes,
        }),
      );
    return { ...fields, nodeId: "", span } as PelNode;
  };
  const checkDepth = (depth: number, span: SourceSpan) => {
    syntaxDepthPeak = Math.max(syntaxDepthPeak, depth);
    if (depth > profile.limits.maxSyntaxDepth)
      throw new ParseFailure(
        diagnostic("PEL_LIMIT", span, "Syntax depth limit exceeded", {
          bound: "maxSyntaxDepth",
          consumed: depth,
        }),
      );
  };
  const expected = (
    message: string,
    forms: readonly string[],
    span = currentSpan(),
  ): never => {
    throw new ParseFailure(
      diagnostic("PEL_PARSE", span, message, { expectedForms: forms }),
    );
  };
  // Scheduled parser steps keep host-admitted depths independent of the JS stack.
  const work: (() => void)[] = [];
  const deliver = <T>(receive: (value: T) => void, value: T) => {
    work.push(() => receive(value));
  };
  function primary(
    quoted: boolean,
    depth: number,
    receive: (value: PelNode) => void,
  ): void {
    work.push(() => {
      const token = tokens[at++];
      if (!token) return expected("Expected an expression", ["expression"]);
      let value: PelNode;
      switch (token.kind) {
        case "number":
          value = node(
            { kind: "number", value: token.value as number },
            token.span,
          );
          break;
        case "string":
          value = node(
            { kind: "string", value: token.value as string },
            token.span,
          );
          break;
        case "boolean":
          value = node(
            { kind: "boolean", value: token.value as boolean },
            token.span,
          );
          break;
        case "nil":
          value = node({ kind: "nil" }, token.span);
          break;
        case "key":
        case "symbol":
          value = node(
            { kind: token.kind, name: token.value as string },
            token.span,
          );
          break;
        case "caret":
          value = node({ kind: "caret" }, token.span);
          break;
        case "quote":
          checkDepth(depth + 1, token.span);
          expr(true, depth + 1, (expression) =>
            deliver(
              receive,
              node(
                { kind: "quote", expression },
                combineSpans(token.span, expression.span),
              ),
            ),
          );
          return;
        case "open-call":
        case "open-list": {
          checkDepth(depth + 1, token.span);
          const closing =
            token.kind === "open-call" ? "close-call" : "close-list";
          sequence(
            quoted,
            depth + 1,
            (items) => {
              const close = tokens[at++];
              if (!close || close.kind !== closing)
                return expected(
                  "Unclosed delimiter",
                  [closing === "close-call" ? ")" : "]"],
                  close?.span ?? end,
                );
              const span = combineSpans(token.span, close.span);
              deliver(
                receive,
                token.kind === "open-call" && items.length === 0
                  ? node({ kind: "nil" }, span)
                  : node(
                      {
                        kind: token.kind === "open-call" ? "call" : "list",
                        items,
                      },
                      span,
                    ),
              );
            },
            closing,
          );
          return;
        }
        default:
          return expected("Expected an expression", ["expression"], token.span);
      }
      deliver(receive, value);
    });
  }
  function expr(
    quoted: boolean,
    depth: number,
    receive: (value: PelNode) => void,
  ): void {
    const pipe = (left: PelNode): void => {
      if (tokens[at]?.kind !== "pipe") {
        deliver(receive, left);
        return;
      }
      at++;
      primary(quoted, depth, (right) =>
        deliver(
          pipe,
          node(
            { kind: "pipe", left, right },
            combineSpans(left.span, right.span),
          ),
        ),
      );
    };
    primary(quoted, depth, pipe);
  }
  function sequence(
    quoted: boolean,
    depth: number,
    receive: (values: PelNode[]) => void,
    closing?: PelToken["kind"],
  ): void {
    const items: PelNode[] = [];
    const append = (value: PelNode) => {
      items.push(value);
      work.push(next);
    };
    const next = (): void => {
      if (at >= tokens.length || tokens[at]?.kind === closing) {
        deliver(receive, items);
        return;
      }
      expr(quoted, depth, (item) => {
        if (quoted || item.kind !== "key") {
          append(item);
          return;
        }
        const token = tokens[at];
        const valuePresent =
          token !== undefined &&
          token.kind !== "key" &&
          token.kind !== "close-call" &&
          token.kind !== "close-list";
        const key = item.name;
        const keySpan = item.span;
        astNodes--;
        const pair = (value: PelNode) =>
          append(
            node(
              { kind: "pair", key, value, valuePresent },
              valuePresent ? combineSpans(keySpan, value.span) : keySpan,
            ),
          );
        if (valuePresent) expr(quoted, depth, pair);
        else
          pair(
            node(
              { kind: "nil" },
              {
                ...keySpan,
                start: keySpan.end,
                line: keySpan.endLine,
                column: keySpan.endColumn,
              },
            ),
          );
      });
    };
    work.push(next);
  }
  try {
    let expressions: PelNode[] = [];
    sequence(false, 0, (value) => {
      expressions = value;
    });
    while (work.length) work.pop()!();
    // Assign source-relative child paths after pair and pipe normalization.
    const pending = expressions
      .map((expression, index) => ({
        expression,
        path: String(index),
        depth: 0,
      }))
      .reverse();
    while (pending.length) {
      const { expression, path, depth } = pending.pop()!;
      const nestedDepth =
        depth +
        (["list", "call", "quote", "pipe"].includes(expression.kind) ? 1 : 0);
      checkDepth(nestedDepth, expression.span);
      (expression as { nodeId: string }).nodeId = `${sourceDigest}:${path}`;
      const children =
        expression.kind === "list" || expression.kind === "call"
          ? expression.items
          : expression.kind === "pair"
            ? [expression.value]
            : expression.kind === "quote"
              ? [expression.expression]
              : expression.kind === "pipe"
                ? [expression.left, expression.right]
                : [];
      for (let i = children.length - 1; i >= 0; i--)
        pending.push({
          expression: children[i]!,
          path: `${path}.${i}`,
          depth: nestedDepth,
        });
      if (expression.kind === "list" || expression.kind === "call")
        Object.freeze(expression.items);
      Object.freeze(expression.span);
      Object.freeze(expression);
    }
    return {
      ok: true,
      value: Object.freeze({
        sourceDigest,
        profileId: profile.id,
        profileDigest: profile.digest,
        expressions: Object.freeze(expressions),
        sourceBytes: source.byteLength,
        tokens: tokens.length,
        astNodes,
        syntaxDepthPeak,
      }),
    };
  } catch (error) {
    if (error instanceof ParseFailure)
      return { ok: false, error: [error.error] };
    throw error;
  }
}
