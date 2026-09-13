import { canonicalize, sha256Hex } from "@foreman/core";
import { parsePel } from "./parser.js";
import { validateAuthoringSnapshotV1 } from "./snapshot.js";
import { createPlanBindingV1, validateBinding } from "./binding.js";
import { analyzePel } from "./analysis.js";
import type { PelNode } from "./ast.js";
import { builtinArgSpecs } from "./builtins.js";
import type {
  AuthoringDiagnostic,
  AuthoringSnapshotV1,
} from "./authoring-types.js";
import type {
  CheckInputV1,
  CheckResultV1,
  CheckedProgramV1,
} from "./analysis-types.js";
const checkedPrograms = new WeakSet<object>();
function freezeTree(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value))
    return;
  for (const nested of Object.values(value)) freezeTree(nested);
  Object.freeze(value);
}
function normalize(node: PelNode): unknown {
  const { nodeId: _id, span: _span, ...syntax } = node;
  switch (node.kind) {
    case "list":
    case "call":
      return { ...syntax, items: node.items.map(normalize) };
    case "pair":
      return { ...syntax, value: normalize(node.value) };
    case "quote":
      return { ...syntax, expression: normalize(node.expression) };
    case "pipe":
      return {
        ...syntax,
        left: normalize(node.left),
        right: normalize(node.right),
      };
    default:
      return syntax;
  }
}
function usage(
  error: AuthoringDiagnostic,
  nodes: readonly PelNode[],
  snapshot: AuthoringSnapshotV1,
): AuthoringDiagnostic {
  const pending = [...nodes];
  let call: PelNode | undefined;
  let symbol: string | undefined;
  while (pending.length) {
    const n = pending.pop()!;
    if (n.span.start > error.span.start || n.span.end < error.span.end)
      continue;
    if (n.kind === "symbol") symbol = n.name;
    if (n.kind === "call") call = n;
    if (n.kind === "call" || n.kind === "list") pending.push(...n.items);
    else if (n.kind === "pair") pending.push(n.value);
    else if (n.kind === "pipe") pending.push(n.left, n.right);
  }
  let name =
    call?.kind === "call" && call.items[0]?.kind === "symbol"
      ? call.items[0].name
      : symbol;
  const catalog = new Map([
    ...Object.entries(builtinArgSpecs),
    ...snapshot.registry.descriptors.map((d) => [d.name, d.argSpec] as const),
  ]);
  let suggested = false;
  if (name && !catalog.has(name)) {
    const distance = (a: string, b: string): number => {
      if (Math.abs(a.length - b.length) > 2 || a.length > 128 || b.length > 128)
        return 3;
      let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
      for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++)
          row[j] = Math.min(
            row[j - 1]! + 1,
            previous[j]! + 1,
            previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
          );
        previous = row;
      }
      return previous[b.length]!;
    };
    const closest = [...catalog.keys()]
      .map((candidate) => ({ candidate, distance: distance(name!, candidate) }))
      .filter((row) => row.distance <= 2)
      .sort(
        (a, b) =>
          a.distance - b.distance || a.candidate.localeCompare(b.candidate),
      )[0];
    name = closest?.candidate;
    suggested = name !== undefined;
  }
  const spec = name && catalog.get(name);
  if (!spec) return error;
  const signature =
    spec.kind === "fixed"
      ? `(${name} ${spec.parameters.map((p) => `:${p.name}${p.required ? "" : " [optional]"}`).join(" ")})`
      : `(${name} expression...)`;
  return {
    ...error,
    signature,
    help: suggested
      ? `Did you mean ${name}? Check this registered signature.`
      : "Use only named arguments or only positional arguments. Select values admitted by the authoring snapshot.",
  };
}
export function isCheckedProgramV1(value: CheckedProgramV1): boolean {
  return (
    checkedPrograms.has(value) &&
    validateBinding(value.binding, value.source, value.snapshot).ok
  );
}
export function checkPel(input: CheckInputV1): CheckResultV1 {
  const snapshot = validateAuthoringSnapshotV1(input.snapshot);
  if (!snapshot.ok) return { tag: "invalid", diagnostics: snapshot.error };
  const source = new Uint8Array(input.source),
    profile = input.profile ?? snapshot.value.languageProfile;
  if (canonicalize(profile) !== canonicalize(snapshot.value.languageProfile))
    return {
      tag: "invalid",
      diagnostics: [
        {
          code: "PEL_PROFILE_UNSUPPORTED",
          severity: "error",
          span: {
            start: 0,
            end: 0,
            line: 1,
            column: 1,
            endLine: 1,
            endColumn: 1,
          },
          relatedSpans: [],
          expectedForms: [],
          message: "Check profile differs from the authoring snapshot",
        },
      ],
    };
  const parsed = parsePel(source, profile);
  if (!parsed.ok) return { tag: "invalid", diagnostics: parsed.error };
  const limits = snapshot.value.limits;
  const measured = {
    maxSourceBytes: parsed.value.sourceBytes,
    maxTokens: parsed.value.tokens,
    maxAstNodes: parsed.value.astNodes,
    maxSyntaxDepth: parsed.value.syntaxDepthPeak,
  };
  for (const [key, consumed] of Object.entries(measured))
    if (consumed > limits[key as keyof typeof measured])
      return {
        tag: "invalid",
        diagnostics: [
          {
            code: "PEL_LIMIT",
            severity: "error",
            span: parsed.value.expressions[0]?.span ?? {
              start: 0,
              end: 0,
              line: 1,
              column: 1,
              endLine: 1,
              endColumn: 1,
            },
            relatedSpans: [],
            expectedForms: [],
            bound: key,
            consumed,
            message: `Source exceeds ${key}`,
          },
        ],
      };
  const analysis = analyzePel({
    program: parsed.value,
    snapshot: snapshot.value,
  });
  if (analysis.diagnostics.some((d) => d.severity === "error"))
    return {
      tag: "invalid",
      diagnostics: analysis.diagnostics.map((d) =>
        usage(d, parsed.value.expressions, snapshot.value),
      ),
    };
  const binding = createPlanBindingV1(source, snapshot.value);
  freezeTree(analysis);
  const normalizedAst = parsed.value.expressions.map(normalize);
  freezeTree(normalizedAst);
  const checked: CheckedProgramV1 = Object.freeze({
    source,
    sourceDigest: parsed.value.sourceDigest,
    program: parsed.value,
    normalizedAst,
    languageProfile: profile,
    snapshot: snapshot.value,
    binding,
    bindingDigest: sha256Hex(canonicalize(binding)),
    optionsDigest: snapshot.value.optionsDigest,
    analysis,
  });
  checkedPrograms.add(checked);
  return { tag: "ok", checked, warnings: analysis.diagnostics };
}
