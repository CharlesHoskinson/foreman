import {
  canonicalize,
  isCoreFailure,
  parseJsonRejectDuplicateKeys,
} from "@foreman/core";
import type { PelContinuationV1 } from "./evaluator.js";
import { PEL_DIAGNOSTIC_CODES, type PelDiagnostic } from "./diagnostics.js";
import { validateRunOptions, validateLimits } from "./runtime-validation.js";
import { PEL_PROFILE } from "./profile.js";
import { createHostRegistry, verifyRegistry } from "./host-contract.js";
import { builtinArgSpecs } from "./builtins.js";
import { decodePelData } from "./values.js";
import type { Result } from "./types.js";
import {
  boundedJson,
  CODEC_MAX_BYTES,
  codecFailure,
  exact,
  hashData,
  isDigest,
  isNatural,
  isRecord,
  isText,
  runtimeValidators,
  validEnvironmentTable,
  validSpan,
} from "./host-arguments.js";

export interface ContinuationBindingsV1 {
  readonly sourceDigest: string;
  readonly profileDigest: string;
  readonly registryDigest: string;
  readonly optionsDigest: string;
}
const fields = [
  "version",
  "sourceDigest",
  "profileDigest",
  "registryDigest",
  "optionsDigest",
  "program",
  "registry",
  "options",
  "limits",
  "environments",
  "tasks",
  "root",
  "pending",
  "completed",
  "counters",
  "nextId",
  "mergedChildren",
  "replayPhase",
  "runnable",
];
const counters = [
  "sourceBytes",
  "tokens",
  "astNodes",
  "syntaxDepthPeak",
  "reductions",
  "iterations",
  "callDepthPeak",
  "valueBytesPeak",
];
const limits = [
  "maxSourceBytes",
  "maxTokens",
  "maxAstNodes",
  "maxSyntaxDepth",
  "maxReductions",
  "maxIterations",
  "maxCallDepth",
  "maxValueBytes",
];
const numberRecord = (v: unknown, keys: readonly string[]): boolean =>
  exact(v, keys) && Object.values(v).every(isNatural);
