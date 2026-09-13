import { createHash } from "node:crypto";
import type { PelNode, PelProgram, SourceSpan } from "./ast.js";
import type {
  ArgSpecV1,
  BoundArgumentV1,
  PelClosureValue,
  PelCounters,
  PelLimitsV1,
  PelRunOptionsV1,
  PelValue,
} from "./types.js";
import {
  diagnostic,
  type PelDiagnostic,
  type PelDiagnosticCode,
} from "./diagnostics.js";
import { normalizePelNode } from "./revision.js";
import { validateRunOptions, validateLimits } from "./runtime-validation.js";
import { validateContinuation } from "./continuation.js";
import {
  boundedJson,
  validEnvironmentTable,
  runtimeValidators,
} from "./host-arguments.js";
import { decodePelData, formatPel } from "./values.js";
import { DEFAULT_LIMITS } from "./profile.js";
import { builtinArgSpecs, callableList, pureBuiltin } from "./builtins.js";
import { planArguments } from "./arguments.js";
import { analyzeSequence } from "./dependencies.js";
import {
  createHostRegistry,
  getHostDescriptor,
  validateHostReceipt,
  verifyRegistry,
  type HostRegistryV1,
  type HostReceiptV1,
  type ReadyHostRequestV1,
} from "./host-contract.js";

