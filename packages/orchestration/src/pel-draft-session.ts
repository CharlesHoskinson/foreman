import { createHash } from "node:crypto";
import { Effect } from "effect";
import { parsePel, type PelNode, type PelProfileV1 } from "@foreman/pel";

export interface DraftFailure {
  readonly _tag: "DraftFailure";
  readonly code: string;
  readonly message: string;
}
export interface DraftRevision {
  readonly revision: number;
  readonly sourceDigest: string;
  readonly byteLength: number;
}
export interface PelDraftSession<T> {
  source(): Uint8Array;
  check(): T;
  nodes(): readonly PelNode[];
  history(): readonly DraftRevision[];
  complete(prefix: string): readonly string[];
  replace(
    kind: "program" | "expression" | "suffix",
    fragment: Uint8Array,
    nodeId?: string,
  ): Effect.Effect<T, DraftFailure>;
  undo(): Effect.Effect<T, DraftFailure>;
}
const failure = (code: string, message: string): DraftFailure => ({
  _tag: "DraftFailure",
  code,
  message,
});
export function makePelDraftSession<T>(input: {
  readonly source: Uint8Array;
  readonly check: (source: Uint8Array) => T;
  readonly symbols: readonly string[];
  readonly profile?: PelProfileV1;
  readonly continuation?: unknown;
}): Effect.Effect<PelDraftSession<T>, DraftFailure> {
  return Effect.gen(function* () {
    if (input.continuation !== undefined)
      return yield* Effect.fail(
        failure(
          "PEL_DRAFT_EXECUTED",
          "Run-bound continuations cannot enter a draft session",
        ),
      );
    const maxBytes = Math.min(
      input.profile?.limits.maxSourceBytes ?? 1024 * 1024,
      1024 * 1024,
    );
    if (input.source.byteLength > maxBytes)
      return yield* Effect.fail(
        failure("PEL_LIMIT", "Draft exceeds source byte limit"),
      );
    let serial = 0;
    const record = (source: Uint8Array) => ({
      revision: serial++,
      sourceDigest: createHash("sha256").update(source).digest("hex"),
      byteLength: source.byteLength,
      source: source.slice(),
    });
    const revisions = [record(input.source)];
    let currentCheck = input.check(input.source.slice());
    const current = () => revisions[revisions.length - 1]!;
    const nodes = (): readonly PelNode[] => {
      const parsed = parsePel(current().source, input.profile);
      return parsed.ok ? parsed.value.expressions : [];
    };
    const allNodes = () => {
      const pending = [...nodes()];
      const result: PelNode[] = [];
      while (pending.length) {
        const n = pending.pop()!;
        result.push(n);
        if (n.kind === "call" || n.kind === "list") pending.push(...n.items);
        else if (n.kind === "pair") pending.push(n.value);
        else if (n.kind === "quote") pending.push(n.expression);
        else if (n.kind === "pipe") pending.push(n.left, n.right);
      }
      return result;
    };
    return {
      source: () => current().source.slice(),
      check: () => currentCheck,
      nodes,
      history: () =>
        revisions.map(({ revision, sourceDigest, byteLength }) => ({
          revision,
          sourceDigest,
          byteLength,
        })),
      complete: (prefix) =>
        [
          ...new Set([
            ...input.symbols,
            "show",
            "check",
            "preview",
            "history",
            "undo",
            "replace-expression",
            "replace-suffix",
            "replace-program",
            "repair",
            "export",
            "abort",
          ]),
        ]
          .filter((x) => x.startsWith(prefix))
          .sort(),
      replace: (kind, fragment, nodeId) =>
        Effect.gen(function* () {
          if (fragment.byteLength > maxBytes)
            return yield* Effect.fail(
              failure("PEL_LIMIT", "Fragment exceeds source byte limit"),
            );
          let source = fragment.slice();
          if (kind !== "program") {
            const parsed = parsePel(fragment, input.profile);
            if (
              !parsed.ok ||
              (kind === "expression" && parsed.value.expressions.length !== 1)
            )
              return yield* Effect.fail(
                failure(
                  "PEL_PARSE",
                  "Expression replacement requires exactly one parsed expression",
                ),
              );
            const target = (kind === "suffix" ? nodes() : allNodes()).find(
              (n) => n.nodeId === nodeId,
            );
            if (!target)
              return yield* Effect.fail(
                failure(
                  "PEL_DRAFT_NODE",
                  "Node is absent, stale, or not a top-level suffix",
                ),
              );
            source = Buffer.concat([
              current().source.subarray(0, target.span.start),
              fragment,
              kind === "expression"
                ? current().source.subarray(target.span.end)
                : new Uint8Array(),
            ]);
          }
          if (source.byteLength > maxBytes)
            return yield* Effect.fail(
              failure("PEL_LIMIT", "Replacement exceeds source byte limit"),
            );
          currentCheck = input.check(source.slice());
          revisions.push(record(source));
          let total = revisions.reduce((sum, r) => sum + r.byteLength, 0);
          while (revisions.length > 100 || total > 16 * 1024 * 1024)
            total -= revisions.shift()!.byteLength;
          return currentCheck;
        }),
      undo: () =>
        Effect.gen(function* () {
          if (revisions.length < 2)
            return yield* Effect.fail(
              failure("PEL_DRAFT_HISTORY", "No older revision remains"),
            );
          revisions.pop();
          currentCheck = input.check(current().source.slice());
          return currentCheck;
        }),
    } satisfies PelDraftSession<T>;
  });
}