function predicateSelection(v: unknown): boolean {
  return (
    exact(v, [
      "profileId",
      "transportId",
      "controls",
      "credentialProfileRef",
      "outputSchemaId",
    ]) &&
    [
      v.profileId,
      v.transportId,
      v.credentialProfileRef,
      v.outputSchemaId,
    ].every((x) => isText(x) && x.length > 0) &&
    v.outputSchemaId === "schema:pel-boolean-v1"
  );
}
function validOptions(v: unknown): boolean {
  if (
    !exact(v, [
      "dependencyMode",
      "nlConditionProfile",
      "nlConditionProfileDigest",
      "replay",
    ]) ||
    !["ordered", "automatic"].includes(String(v.dependencyMode))
  )
    return false;
  if (
    v.nlConditionProfile === null
      ? v.nlConditionProfileDigest !== null
      : !predicateSelection(v.nlConditionProfile) ||
        hashData(v.nlConditionProfile) !== v.nlConditionProfileDigest
  )
    return false;
  const r = v.replay;
  return (
    (exact(r, ["mode"]) && r.mode === "none") ||
    (exact(r, [
      "mode",
      "completedPrefixCount",
      "prefixDigest",
      "recordedCounters",
      "committedCounters",
      "maxReplayReductions",
    ]) &&
      r.mode === "completed-prefix" &&
      isNatural(r.completedPrefixCount) &&
      isDigest(r.prefixDigest) &&
      numberRecord(r.recordedCounters, counters) &&
      numberRecord(r.committedCounters, counters) &&
      isNatural(r.maxReplayReductions))
  );
}
function failure(v: unknown): boolean {
  return (
    exact(v, ["code", "message"], ["cause"]) &&
    isText(v.code) &&
    isText(v.message)
  );
}
function receipt(v: unknown): boolean {
  if (!exact(v, ["requestId", "outcome"]) || !isDigest(v.requestId))
    return false;
  const o = v.outcome;
  return (
    (exact(o, ["tag", "value"]) &&
      o.tag === "success" &&
      decodePelData(o.value).ok) ||
    (exact(o, ["tag", "failure"]) && o.tag === "failure" && failure(o.failure))
  );
}
function validDiagnostic(v: unknown): boolean {
  return (
    exact(
      v,
      ["code", "severity", "span", "relatedSpans", "message", "expectedForms"],
      ["signature", "help", "bound", "consumed", "hostFailure"],
    ) &&
    PEL_DIAGNOSTIC_CODES.includes(v.code as never) &&
    v.severity === "error" &&
    validSpan(v.span) &&
    isText(v.message) &&
    Array.isArray(v.relatedSpans) &&
    v.relatedSpans.every(validSpan) &&
    Array.isArray(v.expectedForms) &&
    v.expectedForms.every(isText) &&
    ["signature", "help", "bound"].every(
      (k) => v[k] === undefined || isText(v[k]),
    ) &&
    (v.consumed === undefined || isNatural(v.consumed)) &&
    (v.hostFailure === undefined || failure(v.hostFailure))
  );
}
/** Validate untrusted in-memory input without cloning, hashing or traversing it first. */
export function validateContinuation(
  input: unknown,
  bindings: ContinuationBindingsV1,
): Result<PelContinuationV1, PelDiagnostic> {
  try {
    if (!exact(input, fields, ["failure"])) throw Error("continuation fields");
    // Only authentic immutable registries may contain private symbol brands.
    const c = verifyRegistry(input.registry)
      ? { ...input, registry: structuredClone(input.registry) }
      : input;
    if (!boundedJson(c)) throw Error("continuation data or bounds");
    if (
      c.version !== 1 ||
      !exact(bindings, [
        "sourceDigest",
        "profileDigest",
        "registryDigest",
        "optionsDigest",
      ]) ||
      !Object.entries(bindings).every(([k, v]) => isDigest(v) && c[k] === v) ||
      c.profileDigest !== PEL_PROFILE.digest
    )
      throw Error("continuation identity");
    if (
      !validateRunOptions(c.options).ok ||
      !validOptions(c.options) ||
      hashData(c.options) !== c.optionsDigest ||
      !validateLimits(c.limits).ok ||
      !numberRecord(c.limits, limits) ||
      !numberRecord(c.counters, counters) ||
      !isNatural(c.nextId)
    )
      throw Error("options, limits or counters");
    if (
      !exact(c.replayPhase, [
        "phase",
        "reductions",
        "iterations",
        "completed",
      ]) ||
      !["prefix", "execution"].includes(String(c.replayPhase.phase)) ||
      !["reductions", "iterations", "completed"].every((k) =>
        isNatural((c.replayPhase as Record<string, unknown>)[k]),
      )
    )
      throw Error("replay phase");
    const table = {
      sourceDigest: c.sourceDigest,
      registryDigest: c.registryDigest,
      optionsDigest: c.optionsDigest,
      records: c.environments,
    };
    if (!validEnvironmentTable(table)) throw Error("environment graph");
    if (
      !isRecord(c.tasks) ||
      !isRecord(c.pending) ||
      !Array.isArray(c.completed) ||
      !Array.isArray(c.mergedChildren) ||
      !isText(c.root) ||
      !Object.hasOwn(c.tasks, c.root)
    )
      throw Error("task containers");
    const tasks = c.tasks,
      pending = c.pending,
      validate = runtimeValidators(c.sourceDigest as string, table.records);
    const taskRef = (id: unknown): id is string =>
      typeof id === "string" && Object.hasOwn(tasks, id);
    const childRefs = (xs: unknown): xs is string[] =>
      Array.isArray(xs) && xs.every(taskRef) && new Set(xs).size === xs.length;
    if (
      !c.mergedChildren.every(
        (x) => isText(x) && /^[a-f0-9]{64}\/(retry|race)\/[1-9][0-9]*$/.test(x),
      ) ||
      new Set(c.mergedChildren).size !== c.mergedChildren.length
    )
      throw Error("merged child identities");
    if (!childRefs(c.runnable)) throw Error("runnable task references");
    const program = c.program;
    if (
      !exact(program, [
        "sourceDigest",
        "profileId",
        "profileDigest",
        "expressions",
        "sourceBytes",
        "tokens",
        "astNodes",
        "syntaxDepthPeak",
      ]) ||
      program.sourceDigest !== c.sourceDigest ||
      program.profileDigest !== c.profileDigest ||
      program.profileId !== PEL_PROFILE.id ||
      !Array.isArray(program.expressions) ||
      !program.expressions.every((x) => validate.node(x)) ||
      !["sourceBytes", "tokens", "astNodes", "syntaxDepthPeak"].every((k) =>
        isNatural(program[k]),
      )
    )
      throw Error("program");
    const registry = c.registry;
    if (
      !exact(registry, [
        "schemaVersion",
        "profileId",
        "profileDigest",
        "descriptors",
        "dataSchemas",
        "failureSchemas",
        "resolverCatalog",
        "digest",
      ]) ||
      registry.schemaVersion !== 1 ||
      registry.profileId !== PEL_PROFILE.id ||
      registry.profileDigest !== c.profileDigest ||
      registry.digest !== c.registryDigest ||
      !Array.isArray(registry.descriptors) ||
      !isRecord(registry.dataSchemas) ||
      !isRecord(registry.failureSchemas) ||
      !isRecord(registry.resolverCatalog)
    )
      throw Error("registry");
    const dataSchemas = { ...registry.dataSchemas },
      failureSchemas = { ...registry.failureSchemas };
    delete dataSchemas["schema:pel-boolean-v1"];
    delete dataSchemas["schema:pel-data-v1"];
    delete failureSchemas["schema:pel-host-failure-v1"];
    const restored = createHostRegistry(
      registry.descriptors.filter(
        (d) => isRecord(d) && d.id !== "print" && d.id !== "pel/nl-condition",
      ) as never,
      dataSchemas as never,
      failureSchemas as never,
      registry.resolverCatalog as never,
    );
    if (!restored.ok || canonicalize(restored.value) !== canonicalize(registry))
      throw Error("registry canonical content");
    const hostDescriptors = new Map(
      restored.value.descriptors.map((d) => [d.id, d]),
    );
    function operation(op: unknown): boolean {
      if (!isRecord(op)) return false;
      const child = (required: string[], optional: string[] = []): boolean =>
        exact(op, required, optional) && taskRef(op.child);
      const boundMap = (v: unknown): boolean => validate.map(v, validate.bound);
      const valueMap = (v: unknown): boolean =>
        validate.map(v, (x) => validate.value(x));
      const nodes = (v: unknown): v is unknown[] =>
        Array.isArray(v) && v.every((x) => validate.node(x));
      const optionalChild = () => op.child === undefined || taskRef(op.child);
      const closure = () =>
        isRecord(op.closure) &&
        op.closure.tag === "closure" &&
        validate.value(op.closure);
      switch (op.kind) {
        case "eval":
          return exact(op, ["kind", "node"]) && validate.node(op.node);
        case "collect":
          return (
            exact(op, ["kind", "nodes", "children", "result"], ["head"]) &&
            nodes(op.nodes) &&
            childRefs(op.children) &&
            op.children.length <= op.nodes.length &&
            (op.result === "list" ||
              (op.result === "call" && op.nodes.length > 0)) &&
            (op.head === undefined || validate.value(op.head))
          );
        case "pair":
          return child(["kind", "key", "child"]) && isText(op.key);
        case "pipe":
          return child(["kind", "right", "child"]) && validate.node(op.right);
        case "pipe-head":
          return (
            child(["kind", "right", "child", "input"]) &&
            validate.node(op.right) &&
            isRecord(op.right) &&
            op.right.kind === "call" &&
            validate.value(op.input)
          );
        case "pass":
          return child(["kind", "child"]);
        case "bind":
          return (
            exact(
              op,
              ["kind", "closure", "plans", "index", "bound", "fresh"],
              ["child"],
            ) &&
            closure() &&
            Array.isArray(op.plans) &&
            op.plans.every(
              (p) =>
                exact(p, ["name", "node", "evaluation"]) &&
                isText(p.name) &&
                validate.node(p.node) &&
                ["strict", "syntax"].includes(String(p.evaluation)),
            ) &&
            isNatural(op.index) &&
            op.index <= op.plans.length &&
            boundMap(op.bound) &&
            typeof op.fresh === "boolean" &&
            optionalChild() &&
            (op.child === undefined || op.index < op.plans.length)
          );
        case "invoke":
          return (
            exact(op, ["kind", "closure", "bound", "fresh"]) &&
            closure() &&
            boundMap(op.bound) &&
            typeof op.fresh === "boolean"
          );
        case "define":
          return (
            child(["kind", "name", "environmentId", "cellId", "child"]) &&
            isText(op.name) &&
            isText(op.cellId) &&
            validate.environment(op.environmentId)
          );
        case "lambda":
          return (
            exact(
              op,
              ["kind", "params", "body", "capture", "defaults", "index"],
              ["child", "defaultCaret", "bodyCaret"],
            ) &&
            (op.defaultCaret === undefined ||
              validate.value(op.defaultCaret)) &&
            (op.bodyCaret === undefined || validate.value(op.bodyCaret)) &&
            validate.argSpec(op.params) &&
            op.params.kind === "fixed" &&
            validate.node(op.body) &&
            validate.environment(op.capture) &&
            valueMap(op.defaults) &&
            isNatural(op.index) &&
            op.index <= op.params.parameters.length &&
            optionalChild() &&
            (op.child === undefined || op.index < op.params.parameters.length)
          );
        case "if":
          return (
            child(["kind", "child", "yes", "no"]) &&
            validate.bound(op.yes) &&
            validate.bound(op.no)
          );
        case "case-start":
          return child(["kind", "child", "body"]) && validate.bound(op.body);
        case "case":
          return (
            exact(
              op,
              ["kind", "scrut", "nodes", "index", "body"],
              ["child", "applied"],
            ) &&
            validate.value(op.scrut) &&
            nodes(op.nodes) &&
            op.nodes.length % 2 === 0 &&
            isNatural(op.index) &&
            op.index % 2 === 0 &&
            op.index <= op.nodes.length &&
            validate.bound(op.body) &&
            optionalChild() &&
            (op.child === undefined || op.index < op.nodes.length) &&
            (op.applied === undefined || typeof op.applied === "boolean")
          );
        case "for-start":
          return (
            child(["kind", "child", "iterator", "body"]) &&
            validate.node(op.iterator) &&
            validate.bound(op.body)
          );
        case "for":
          return (
            exact(
              op,
              ["kind", "items", "index", "name", "body", "values"],
              ["child"],
            ) &&
            Array.isArray(op.items) &&
            op.items.every((x) => validate.value(x)) &&
            isNatural(op.index) &&
            op.index <= op.items.length &&
            isText(op.name) &&
            validate.bound(op.body) &&
            Array.isArray(op.values) &&
            op.values.length === op.index &&
            op.values.every((x) => validate.value(x)) &&
            optionalChild() &&
            (op.child === undefined || op.index < op.items.length)
          );
        case "block":
          return (
            exact(op, ["kind", "nodes", "children", "dependencies", "async"]) &&
            nodes(op.nodes) &&
            Array.isArray(op.children) &&
            op.children.length === op.nodes.length &&
            op.children.every((x) => x === null || taskRef(x)) &&
            new Set(op.children.filter((x) => x !== null)).size ===
              op.children.filter((x) => x !== null).length &&
            Array.isArray(op.dependencies) &&
            op.dependencies.length === op.nodes.length &&
            op.dependencies.every(
              (xs, i) =>
                Array.isArray(xs) &&
                xs.every(
                  (n) =>
                    isNatural(n) &&
                    n < (op.nodes as unknown[]).length &&
                    n !== i,
                ) &&
                new Set(xs).size === xs.length,
            ) &&
            typeof op.async === "boolean"
          );
        case "host":
          return exact(op, ["kind", "requestId"]) && isDigest(op.requestId);
        default:
          return false;
      }
    }
    const edges = new Map<string, string[]>();
    for (const [id, t] of Object.entries(tasks)) {
      if (
        !exact(
          t,
          ["id", "op", "environmentId", "path", "depth", "span", "nodeId"],
          ["caret", "value", "parentId"],
        ) ||
        id !== t.id ||
        !/^t\d+$/.test(id) ||
        !validate.environment(t.environmentId) ||
        !isText(t.path) ||
        !isNatural(t.depth) ||
        !validSpan(t.span) ||
        !validate.sourceNode(t.nodeId) ||
        !operation(t.op) ||
        (t.caret !== undefined && !validate.value(t.caret)) ||
        (t.value !== undefined && !validate.value(t.value)) ||
        (t.parentId !== undefined && !taskRef(t.parentId))
      )
        throw Error(`task ${id}`);
      const op = t.op as Record<string, unknown>;
      const refs: string[] = [];
      if (typeof op.child === "string") refs.push(op.child);
      if (Array.isArray(op.children))
        for (const r of op.children) if (r !== null) refs.push(r as string);
      edges.set(id, refs);
    }
    // Parent and child links must be acyclic; iterative colors bound traversal to graph size.
    function acyclic(graph: Map<string, string[]>): boolean {
      const colors = new Map<string, number>();
      for (const id of graph.keys()) {
        if (colors.get(id) === 2) continue;
        const work: { id: string; end: boolean }[] = [{ id, end: false }];
        while (work.length) {
          const item = work.pop()!;
          if (item.end) {
            colors.set(item.id, 2);
            continue;
          }
          if (colors.get(item.id) === 1) return false;
          if (colors.get(item.id) === 2) continue;
          colors.set(item.id, 1);
          work.push({ id: item.id, end: true });
          for (const target of graph.get(item.id) ?? [])
            work.push({ id: target, end: false });
        }
      }
      return true;
    }
    if (
      !acyclic(edges) ||
      !acyclic(
        new Map(
          Object.entries(tasks).map(([id, t]) => [
            id,
            (t as any).parentId === undefined ? [] : [(t as any).parentId],
          ]),
        ),
      )
    )
      throw Error("cyclic tasks");
    const completedIds = new Set<string>();
    for (const r of c.completed) {
      if (!receipt(r) || completedIds.has((r as any).requestId))
        throw Error("completed receipt");
      completedIds.add((r as any).requestId);
    }
    for (const merged of c.mergedChildren) {
      const parent = (merged as string).split("/")[0]!;
      if (!Object.hasOwn(pending, parent) && !completedIds.has(parent))
        throw Error("merged child parent");
    }
    for (const [id, p] of Object.entries(pending)) {
      if (!exact(p, ["request", "taskId"]) || !taskRef(p.taskId))
        throw Error("pending task");
      const r = p.request;
      if (
        !exact(
          r,
          [
            "requestId",
            "sourceDigest",
            "nodeId",
            "invocationOrdinal",
            "invocationPath",
            "registryId",
            "boundArguments",
            "expectedResultSchemaId",
            "alreadyEmitted",
          ],
          ["selection", "selectionDigest", "replayOnly"],
        ) ||
        id !== r.requestId ||
        !isDigest(id) ||
        completedIds.has(id) ||
        r.sourceDigest !== c.sourceDigest ||
        !validate.sourceNode(r.nodeId) ||
        !isNatural(r.invocationOrdinal) ||
        !isText(r.invocationPath) ||
        !isText(r.registryId) ||
        !validate.map(r.boundArguments, (x) => validate.value(x)) ||
        typeof r.alreadyEmitted !== "boolean" ||
        (r.replayOnly !== undefined && r.replayOnly !== true)
      )
        throw Error("pending request");
      const descriptor = hostDescriptors.get(r.registryId);
      if (!descriptor || r.expectedResultSchemaId !== descriptor.resultSchemaId)
        throw Error("pending descriptor");
      if (
        hashData({
          sourceDigest: c.sourceDigest,
          registryDigest: c.registryDigest,
          nodeId: r.nodeId,
          invocationPath: r.invocationPath,
        }) !== id
      )
        throw Error("request identity digest");
      const task = tasks[p.taskId] as any;
      if (
        task.op.kind !== "host" ||
        task.op.requestId !== id ||
        task.nodeId !== r.nodeId ||
        task.path !== r.invocationPath ||
        task.value !== undefined
      )
        throw Error("request task correlation");
      if (r.registryId === "pel/nl-condition") {
        if (
          !predicateSelection(r.selection) ||
          hashData(r.selection) !== r.selectionDigest ||
          r.selectionDigest !== (c.options as any).nlConditionProfileDigest
        )
          throw Error("predicate identity");
      } else if (r.selection !== undefined || r.selectionDigest !== undefined)
        throw Error("unexpected predicate selection");
    }
    for (const [id, t] of Object.entries(tasks)) {
      const task = t as any;
      if (
        task.op.kind === "host" &&
        task.value === undefined &&
        !Object.hasOwn(pending, task.op.requestId) &&
        !completedIds.has(task.op.requestId)
      )
        throw Error(`orphan host task ${id}`);
    }
    // Bind stored syntax to the admitted program rather than trusting an ID prefix.
    const sourceNodes = new Map<string, Record<string, unknown>>();
    function indexNodes(x: unknown): void {
      if (Array.isArray(x)) {
        for (const item of x) indexNodes(item);
        return;
      }
      if (!isRecord(x)) return;
      if (
        typeof x.nodeId === "string" &&
        typeof x.kind === "string" &&
        Object.hasOwn(x, "span")
      ) {
        const old = sourceNodes.get(x.nodeId);
        if (old && canonicalize(old) !== canonicalize(x))
          throw Error("conflicting source node");
        sourceNodes.set(x.nodeId, x);
      }
      for (const item of Object.values(x)) indexNodes(item);
    }
    indexNodes(program.expressions);
    indexNodes(builtinArgSpecs);
    for (const d of restored.value.descriptors) indexNodes(d.argSpec);
    const syntheticNil = new Set<unknown>();
    for (const t of Object.values(tasks)) {
      const task = t as any;
      if (
        task.value !== undefined &&
        task.op.kind === "eval" &&
        task.op.node.kind === "nil" &&
        task.op.node.nodeId === task.nodeId
      )
        syntheticNil.add(task.op.node);
    }
    function nodeHeader(n: Record<string, unknown>): Record<string, unknown> {
      const out = { ...n };
      for (const key of ["left", "right", "expression", "value"])
        if (
          isRecord(out[key]) &&
          typeof (out[key] as Record<string, unknown>).nodeId === "string"
        )
          out[key] = { nodeId: (out[key] as Record<string, unknown>).nodeId };
      if (Array.isArray(out.items))
        out.items = out.items.map((x) => ({
          nodeId: (x as Record<string, unknown>).nodeId,
        }));
      return out;
    }
    const hasBinding = (name: unknown): boolean =>
      typeof name === "string" &&
      Object.values(table.records).some((e) =>
        Object.hasOwn((e as any).bindings, name),
      );
    function inspectSyntax(x: unknown): void {
      if (Array.isArray(x)) {
        for (const item of x) inspectSyntax(item);
        return;
      }
      if (!isRecord(x)) return;
      if (
        typeof x.nodeId === "string" &&
        typeof x.kind === "string" &&
        Object.hasOwn(x, "span") &&
        !syntheticNil.has(x)
      ) {
        const expected = sourceNodes.get(x.nodeId);
        if (expected) {
          const actualHeader = nodeHeader(x),
            expectedHeader = nodeHeader(expected);
          if (canonicalize(actualHeader) !== canonicalize(expectedHeader)) {
            if (
              x.kind !== "call" ||
              expected.kind !== "call" ||
              !Array.isArray(x.items) ||
              !Array.isArray(expected.items) ||
              x.items.length !== expected.items.length + 1 ||
              !isRecord(x.items[1]) ||
              x.items[1].nodeId !== `${x.nodeId}/injected`
            )
              throw Error("changed source syntax");
            actualHeader.items = (actualHeader.items as unknown[]).filter(
              (_, i) => i !== 1,
            );
            if (canonicalize(actualHeader) !== canonicalize(expectedHeader))
              throw Error("changed injected call");
          }
        } else {
          const injected = /^(.*)\/injected$/.exec(x.nodeId),
            argument = /^(.*)\/argument\/(0|[1-9][0-9]*)$/.exec(x.nodeId);
          if (injected) {
            const base = sourceNodes.get(injected[1]!);
            if (
              !base ||
              base.kind !== "call" ||
              x.kind !== "symbol" ||
              !/^@injected\/[0-9]+$/.test(String(x.name)) ||
              !hasBinding(x.name) ||
              canonicalize(x.span) !== canonicalize(base.span)
            )
              throw Error("invalid injected symbol");
          } else if (argument) {
            if (
              !sourceNodes.has(argument[1]!) ||
              x.kind !== "symbol" ||
              x.name !== `@child-argument/${argument[2]}` ||
              !hasBinding(x.name)
            )
              throw Error("invalid child argument");
          } else throw Error("unknown source syntax");
        }
      }
      for (const item of Object.values(x)) inspectSyntax(item);
    }
    inspectSyntax(c.environments);
    inspectSyntax(c.tasks);
    inspectSyntax(c.pending);
    if (c.failure !== undefined && !validDiagnostic(c.failure))
      throw Error("failure diagnostic");
    return { ok: true, value: c as unknown as PelContinuationV1 };
  } catch (error) {
    return {
      ok: false,
      error: codecFailure(
        error instanceof Error ? error.message : "invalid continuation",
      ),
    };
  }
}
export function encodeContinuation(
  continuation: PelContinuationV1,
): Result<Uint8Array, PelDiagnostic> {
  try {
    // Access identity fields only after their descriptors have been checked.
    if (!exact(continuation, fields, ["failure"]))
      return { ok: false, error: codecFailure("continuation fields") };
    const checked = validateContinuation(continuation, {
      sourceDigest: continuation.sourceDigest,
      profileDigest: continuation.profileDigest,
      registryDigest: continuation.registryDigest,
      optionsDigest: continuation.optionsDigest,
    });
    if (!checked.ok) return checked;
    const payload = checked.value,
      encoded = Buffer.from(
        canonicalize({ schemaVersion: 1, payload, digest: hashData(payload) }),
      );
    if (encoded.byteLength > CODEC_MAX_BYTES)
      return { ok: false, error: codecFailure("continuation byte limit") };
    return { ok: true, value: new Uint8Array(encoded) };
  } catch {
    return { ok: false, error: codecFailure("invalid continuation") };
  }
}
export function decodeContinuation(
  bytes: Uint8Array,
  bindings: ContinuationBindingsV1,
): Result<PelContinuationV1, PelDiagnostic> {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > CODEC_MAX_BYTES)
      return {
        ok: false,
        error: codecFailure("continuation byte limit or type"),
      };
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    const envelope = parseJsonRejectDuplicateKeys(text);
    if (
      isCoreFailure(envelope) ||
      !boundedJson(envelope) ||
      !exact(envelope, ["schemaVersion", "payload", "digest"]) ||
      envelope.schemaVersion !== 1 ||
      !isDigest(envelope.digest) ||
      hashData(envelope.payload) !== envelope.digest ||
      canonicalize(envelope) !== text
    )
      return {
        ok: false,
        error: codecFailure("continuation envelope, digest or canonical JSON"),
      };
    const checked = validateContinuation(envelope.payload, bindings);
    return checked.ok
      ? { ok: true, value: structuredClone(checked.value) }
      : checked;
  } catch {
    return { ok: false, error: codecFailure("invalid continuation encoding") };
  }
}
export const encodePelContinuation = encodeContinuation;
export const decodePelContinuation = decodeContinuation;