export const DEFAULT_RUN_OPTIONS: PelRunOptionsV1 = Object.freeze({
  dependencyMode: "ordered",
  nlConditionProfile: null,
  nlConditionProfileDigest: null,
  replay: { mode: "none" as const },
});
export const neutralSpan: SourceSpan = {
  start: 0,
  end: 0,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
};
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
    )
    .join(",")}}`;
}
export function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
const nil: PelValue = { tag: "nil" };
type Cell = PelValue | { tag: "uninitialized"; cellId: string };
export interface EnvironmentRecord {
  id: string;
  parent?: string;
  bindings: Record<string, Cell>;
}
export interface PelEnvironmentV1 {
  registry: HostRegistryV1;
  initialBindings: Readonly<Record<string, PelValue>>;
  error?: PelDiagnostic;
}
export function createPelEnvironment(
  registry: HostRegistryV1,
  initialBindings: Readonly<Record<string, PelValue>> = {},
): PelEnvironmentV1 {
  const bindings: Record<string, PelValue> = Object.create(null) as Record<
    string,
    PelValue
  >;
  let error: PelDiagnostic | undefined;
  try {
    for (const [name, entry] of Object.entries(
      Object.getOwnPropertyDescriptors(initialBindings),
    )) {
      if (!("value" in entry)) {
        error = diagnostic(
          "PEL_REGISTRY",
          neutralSpan,
          "initial binding accessor is not data",
        );
        break;
      }
      const value = decodePelData(entry.value);
      if (!value.ok) {
        error = diagnostic(
          "PEL_REGISTRY",
          neutralSpan,
          "initial bindings must contain Pel data",
        );
        break;
      }
      bindings[name] = value.value;
    }
    const stack: object[] = [bindings];
    while (stack.length) {
      const v = stack.pop()!;
      for (const nested of Object.values(v))
        if (nested && typeof nested === "object") stack.push(nested as object);
      Object.freeze(v);
    }
  } catch {
    error = diagnostic(
      "PEL_REGISTRY",
      neutralSpan,
      "invalid initial binding table",
    );
  }
  return Object.freeze({
    registry,
    initialBindings: bindings,
    ...(error ? { error } : {}),
  });
}
type Operation =
  | { kind: "eval"; node: PelNode }
  | {
      kind: "collect";
      nodes: readonly PelNode[];
      children: string[];
      result: "list" | "call";
      head?: PelValue;
    }
  | { kind: "pair"; key: string; child: string }
  | { kind: "pipe"; right: PelNode; child: string }
  | {
      kind: "pipe-head";
      right: PelNode & { kind: "call" };
      child: string;
      input: PelValue;
    }
  | { kind: "pass"; child: string }
  | {
      kind: "bind";
      closure: PelClosureValue;
      plans: readonly {
        name: string;
        node: PelNode;
        evaluation: "strict" | "syntax";
      }[];
      index: number;
      bound: Record<string, BoundArgumentV1>;
      child?: string;
      fresh: boolean;
    }
  | {
      kind: "invoke";
      closure: PelClosureValue;
      bound: Record<string, BoundArgumentV1>;
      fresh: boolean;
    }
  | {
      kind: "define";
      name: string;
      environmentId: string;
      cellId: string;
      child: string;
    }
  | {
      kind: "lambda";
      defaultCaret?: PelValue;
      bodyCaret?: PelValue;
      params: ArgSpecV1;
      body: PelNode;
      capture: string;
      defaults: Record<string, PelValue>;
      index: number;
      child?: string;
    }
  | { kind: "if"; child: string; yes: BoundArgumentV1; no: BoundArgumentV1 }
  | { kind: "case-start"; child: string; body: BoundArgumentV1 }
  | {
      kind: "case";
      applied?: boolean;
      scrut: PelValue;
      nodes: readonly PelNode[];
      index: number;
      body: BoundArgumentV1;
      child?: string;
    }
  | {
      kind: "for-start";
      child: string;
      iterator: PelNode;
      body: BoundArgumentV1;
    }
  | {
      kind: "for";
      items: readonly PelValue[];
      index: number;
      name: string;
      body: BoundArgumentV1;
      values: PelValue[];
      child?: string;
    }
  | {
      kind: "block";
      nodes: readonly PelNode[];
      children: (string | null)[];
      dependencies: readonly (readonly number[])[];
      async: boolean;
    }
  | { kind: "host"; requestId: string };
export interface EvaluationTask {
  id: string;
  parentId?: string;
  op: Operation;
  environmentId: string;
  path: string;
  depth: number;
  caret?: PelValue;
  span: SourceSpan;
  nodeId: string;
  value?: PelValue;
}
export interface PelContinuationV1 {
  version: 1;
  sourceDigest: string;
  profileDigest: string;
  registryDigest: string;
  optionsDigest: string;
  program: PelProgram;
  registry: HostRegistryV1;
  options: PelRunOptionsV1;
  limits: PelLimitsV1;
  environments: Record<string, EnvironmentRecord>;
  tasks: Record<string, EvaluationTask>;
  root: string;
  runnable: string[];
  pending: Record<string, { request: ReadyHostRequestV1; taskId: string }>;
  completed: HostReceiptV1[];
  counters: PelCounters;
  nextId: number;
  mergedChildren: string[];
  failure?: PelDiagnostic;
  replayPhase: {
    phase: "prefix" | "execution";
    reductions: number;
    iterations: number;
    completed: number;
  };
}
export type PelStep =
  | { tag: "done"; value: PelValue; counters: PelCounters }
  | {
      tag: "suspend";
      ready: readonly [ReadyHostRequestV1, ...ReadyHostRequestV1[]];
      continuation: PelContinuationV1;
      counters: PelCounters;
    }
  | {
      tag: "failed";
      diagnostic: PelDiagnostic;
      continuation: PelContinuationV1;
      counters: PelCounters;
    };
function fail(
  s: PelContinuationV1,
  t: EvaluationTask,
  code: PelDiagnosticCode,
  message: string,
  extra: Partial<PelDiagnostic> = {},
): void {
  s.failure = diagnostic(code, t.span, message, extra);
}
function env(s: PelContinuationV1, parent?: string): string {
  const id = `e${s.nextId++}`;
  s.environments[id] = {
    id,
    bindings: Object.create(null) as Record<string, Cell>,
    ...(parent === undefined ? {} : { parent }),
  };
  return id;
}
function capture(s: PelContinuationV1, id: string): string {
  const result = env(s);
  const bindings = s.environments[result]!.bindings;
  let current: string | undefined = id;
  while (current !== undefined) {
    const record: EnvironmentRecord = s.environments[current]!;
    for (const [k, v] of Object.entries(record.bindings))
      if (!Object.hasOwn(bindings, k)) bindings[k] = v;
    current = record.parent;
  }
  return result;
}
function lookup(
  s: PelContinuationV1,
  id: string,
  name: string,
): Cell | undefined {
  let current: string | undefined = id;
  while (current !== undefined) {
    const record: EnvironmentRecord | undefined = s.environments[current];
    if (!record) return undefined;
    if (Object.hasOwn(record.bindings, name)) return record.bindings[name];
    current = record.parent;
  }
  return undefined;
}
function task(
  s: PelContinuationV1,
  node: PelNode,
  environmentId: string,
  path: string,
  depth: number,
  caret?: PelValue,
): string {
  const id = `t${s.nextId++}`;
  s.tasks[id] = {
    id,
    op: { kind: "eval", node },
    environmentId,
    path,
    depth,
    span: node.span,
    nodeId: node.nodeId,
    ...(caret === undefined ? {} : { caret }),
  };
  enqueue(s, id);
  return id;
}
function child(
  s: PelContinuationV1,
  t: EvaluationTask,
  node: PelNode,
  suffix: string,
  environmentId = t.environmentId,
  caret: PelValue | null = t.caret ?? null,
  depth = t.depth,
): string {
  const id = task(
    s,
    node,
    environmentId,
    `${t.path}/${suffix}`,
    depth,
    caret ?? undefined,
  );
  s.tasks[id]!.parentId = t.id;
  return id;
}
function syntaxChild(
  s: PelContinuationV1,
  t: EvaluationTask,
  arg: BoundArgumentV1,
  suffix: string,
  environmentId?: string,
  caret?: PelValue,
): string {
  if (arg.kind === "syntax")
    return child(
      s,
      t,
      arg.node,
      suffix,
      environmentId ?? arg.environmentId,
      caret ?? arg.caret ?? null,
    );
  const id = child(
    s,
    t,
    { kind: "nil", nodeId: t.nodeId, span: t.span },
    suffix,
  );
  s.tasks[id]!.value = arg.value;
  return id;
}
function result(s: PelContinuationV1, id: string): PelValue | undefined {
  return s.tasks[id]?.value;
}
function complete(
  s: PelContinuationV1,
  t: EvaluationTask,
  value: PelValue,
): void {
  const size = Buffer.byteLength(JSON.stringify(value));
  const retained = s.counters.valueBytesPeak + size;
  s.counters.valueBytesPeak = retained;
  if (retained > s.limits.maxValueBytes) {
    fail(s, t, "PEL_LIMIT", "value byte limit exceeded", {
      bound: "maxValueBytes",
      consumed: retained,
    });
    return;
  }
  t.value = value;
  if (t.parentId) enqueue(s, t.parentId);
}
function literal(node: PelNode): PelValue | undefined {
  switch (node.kind) {
    case "number":
    case "string":
    case "boolean":
      return { tag: node.kind, value: node.value } as PelValue;
    case "nil":
      return nil;
    case "key":
      return { tag: "key", name: node.name };
    default:
      return undefined;
  }
}
function quoted(node: PelNode): PelValue {
  const v = literal(node);
  if (v) return v;
  if (node.kind === "symbol") return { tag: "symbol", name: node.name };
  return { tag: "syntax", node };
}
function closure(
  t: EvaluationTask,
  s: PelContinuationV1,
  name: string,
  spec: ArgSpecV1,
  host = false,
): PelClosureValue {
  const defaults: Record<string, PelValue> = Object.create(null) as Record<
    string,
    PelValue
  >;
  if (spec.kind === "fixed")
    for (const p of spec.parameters) {
      if (p.defaultExpression) {
        const value = literal(p.defaultExpression);
        if (value) defaults[p.name] = value;
      }
    }
  return {
    tag: "closure",
    nodeId: t.nodeId,
    sourceDigest: s.sourceDigest,
    environmentId: t.environmentId,
    callable: host
      ? { kind: "host", registryId: name }
      : { kind: "builtin", name },
    argSpec: spec,
    boundArguments: {},
    defaults,
  };
}
function freeCaret(node: PelNode): boolean {
  switch (node.kind) {
    case "caret":
      return true;
    case "quote":
      return false;
    case "pipe":
      return freeCaret(node.left);
    case "pair":
      return freeCaret(node.value);
    case "list":
    case "call":
      return node.items.some(freeCaret);
    default:
      return false;
  }
}
function injected(
  node: PelNode,
  value: PelValue,
  t: EvaluationTask,
  s: PelContinuationV1,
): PelNode | undefined {
  if (node.kind === "pipe") {
    const left = injected(node.left, value, t, s);
    return left ? { ...node, left } : undefined;
  }
  if (node.kind !== "call") return undefined;
  const name = `@injected/${s.nextId++}`;
  s.environments[t.environmentId]!.bindings[name] = value;
  return {
    ...node,
    items: [
      node.items[0]!,
      {
        kind: "symbol",
        name,
        nodeId: `${node.nodeId}/injected`,
        span: node.span,
      },
      ...node.items.slice(1),
    ],
  };
}
function isCaseCall(
  s: PelContinuationV1,
  t: EvaluationTask,
  node: PelNode,
): boolean {
  if (node.kind !== "call") return false;
  const head = node.items[0];
  if (head?.kind !== "symbol") return false;
  const v = lookup(s, t.environmentId, head.name);
  return (
    v?.tag === "closure" &&
    v.callable.kind === "builtin" &&
    v.callable.name === "case"
  );
}
function pipeCaret(
  s: PelContinuationV1,
  t: EvaluationTask,
  node: PelNode,
): boolean {
  if (isCaseCall(s, t, node) && node.kind === "call") {
    const args = node.items.slice(1);
    return args.some((a, i) =>
      a.kind === "pair"
        ? a.key !== "body" && freeCaret(a.value)
        : i === 0 && freeCaret(a),
    );
  }
  if (node.kind === "quote") return false;
  if (node.kind === "pipe") return pipeCaret(s, t, node.left);
  if (node.kind === "call" || node.kind === "list")
    return node.items.some((n) => pipeCaret(s, t, n));
  if (node.kind === "pair") return pipeCaret(s, t, node.value);
  return node.kind === "caret";
}
function apply(
  s: PelContinuationV1,
  t: EvaluationTask,
  value: PelValue,
  nodes: readonly PelNode[],
): void {
  let c: PelClosureValue;
  if (value.tag === "list")
    c = {
      ...closure(t, s, "list", builtinArgSpecs.list!),
      callable: { kind: "list", items: value.items },
    };
  else if (value.tag === "closure") c = value;
  else {
    fail(s, t, "PEL_TYPE", "call head must be a closure or list");
    return;
  }
  if (c.argSpec.kind === "sequence") {
    const expressions =
      nodes.length === 1 && nodes[0]?.kind === "list" ? nodes[0].items : nodes;
    startBlock(
      s,
      t,
      expressions,
      true,
      c.callable.kind === "builtin" && c.callable.name === "do/async",
    );
    return;
  }
  const plans = planArguments(c, nodes, t.span);
  if (!plans.ok) {
    const name =
      c.callable.kind === "builtin"
        ? c.callable.name
        : c.callable.kind === "host"
          ? (getHostDescriptor(s.registry, c.callable.registryId)?.name ??
            c.callable.registryId)
          : c.callable.kind === "list"
            ? "list"
            : "lambda";
    const signature = `(${name} ${c.argSpec.parameters.map((p) => `:${p.name}${p.required ? "" : ` ${formatPel(c.defaults[p.name] ?? nil)}`}`).join(" ")})`;
    const example = `(${name} ${c.argSpec.parameters
      .filter((p) => p.required)
      .map((p) => `:${p.name} ${p.name === "vals" ? "[1 2]" : "1"}`)
      .join(" ")})`;
    s.failure = {
      ...plans.error,
      signature,
      expectedForms: ["positional arguments", "named arguments"],
      help: `Use one argument mode. Named example: ${example}`,
    };
    return;
  }
  t.op = {
    kind: "bind",
    closure: c,
    plans: plans.value,
    index: 0,
    bound: Object.assign(Object.create(null), c.boundArguments) as Record<
      string,
      BoundArgumentV1
    >,
    fresh: Object.keys(c.boundArguments).length === 0,
  };
}
function startBlock(
  s: PelContinuationV1,
  t: EvaluationTask,
  nodes: readonly PelNode[],
  newScope: boolean,
  async: boolean,
): void {
  if (newScope) t.environmentId = env(s, t.environmentId);
  const analysis = analyzeSequence(nodes);
  if (async && analysis.cycles.length) {
    fail(s, t, "PEL_DEPENDENCY_CYCLE", "binding dependency cycle");
    return;
  }
  t.op = {
    kind: "block",
    nodes,
    children: nodes.map(() => null),
    dependencies: analysis.expressions.map((e) => e.dependencies),
    async,
  };
}
function charge(
  s: PelContinuationV1,
  t: EvaluationTask,
  kind: "reductions" | "iterations",
): boolean {
  if (
    s.replayPhase.phase === "prefix" &&
    s.options.replay.mode === "completed-prefix"
  ) {
    if (s.replayPhase[kind] >= s.options.replay.maxReplayReductions) {
      fail(s, t, "PEL_LIMIT", "completed prefix replay limit exceeded", {
        bound: "maxReplayReductions",
        consumed: s.replayPhase[kind],
      });
      return false;
    }
    s.replayPhase[kind]++;
    return true;
  }
  const bound = kind === "reductions" ? "maxReductions" : "maxIterations";
  if (s.counters[kind] >= s.limits[bound]) {
    fail(s, t, "PEL_LIMIT", `${bound} exceeded`, {
      bound,
      consumed: s.counters[kind],
    });
    return false;
  }
  s.counters[kind]++;
  return true;
}
function advance(s: PelContinuationV1, t: EvaluationTask): boolean {
  const op = t.op;
  if (t.value !== undefined) return false;
  switch (op.kind) {
    case "eval": {
      if (!charge(s, t, "reductions")) return true;
      const n = op.node;
      const v = literal(n);
      if (v) {
        complete(s, t, v);
        return true;
      }
      switch (n.kind) {
        case "symbol": {
          const found = lookup(s, t.environmentId, n.name);
          if (!found)
            fail(s, t, "PEL_UNBOUND_SYMBOL", `unbound symbol ${n.name}`);
          else if (found.tag === "uninitialized")
            fail(
              s,
              t,
              "PEL_UNINITIALIZED_BINDING",
              `binding ${n.name} is not initialized`,
            );
          else complete(s, t, found);
          break;
        }
        case "caret":
          if (t.caret === undefined)
            fail(
              s,
              t,
              "PEL_CARET_SCOPE",
              "caret has no enclosing pipe or case condition",
            );
          else complete(s, t, t.caret);
          break;
        case "quote":
          complete(s, t, quoted(n.expression));
          break;
        case "pair":
          t.op = {
            kind: "pair",
            key: n.key,
            child: child(s, t, n.value, "pair"),
          };
          break;
        case "pipe":
          t.op = {
            kind: "pipe",
            right: n.right,
            child: child(s, t, n.left, "pipe-left"),
          };
          break;
        case "list":
          t.op = {
            kind: "collect",
            nodes: n.items,
            children: [],
            result: "list",
          };
          break;
        case "call":
          if (!n.items.length) complete(s, t, nil);
          else
            t.op = {
              kind: "collect",
              nodes: n.items,
              children: [],
              result: "call",
            };
          break;
        default:
          break;
      }
      return true;
    }
    case "pair": {
      const v = result(s, op.child);
      if (v === undefined) return false;
      complete(s, t, { tag: "pair", key: op.key, value: v });
      return true;
    }
    case "pass": {
      const v = result(s, op.child);
      if (v === undefined) return false;
      complete(s, t, v);
      return true;
    }
    case "pipe": {
      const v = result(s, op.child);
      if (v === undefined) return false;
      if (op.right.kind === "call" && op.right.items.length) {
        t.op = {
          kind: "pipe-head",
          right: op.right as PelNode & { kind: "call" },
          input: v,
          child: child(
            s,
            t,
            op.right.items[0]!,
            "pipe-head",
            t.environmentId,
            v,
          ),
        };
        return true;
      }
      const right = pipeCaret(s, t, op.right)
        ? op.right
        : injected(op.right, v, t, s);
      if (!right) fail(s, t, "PEL_TYPE", "pipe without caret requires a call");
      else
        t.op = {
          kind: "pass",
          child: child(s, t, right, "pipe-right", t.environmentId, v),
        };
      return true;
    }
    case "pipe-head": {
      const head = result(s, op.child);
      if (head === undefined) return false;
      const args = op.right.items.slice(1);
      const isCase =
        head.tag === "closure" &&
        head.callable.kind === "builtin" &&
        head.callable.name === "case";
      const hasCaret = isCase
        ? args.some((n, i) =>
            n.kind === "pair"
              ? n.key !== "body" && freeCaret(n.value)
              : args.length > 1 && i === 0 && freeCaret(n),
          )
        : args.some((n) => pipeCaret(s, t, n));
      t.caret = op.input;
      let supplied = args;
      if (!hasCaret) {
        const n = injected(op.right, op.input, t, s)!;
        supplied = n.kind === "call" ? n.items.slice(1) : args;
      }
      apply(s, t, head, supplied);
      return true;
    }
    case "collect": {
      if (op.result === "call") {
        if (!op.children.length) {
          op.children.push(child(s, t, op.nodes[0]!, "head"));
          return true;
        }
        const head = result(s, op.children[0]!);
        if (head === undefined) return false;
        apply(s, t, head, op.nodes.slice(1));
        return true;
      }
      if (op.children.some((id) => result(s, id) === undefined)) return false;
      if (op.children.length < op.nodes.length) {
        op.children.push(
          child(
            s,
            t,
            op.nodes[op.children.length]!,
            `item/${op.children.length}`,
          ),
        );
        return true;
      }
      complete(s, t, {
        tag: "list",
        items: op.children.map((id) => result(s, id)!),
      });
      return true;
    }
    case "bind": {
      if (op.child !== undefined) {
        const value = result(s, op.child);
        if (value === undefined) return false;
        op.bound[op.plans[op.index]!.name] = { kind: "value", value };
        delete op.child;
        op.index++;
      }
      const p = op.plans[op.index];
      if (p) {
        if (p.evaluation === "syntax") {
          op.bound[p.name] = {
            kind: "syntax",
            node: p.node,
            environmentId: t.environmentId,
            ...(t.caret === undefined ? {} : { caret: t.caret }),
          };
          op.index++;
        } else op.child = child(s, t, p.node, `arg/${p.name}`);
        return true;
      }
      t.op = {
        kind: "invoke",
        closure: op.closure,
        bound: op.bound,
        fresh: op.fresh,
      };
      return true;
    }
    case "invoke":
      invoke(s, t, op.closure, op.bound, op.fresh);
      return true;
    case "define": {
      const v = result(s, op.child);
      if (v === undefined) return false;
      for (const e of Object.values(s.environments))
        for (const [k, c] of Object.entries(e.bindings))
          if (c.tag === "uninitialized" && c.cellId === op.cellId)
            e.bindings[k] = v;
      complete(s, t, v);
      return true;
    }
    case "lambda": {
      if (op.child) {
        const v = result(s, op.child);
        if (v === undefined) return false;
        const params = op.params.kind === "fixed" ? op.params.parameters : [];
        op.defaults[params[op.index]!.name] = v;
        delete op.child;
        op.index++;
      }
      const params = op.params.kind === "fixed" ? op.params.parameters : [];
      while (op.index < params.length && !params[op.index]!.defaultExpression)
        op.index++;
      const p = params[op.index];
      if (p?.defaultExpression) {
        op.child = child(
          s,
          t,
          p.defaultExpression,
          `default/${p.name}`,
          op.capture,
          op.defaultCaret ?? null,
        );
        return true;
      }
      complete(s, t, {
        tag: "closure",
        nodeId: t.nodeId,
        sourceDigest: s.sourceDigest,
        environmentId: op.capture,
        callable: { kind: "user", body: op.body },
        argSpec: op.params,
        boundArguments: {},
        defaults: op.defaults,
        ...(op.bodyCaret === undefined ? {} : { caret: op.bodyCaret }),
      });
      return true;
    }
    case "if": {
      const v = result(s, op.child);
      if (v === undefined) return false;
      if (v.tag !== "boolean")
        fail(s, t, "PEL_TYPE", "if condition must be Boolean");
      else
        t.op = {
          kind: "pass",
          child: syntaxChild(s, t, v.value ? op.yes : op.no, "branch"),
        };
      return true;
    }
    case "case-start": {
      const v = result(s, op.child);
      if (v === undefined) return false;
      if (
        op.body.kind !== "syntax" ||
        op.body.node.kind !== "list" ||
        op.body.node.items.length % 2 !== 0
      )
        fail(
          s,
          t,
          "PEL_TYPE",
          "case body must contain condition/consequence pairs",
        );
      else
        t.op = {
          kind: "case",
          scrut: v,
          nodes: op.body.node.items,
          index: 0,
          body: op.body,
        };
      return true;
    }
    case "case":
      return advanceCase(s, t, op);
    case "for-start": {
      const v = result(s, op.child);
      if (v === undefined) return false;
      if (v.tag !== "list" || op.iterator.kind !== "symbol")
        fail(s, t, "PEL_TYPE", "for requires a list and binder symbol");
      else
        t.op = {
          kind: "for",
          items: v.items,
          index: 0,
          name: op.iterator.name,
          body: op.body,
          values: [],
        };
      return true;
    }
    case "for": {
      if (op.child) {
        const v = result(s, op.child);
        if (v === undefined) return false;
        op.values.push(v);
        delete op.child;
        op.index++;
      }
      if (op.index === op.items.length) {
        complete(s, t, { tag: "list", items: op.values });
        return true;
      }
      if (!charge(s, t, "iterations")) return true;
      const id = env(
        s,
        op.body.kind === "syntax" ? op.body.environmentId : t.environmentId,
      );
      s.environments[id]!.bindings[op.name] = op.items[op.index]!;
      op.child = syntaxChild(s, t, op.body, `iteration/${op.index}`, id);
      return true;
    }
    case "block": {
      if (
        t.id === s.root &&
        s.replayPhase.phase === "prefix" &&
        s.options.replay.mode === "completed-prefix"
      ) {
        const replay = s.options.replay;
        const count = replay.completedPrefixCount;
        if (
          op.children
            .slice(0, count)
            .every((id) => id !== null && result(s, id) !== undefined)
        ) {
          if (
            s.replayPhase.reductions !== replay.recordedCounters.reductions ||
            s.replayPhase.iterations !== replay.recordedCounters.iterations
          ) {
            fail(
              s,
              t,
              "PEL_CONTINUATION_MISMATCH",
              "completed prefix counters do not match recorded trace",
            );
            return true;
          }
          s.counters.reductions = replay.committedCounters.reductions;
          s.counters.iterations = replay.committedCounters.iterations;
          for (const k of [
            "syntaxDepthPeak",
            "callDepthPeak",
            "valueBytesPeak",
          ] as const)
            s.counters[k] = Math.max(
              s.counters[k],
              replay.committedCounters[k],
            );
          s.replayPhase.phase = "execution";
          s.replayPhase.completed = count;
        }
      }
      let changed = false;
      for (let i = 0; i < op.nodes.length; i++) {
        if (op.children[i] !== null) continue;
        if (
          t.id === s.root &&
          s.replayPhase.phase === "prefix" &&
          s.options.replay.mode === "completed-prefix" &&
          i >= s.options.replay.completedPrefixCount
        )
          continue;
        const dependencies =
          op.async && s.replayPhase.phase !== "prefix"
            ? op.dependencies[i]!
            : i
              ? [i - 1]
              : [];
        if (
          dependencies.some(
            (j) =>
              op.children[j] === null ||
              result(s, op.children[j]!) === undefined,
          )
        )
          continue;
        op.children[i] = child(s, t, op.nodes[i]!, `expression/${i}`);
        changed = true;
        if (!op.async) break;
      }
      if (
        op.children.every((id) => id !== null && result(s, id) !== undefined)
      ) {
        complete(
          s,
          t,
          op.children.length ? result(s, op.children.at(-1)!)! : nil,
        );
        return true;
      }
      return changed;
    }
    case "host":
      return false;
  }
}
function invoke(
  s: PelContinuationV1,
  t: EvaluationTask,
  c: PelClosureValue,
  bound: Record<string, BoundArgumentV1>,
  fresh: boolean,
): void {
  if (c.argSpec.kind !== "fixed") {
    fail(s, t, "PEL_TYPE", "invalid fixed call");
    return;
  }
  const plusList =
    fresh &&
    c.callable.kind === "builtin" &&
    c.callable.name === "+" &&
    bound.x?.kind === "value" &&
    bound.x.value.tag === "list" &&
    !bound.y;
  if (
    !plusList &&
    c.argSpec.parameters.some(
      (p) => p.required && !Object.hasOwn(bound, p.name),
    )
  ) {
    complete(s, t, { ...c, boundArguments: bound });
    return;
  }
  for (const p of c.argSpec.parameters)
    if (!Object.hasOwn(bound, p.name) && !p.required) {
      if (p.evaluation === "syntax" && p.defaultExpression)
        bound[p.name] = {
          kind: "syntax",
          node: p.defaultExpression,
          environmentId: c.environmentId,
        };
      else bound[p.name] = { kind: "value", value: c.defaults[p.name] ?? nil };
    }
  const values: Record<string, PelValue> = Object.create(null) as Record<
    string,
    PelValue
  >;
  for (const [k, v] of Object.entries(bound))
    if (v.kind === "value") values[k] = v.value;
  if (c.callable.kind === "user") {
    if (t.depth >= s.limits.maxCallDepth) {
      fail(s, t, "PEL_LIMIT", "call depth limit exceeded", {
        bound: "maxCallDepth",
        consumed: t.depth,
      });
      return;
    }
    const id = env(s, c.environmentId);
    Object.assign(s.environments[id]!.bindings, values);
    s.counters.callDepthPeak = Math.max(s.counters.callDepthPeak, t.depth + 1);
    t.op = {
      kind: "pass",
      child: child(
        s,
        t,
        c.callable.body,
        "call",
        id,
        c.caret ?? null,
        t.depth + 1,
      ),
    };
    return;
  }
  if (c.callable.kind === "host") {
    emitHost(s, t, c.callable.registryId, values);
    return;
  }
  if (c.callable.kind === "list") {
    const r = callableList(c.callable.items, values, t.span);
    if (r.ok) complete(s, t, r.value);
    else s.failure = r.error;
    return;
  }
  const name = c.callable.name;
  if (name === "def") {
    const n = bound.name!;
    const v = bound.value!;
    if (n.kind !== "syntax" || n.node.kind !== "symbol") {
      fail(s, t, "PEL_TYPE", "def name must be a symbol");
      return;
    }
    const target = s.environments[n.environmentId]!;
    if (Object.hasOwn(target.bindings, n.node.name)) {
      fail(
        s,
        t,
        "PEL_DUPLICATE_BINDING",
        `binding ${n.node.name} already exists`,
      );
      return;
    }
    const cellId = `cell/${s.nextId++}`;
    target.bindings[n.node.name] = { tag: "uninitialized", cellId };
    t.op = {
      kind: "define",
      name: n.node.name,
      environmentId: n.environmentId,
      cellId,
      child: syntaxChild(s, t, v, "definition", n.environmentId),
    };
    return;
  }
  if (name === "lambda") {
    const params = bound.params!;
    const body = bound.body!;
    if (
      params.kind !== "syntax" ||
      params.node.kind !== "list" ||
      body.kind !== "syntax"
    ) {
      fail(s, t, "PEL_TYPE", "lambda requires an ArgSpec list and body syntax");
      return;
    }
    const parameters = [];
    const names = new Set<string>();
    for (const p of params.node.items) {
      if (p.kind !== "pair" || names.has(p.key)) {
        fail(
          s,
          t,
          "PEL_ARGUMENT_NAME",
          "lambda parameters must be unique keys",
        );
        return;
      }
      names.add(p.key);
      parameters.push({
        name: p.key,
        required: !p.valuePresent,
        evaluation: "strict" as const,
        ...(p.valuePresent ? { defaultExpression: p.value } : {}),
      });
    }
    t.op = {
      kind: "lambda",
      params: { kind: "fixed", parameters },
      body: body.node,
      capture: capture(s, params.environmentId),
      ...(params.caret === undefined ? {} : { defaultCaret: params.caret }),
      ...(body.caret === undefined ? {} : { bodyCaret: body.caret }),
      defaults: Object.create(null) as Record<string, PelValue>,
      index: 0,
    };
    return;
  }
  if (name === "if") {
    t.op = {
      kind: "if",
      child: syntaxChild(s, t, bound.cond!, "condition"),
      yes: bound.then!,
      no: bound.else!,
    };
    return;
  }
  if (name === "case") {
    t.op = {
      kind: "case-start",
      child: syntaxChild(s, t, bound.scrut!, "scrutinee"),
      body: bound.body!,
    };
    return;
  }
  if (name === "for") {
    const iterator = bound.iterator!;
    if (iterator.kind !== "syntax") {
      fail(s, t, "PEL_TYPE", "for iterator must be syntax");
      return;
    }
    t.op = {
      kind: "for-start",
      child: syntaxChild(s, t, bound.coll!, "collection"),
      iterator: iterator.node,
      body: bound.body!,
    };
    return;
  }
  const r = pureBuiltin(name, values, t.span);
  if (r.ok) complete(s, t, r.value);
  else s.failure = r.error;
}
function advanceCase(
  s: PelContinuationV1,
  t: EvaluationTask,
  op: Extract<Operation, { kind: "case" }>,
): boolean {
  if (op.child) {
    const v = result(s, op.child);
    if (v === undefined) return false;
    if (v.tag === "closure") {
      if (op.applied) {
        fail(s, t, "PEL_TYPE", "case closure result must be Boolean");
        return true;
      }
      op.applied = true;
      const id = child(
        s,
        t,
        { kind: "nil", span: t.span, nodeId: t.nodeId },
        `condition-call/${op.index}`,
      );
      const next = s.tasks[id]!;
      const n = injected(
        {
          kind: "call",
          span: t.span,
          nodeId: t.nodeId,
          items: [{ kind: "nil", span: t.span, nodeId: t.nodeId }],
        },
        op.scrut,
        next,
        s,
      )!;
      apply(s, next, v, n.kind === "call" ? n.items.slice(1) : []);
      op.child = id;
      return true;
    }
    if (v.tag !== "boolean") {
      fail(s, t, "PEL_TYPE", "case condition must produce Boolean");
      return true;
    }
    delete op.child;
    if (v.value) {
      const node = op.nodes[op.index + 1]!;
      const body = op.body;
      t.op = {
        kind: "pass",
        child: child(
          s,
          t,
          node,
          `consequence/${op.index}`,
          body.kind === "syntax" ? body.environmentId : t.environmentId,
          body.kind === "syntax" ? body.caret : t.caret,
        ),
      };
      return true;
    }
    delete op.applied;
    op.index += 2;
  }
  const n = op.nodes[op.index];
  if (!n) {
    complete(s, t, nil);
    return true;
  }
  const id = child(
    s,
    t,
    n,
    `condition/${op.index}`,
    op.body.kind === "syntax" ? op.body.environmentId : t.environmentId,
    op.scrut,
  );
  op.child = id;
  const ct = s.tasks[id]!;
  if (n.kind === "string") {
    if (!s.options.nlConditionProfile) {
      fail(
        s,
        t,
        "PEL_REGISTRY",
        "literal case condition requires an admitted predicate selection",
      );
      return true;
    }
    emitHost(s, ct, "pel/nl-condition", {
      scrut: op.scrut,
      condition: { tag: "string", value: n.value },
    });
    return true;
  }
  if (!freeCaret(n) && (n.kind === "call" || n.kind === "pipe")) {
    const injectedNode = injected(n, op.scrut, ct, s);
    if (injectedNode) ct.op = { kind: "eval", node: injectedNode };
  }
  return true;
}
function emitHost(
  s: PelContinuationV1,
  t: EvaluationTask,
  registryId: string,
  boundArguments: Record<string, PelValue>,
): void {
  const descriptor = getHostDescriptor(s.registry, registryId);
  if (!descriptor) {
    fail(s, t, "PEL_REGISTRY", "host descriptor is absent");
    return;
  }
  const size = Buffer.byteLength(JSON.stringify(boundArguments));
  if (size > s.limits.maxValueBytes) {
    fail(s, t, "PEL_LIMIT", "host arguments exceed value limit", {
      bound: "maxValueBytes",
      consumed: size,
    });
    return;
  }
  const requestId = digest({
    sourceDigest: s.sourceDigest,
    registryDigest: s.registryDigest,
    nodeId: t.nodeId,
    invocationPath: t.path,
  });
  const request: ReadyHostRequestV1 = {
    requestId,
    sourceDigest: s.sourceDigest,
    nodeId: t.nodeId,
    invocationOrdinal: s.completed.length + Object.keys(s.pending).length,
    invocationPath: t.path,
    registryId,
    boundArguments: { ...boundArguments },
    expectedResultSchemaId: descriptor.resultSchemaId,
    alreadyEmitted: false,
    ...(s.replayPhase.phase === "prefix" ? { replayOnly: true as const } : {}),
    ...(registryId === "pel/nl-condition" && s.options.nlConditionProfile
      ? {
          selection: s.options.nlConditionProfile,
          selectionDigest: s.options.nlConditionProfileDigest!,
        }
      : {}),
  };
  s.pending[requestId] = { request, taskId: t.id };
  t.op = { kind: "host", requestId };
}
const queueSets = new WeakMap<PelContinuationV1, Set<string>>();
function enqueue(s: PelContinuationV1, id: string): void {
  let set = queueSets.get(s);
  if (!set) {
    set = new Set(s.runnable);
    queueSets.set(s, set);
  }
  if (!set.has(id)) {
    set.add(id);
    s.runnable.push(id);
  }
}
function drive(s: PelContinuationV1): PelStep {
  let cursor = 0;
  while (cursor < s.runnable.length && !s.failure) {
    const id = s.runnable[cursor++]!;
    queueSets.get(s)?.delete(id);
    const t = s.tasks[id]!;
    if (advance(s, t) && t.value === undefined && t.op.kind !== "host")
      enqueue(s, id);
  }
  s.runnable = s.runnable.slice(cursor);
  queueSets.delete(s);
  if (s.failure)
    return {
      tag: "failed",
      diagnostic: s.failure,
      continuation: s,
      counters: { ...s.counters },
    };
  const value = result(s, s.root);
  if (value !== undefined)
    return { tag: "done", value, counters: { ...s.counters } };
  const ready = Object.values(s.pending).map((p) => ({ ...p.request }));
  for (const p of Object.values(s.pending))
    p.request = { ...p.request, alreadyEmitted: true };
  if (ready.length)
    return {
      tag: "suspend",
      ready: ready as [ReadyHostRequestV1, ...ReadyHostRequestV1[]],
      continuation: s,
      counters: { ...s.counters },
    };
  s.failure = diagnostic(
    "PEL_DEPENDENCY_CYCLE",
    neutralSpan,
    "evaluation has no ready work",
  );
  return {
    tag: "failed",
    diagnostic: s.failure,
    continuation: s,
    counters: { ...s.counters },
  };
}
export function startPel(
  program: PelProgram,
  environment: PelEnvironmentV1,
  limits: PelLimitsV1 = DEFAULT_LIMITS,
  options: PelRunOptionsV1 = DEFAULT_RUN_OPTIONS,
): PelStep {
  const admittedOptions = validateRunOptions(options);
  const admittedLimits = validateLimits(limits);
  let inputError =
    environment.error ??
    (!admittedOptions.ok
      ? admittedOptions.error
      : !admittedLimits.ok
        ? admittedLimits.error
        : undefined);
  options = admittedOptions.ok ? admittedOptions.value : DEFAULT_RUN_OPTIONS;
  limits = admittedLimits.ok ? admittedLimits.value : DEFAULT_LIMITS;
  if (!verifyRegistry(environment.registry)) {
    inputError = diagnostic(
      "PEL_REGISTRY",
      neutralSpan,
      "invalid host registry",
    );
    const fallback = createHostRegistry();
    if (!fallback.ok) throw Error("builtin registry invariant");
    environment = { registry: fallback.value, initialBindings: {} };
  }
  const s: PelContinuationV1 = {
    version: 1,
    sourceDigest: program.sourceDigest,
    profileDigest: program.profileDigest,
    registryDigest: environment.registry.digest,
    optionsDigest: digest(options),
    program,
    registry: environment.registry,
    options,
    limits,
    environments: {},
    tasks: {},
    root: "",
    runnable: [],
    pending: {},
    completed: [],
    counters: {
      sourceBytes: program.sourceBytes,
      tokens: program.tokens,
      astNodes: program.astNodes,
      syntaxDepthPeak: program.syntaxDepthPeak,
      reductions: 0,
      iterations: 0,
      callDepthPeak: 0,
      valueBytesPeak: 0,
    },
    nextId: 0,
    mergedChildren: [],
    replayPhase: {
      phase:
        options.replay.mode === "completed-prefix" ? "prefix" : "execution",
      reductions: 0,
      iterations: 0,
      completed: 0,
    },
  };
  const rootEnv = env(s);
  const rootNode: PelNode = {
    kind: "nil",
    nodeId: `${program.sourceDigest}:root`,
    span: program.expressions[0]?.span ?? neutralSpan,
  };
  s.root = task(s, rootNode, rootEnv, "root", 0);
  const t = s.tasks[s.root]!;
  if (inputError) {
    s.failure = inputError;
    return drive(s);
  }
  if (!verifyRegistry(environment.registry))
    fail(s, t, "PEL_REGISTRY", "host registry integrity check failed");
  for (const [name, spec] of Object.entries(builtinArgSpecs))
    if (!["list", "print", "pel/nl-condition"].includes(name))
      s.environments[rootEnv]!.bindings[name] = closure(t, s, name, spec);
  for (const descriptor of environment.registry.descriptors)
    s.environments[rootEnv]!.bindings[descriptor.name] = closure(
      t,
      s,
      descriptor.id,
      descriptor.argSpec,
      true,
    );
  const userEnv = env(s, rootEnv);
  t.environmentId = userEnv;
  for (const [name, value] of Object.entries(environment.initialBindings)) {
    if (lookup(s, rootEnv, name) !== undefined)
      fail(
        s,
        t,
        "PEL_REGISTRY",
        `initial binding replaces reserved name ${name}`,
      );
    else {
      const data = decodePelData(value);
      if (!data.ok)
        fail(
          s,
          t,
          "PEL_REGISTRY",
          "initial bindings must contain Pel data only",
        );
      else {
        s.environments[userEnv]!.bindings[name] = data.value;
        s.counters.valueBytesPeak += Buffer.byteLength(
          JSON.stringify(data.value),
        );
      }
    }
  }
  for (const [name, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 0)
      fail(s, t, "PEL_LIMIT", `invalid finite bound ${name}`);
  for (const [counter, bound] of [
    ["sourceBytes", "maxSourceBytes"],
    ["tokens", "maxTokens"],
    ["astNodes", "maxAstNodes"],
    ["syntaxDepthPeak", "maxSyntaxDepth"],
  ] as const)
    if (s.counters[counter] > limits[bound])
      fail(s, t, "PEL_LIMIT", `${bound} exceeded`, {
        bound,
        consumed: s.counters[counter],
      });
  if (
    options.nlConditionProfile === null
      ? options.nlConditionProfileDigest !== null
      : digest(options.nlConditionProfile) !==
          options.nlConditionProfileDigest ||
        options.nlConditionProfile.outputSchemaId !== "schema:pel-boolean-v1"
  )
    fail(
      s,
      t,
      "PEL_REGISTRY",
      "predicate selection digest or Boolean schema is invalid",
    );
  if (options.replay.mode === "completed-prefix") {
    const replay = options.replay;
    const count = replay.completedPrefixCount;
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > program.expressions.length ||
      digest(program.expressions.slice(0, count).map(normalizePelNode)) !==
        replay.prefixDigest ||
      !Number.isSafeInteger(replay.maxReplayReductions) ||
      replay.maxReplayReductions < 0
    )
      fail(
        s,
        t,
        "PEL_CONTINUATION_MISMATCH",
        "invalid completed prefix replay binding",
      );
    for (const [k, v] of Object.entries(replay.recordedCounters))
      if (
        !Number.isSafeInteger(v) ||
        v < 0 ||
        !Number.isSafeInteger(
          replay.committedCounters[k as keyof PelCounters],
        ) ||
        replay.committedCounters[k as keyof PelCounters] < v
      )
        fail(
          s,
          t,
          "PEL_CONTINUATION_MISMATCH",
          "committed counters cannot be below the recorded prefix",
        );
    for (const [counter, bound] of [
      ["reductions", "maxReductions"],
      ["iterations", "maxIterations"],
      ["callDepthPeak", "maxCallDepth"],
      ["valueBytesPeak", "maxValueBytes"],
    ] as const)
      if (replay.committedCounters[counter] > limits[bound])
        fail(
          s,
          t,
          "PEL_LIMIT",
          "committed consumption exceeds admitted bounds",
          { bound, consumed: replay.committedCounters[counter] },
        );
  }
  startBlock(
    s,
    t,
    program.expressions,
    false,
    options.dependencyMode === "automatic",
  );
  return drive(s);
}
export function resumePel(
  program: PelProgram,
  registry: HostRegistryV1,
  continuation: PelContinuationV1,
  receipts: readonly HostReceiptV1[],
  options: PelRunOptionsV1 = DEFAULT_RUN_OPTIONS,
): PelStep {
  const admitted = validateRunOptions(options);
  const reject = (error: PelDiagnostic): PelStep =>
    startPel(
      program,
      { registry, initialBindings: {}, error },
      DEFAULT_LIMITS,
      admitted.ok ? admitted.value : DEFAULT_RUN_OPTIONS,
    );
  if (!admitted.ok)
    return reject(
      diagnostic(
        "PEL_CONTINUATION_MISMATCH",
        neutralSpan,
        "invalid resume options",
      ),
    );
  if (!verifyRegistry(registry))
    return reject(
      diagnostic("PEL_REGISTRY", neutralSpan, "invalid resume registry"),
    );
  options = admitted.value;
  const checked = validateContinuation(continuation, {
    sourceDigest: program.sourceDigest,
    profileDigest: program.profileDigest,
    registryDigest: registry.digest,
    optionsDigest: digest(options),
  });
  if (!checked.ok) return reject(checked.error);
  if (canonical(checked.value.program) !== canonical(program))
    return reject(
      diagnostic(
        "PEL_CONTINUATION_MISMATCH",
        neutralSpan,
        "continuation program differs from the supplied source AST",
      ),
    );
  const s = structuredClone(checked.value);
  const t = s.tasks[s.root]!;
  s.registry = registry;
  const seen = new Set<string>();
  const validatedReceipts: HostReceiptV1[] = [];
  if (!Array.isArray(receipts)) {
    fail(s, t, "PEL_HOST_RESULT", "receipts must be an array");
    return drive(s);
  }
  for (const receipt of receipts) {
    let id: unknown;
    try {
      id =
        receipt !== null && typeof receipt === "object"
          ? Object.getOwnPropertyDescriptor(receipt, "requestId")?.value
          : undefined;
    } catch {
      id = undefined;
    }
    if (typeof id !== "string") {
      fail(s, t, "PEL_HOST_RESULT", "receipt identity must be a data string");
      return drive(s);
    }
    const pending = s.pending[id];
    if (!pending || seen.has(receipt.requestId)) {
      fail(s, t, "PEL_HOST_RESULT", "unknown, duplicate or completed receipt");
      return drive(s);
    }
    seen.add(receipt.requestId);
    const validated = validateHostReceipt(registry, pending.request, receipt);
    if (!validated.ok) {
      s.failure = validated.error;
      return drive(s);
    }
    validatedReceipts.push(validated.value);
  }
  for (const receipt of validatedReceipts) {
    const p = s.pending[receipt.requestId]!;
    delete s.pending[receipt.requestId];
    s.completed.push(receipt);
    const target = s.tasks[p.taskId]!;
    if (receipt.outcome.tag === "failure") {
      fail(s, target, "PEL_HOST_FAILURE", receipt.outcome.failure.message, {
        hostFailure: receipt.outcome.failure,
      });
    } else complete(s, target, receipt.outcome.value);
  }
  return drive(s);
}

export interface ClosureEnvironmentTableV1 {
  sourceDigest: string;
  registryDigest: string;
  optionsDigest: string;
  records: Readonly<Record<string, EnvironmentRecord>>;
}
export interface ClosureEvaluationContextV1 {
  program: PelProgram;
  registry: HostRegistryV1;
  sourceDigest: string;
  profileDigest: string;
  registryDigest: string;
  parentRequestId: string;
  childInvocationId: string;
  environmentTable: ClosureEnvironmentTableV1;
  limits: PelLimitsV1;
  options: PelRunOptionsV1;
  optionsDigest: string;
}
export function extractClosureEnvironment(
  parent: PelContinuationV1,
  c: PelClosureValue,
): import("./types.js").Result<ClosureEnvironmentTableV1, PelDiagnostic> {
  if (
    c.sourceDigest !== parent.sourceDigest ||
    !Object.hasOwn(parent.environments, c.environmentId)
  )
    return {
      ok: false,
      error: diagnostic(
        "PEL_CONTINUATION_MISMATCH",
        neutralSpan,
        "closure environment is inaccessible",
      ),
    };
  const wanted = digest(c);
  const pendingValues: unknown[] = [
    parent.pending,
    parent.tasks,
    parent.environments,
  ];
  const checked = new Set<object>();
  let referenced = false;
  while (pendingValues.length) {
    const value = pendingValues.pop();
    if (!value || typeof value !== "object" || checked.has(value)) continue;
    checked.add(value);
    if (
      (value as { tag?: string }).tag === "closure" &&
      digest(value) === wanted
    ) {
      referenced = true;
      break;
    }
    pendingValues.push(...Object.values(value));
  }
  if (!referenced)
    return {
      ok: false,
      error: diagnostic(
        "PEL_CONTINUATION_MISMATCH",
        neutralSpan,
        "closure is not referenced by this parent",
      ),
    };
  const records: Record<string, EnvironmentRecord> = {};
  const queue = [c.environmentId];
  const seenValues = new Set<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object" || seenValues.has(value))
      return;
    seenValues.add(value);
    const v = value as Record<string, unknown>;
    if (
      (v.tag === "closure" || v.kind === "syntax") &&
      typeof v.environmentId === "string"
    )
      queue.push(v.environmentId);
    for (const childValue of Object.values(v)) visit(childValue);
  };
  visit(c);
  while (queue.length) {
    const id = queue.pop()!;
    if (Object.hasOwn(records, id)) continue;
    const record = parent.environments[id];
    if (!record)
      return {
        ok: false,
        error: diagnostic(
          "PEL_CONTINUATION_MISMATCH",
          neutralSpan,
          "closure references an absent environment",
        ),
      };
    records[id] = record;
    if (record.parent) queue.push(record.parent);
    visit(record.bindings);
  }
  return {
    ok: true,
    value: {
      sourceDigest: parent.sourceDigest,
      registryDigest: parent.registryDigest,
      optionsDigest: parent.optionsDigest,
      records: structuredClone(records),
    },
  };
}
function childIdentity(parentId: string, invocationId: string): boolean {
  const prefix = `${parentId}/`;
  return (
    invocationId.startsWith(prefix) &&
    /^(retry|race)\/[1-9][0-9]*$/u.test(invocationId.slice(prefix.length))
  );
}
export function evaluateClosure(
  c: PelClosureValue,
  args: readonly PelValue[],
  context: ClosureEvaluationContextV1,
): PelStep {
  const { program, registry } = context;
  const admittedOptions = validateRunOptions(context.options);
  const admittedLimits = validateLimits(context.limits);
  const reject = (message: string): PelStep =>
    startPel(program, {
      registry,
      initialBindings: {},
      error: diagnostic("PEL_CONTINUATION_MISMATCH", neutralSpan, message),
    });
  if (!admittedOptions.ok || !admittedLimits.ok || !verifyRegistry(registry))
    return reject("invalid child options, registry or allocated limits");
  const options = admittedOptions.value,
    limits = admittedLimits.value;
  try {
    if (
      !boundedJson({
        closure: c,
        args,
        environmentTable: context.environmentTable,
      }) ||
      !validEnvironmentTable(context.environmentTable) ||
      !runtimeValidators(
        program.sourceDigest,
        context.environmentTable.records,
      ).value(c)
    )
      return reject("invalid child closure or lexical environment graph");
  } catch {
    return reject("invalid child closure context");
  }
  const s: PelContinuationV1 = {
    version: 1,
    sourceDigest: program.sourceDigest,
    profileDigest: program.profileDigest,
    registryDigest: registry.digest,
    optionsDigest: digest(options),
    program,
    registry,
    options,
    limits,
    environments: structuredClone(context.environmentTable.records),
    tasks: {},
    root: "",
    runnable: [],
    pending: {},
    completed: [],
    counters: {
      sourceBytes: program.sourceBytes,
      tokens: program.tokens,
      astNodes: program.astNodes,
      syntaxDepthPeak: program.syntaxDepthPeak,
      reductions: 0,
      iterations: 0,
      callDepthPeak: 0,
      valueBytesPeak: 0,
    },
    nextId: 0,
    mergedChildren: [],
    replayPhase: {
      phase:
        options.replay.mode === "completed-prefix" ? "prefix" : "execution",
      reductions: 0,
      iterations: 0,
      completed: 0,
    },
  };
  // Imported environment identifiers remain stable. New child identifiers cannot collide.
  s.nextId =
    Math.max(
      0,
      ...Object.keys(s.environments)
        .map((id) => Number(id.slice(1)))
        .filter(Number.isSafeInteger),
    ) + 1;
  const scope = env(s, c.environmentId);
  const node: PelNode = { kind: "nil", nodeId: c.nodeId, span: neutralSpan };
  s.root = task(s, node, scope, `${context.childInvocationId}/root`, 0);
  const t = s.tasks[s.root]!;
  if (
    !verifyRegistry(registry) ||
    options.replay.mode !== "none" ||
    context.sourceDigest !== program.sourceDigest ||
    c.sourceDigest !== program.sourceDigest ||
    context.profileDigest !== program.profileDigest ||
    context.registryDigest !== registry.digest ||
    context.optionsDigest !== digest(options) ||
    context.environmentTable.sourceDigest !== program.sourceDigest ||
    context.environmentTable.registryDigest !== registry.digest ||
    context.environmentTable.optionsDigest !== digest(options) ||
    !s.environments[c.environmentId] ||
    !childIdentity(context.parentRequestId, context.childInvocationId)
  )
    fail(
      s,
      t,
      "PEL_CONTINUATION_MISMATCH",
      "child closure context does not match its parent",
    );
  for (const [bound, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 0)
      fail(s, t, "PEL_LIMIT", `invalid allocated bound ${bound}`);
  const nodes: PelNode[] = args.map((value, i) => {
    const name = `@child-argument/${i}`;
    s.environments[scope]!.bindings[name] = value;
    return {
      kind: "symbol",
      name,
      nodeId: `${c.nodeId}/argument/${i}`,
      span: neutralSpan,
    };
  });
  if (!s.failure) apply(s, t, c, nodes);
  return drive(s);
}
export function chargeClosureConsumption(
  parent: PelContinuationV1,
  invocationId: string,
  consumed: PelCounters,
): import("./types.js").Result<PelContinuationV1, PelDiagnostic> & {
  readonly continuation?: PelContinuationV1;
} {
  const parentId = invocationId.split("/")[0]!;
  if (
    !childIdentity(parentId, invocationId) ||
    !parent.pending[parentId] ||
    parent.mergedChildren.includes(invocationId)
  )
    return {
      ok: false,
      error: diagnostic(
        "PEL_CONTINUATION_MISMATCH",
        neutralSpan,
        "unknown or already charged child invocation",
      ),
    };
  if (Object.values(consumed).some((v) => !Number.isSafeInteger(v) || v < 0))
    return {
      ok: false,
      error: diagnostic(
        "PEL_LIMIT",
        neutralSpan,
        "invalid child consumption counters",
      ),
    };
  const s = structuredClone(parent);
  s.registry = parent.registry;
  s.mergedChildren.push(invocationId);
  for (const k of ["reductions", "iterations"] as const)
    s.counters[k] += consumed[k];
  for (const k of [
    "syntaxDepthPeak",
    "callDepthPeak",
    "valueBytesPeak",
  ] as const)
    s.counters[k] = Math.max(s.counters[k], consumed[k]);
  for (const [counter, bound] of [
    ["reductions", "maxReductions"],
    ["iterations", "maxIterations"],
    ["callDepthPeak", "maxCallDepth"],
    ["valueBytesPeak", "maxValueBytes"],
  ] as const)
    if (
      !Number.isSafeInteger(s.counters[counter]) ||
      s.counters[counter] > s.limits[bound]
    )
      return {
        ok: false,
        error: diagnostic(
          "PEL_LIMIT",
          neutralSpan,
          "child consumption exceeds aggregate bounds",
          { bound, consumed: s.counters[counter] },
        ),
        continuation: s,
      };
  return { ok: true, value: s };
}
export function mergeClosureResult(
  parent: PelContinuationV1,
  invocationId: string,
  receipt: HostReceiptV1,
  consumed: PelCounters,
): PelStep {
  const charged = chargeClosureConsumption(parent, invocationId, consumed);
  const s = charged.ok
    ? charged.value
    : (charged.continuation ?? structuredClone(parent));
  s.registry = parent.registry;
  const t = s.tasks[s.root]!;
  if (!charged.ok) {
    s.failure = charged.error;
    return drive(s);
  }
  if (!childIdentity(receipt.requestId, invocationId)) {
    fail(
      s,
      t,
      "PEL_CONTINUATION_MISMATCH",
      "child result belongs to another request",
    );
    return drive(s);
  }
  for (const [counter, bound] of [
    ["reductions", "maxReductions"],
    ["iterations", "maxIterations"],
    ["callDepthPeak", "maxCallDepth"],
    ["valueBytesPeak", "maxValueBytes"],
  ] as const)
    if (
      !Number.isSafeInteger(s.counters[counter]) ||
      s.counters[counter] > s.limits[bound]
    ) {
      fail(s, t, "PEL_LIMIT", "child consumption exceeds the aggregate limit", {
        bound,
        consumed: s.counters[counter],
      });
      return drive(s);
    }
  return resumePel(s.program, s.registry, s, [receipt], s.options);
}
