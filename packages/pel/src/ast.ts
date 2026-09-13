export interface SourceSpan {
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
}
export interface NodeBase {
  readonly nodeId: string;
  readonly span: SourceSpan;
}
export type PelNode = NodeBase &
  (
    | { readonly kind: "number"; readonly value: number }
    | { readonly kind: "string"; readonly value: string }
    | { readonly kind: "boolean"; readonly value: boolean }
    | { readonly kind: "nil" }
    | { readonly kind: "key" | "symbol"; readonly name: string }
    | { readonly kind: "caret" }
    | {
        readonly kind: "pair";
        readonly key: string;
        readonly value: PelNode;
        readonly valuePresent: boolean;
      }
    | { readonly kind: "list" | "call"; readonly items: readonly PelNode[] }
    | { readonly kind: "quote"; readonly expression: PelNode }
    | { readonly kind: "pipe"; readonly left: PelNode; readonly right: PelNode }
  );
export interface PelProgram {
  readonly sourceDigest: string;
  readonly profileId: string;
  readonly profileDigest: string;
  readonly expressions: readonly PelNode[];
  readonly sourceBytes: number;
  readonly tokens: number;
  readonly astNodes: number;
  readonly syntaxDepthPeak: number;
}
export function combineSpans(first: SourceSpan, last: SourceSpan): SourceSpan {
  return {
    start: first.start,
    end: last.end,
    line: first.line,
    column: first.column,
    endLine: last.endLine,
    endColumn: last.endColumn,
  };
}
