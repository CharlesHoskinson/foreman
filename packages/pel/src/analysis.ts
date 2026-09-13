import { canonicalize, sha256Hex } from "@foreman/core";
import type { PelNode, SourceSpan } from "./ast.js";
import type {
  ArgSpecV1,
  PelDataValue,
  PelValue,
  PelClosureValue,
} from "./types.js";
import type {
  HostFunctionDescriptorV1,
  PelDataSchemaV1,
} from "./host-contract.js";
import { builtinArgSpecs, pureBuiltin, callableList } from "./builtins.js";
import { planArguments } from "./arguments.js";
import { analyzeSequence } from "./dependencies.js";
import { resolveModelSelection } from "./snapshot.js";
import type {
  AuthoringDiagnostic,
  AuthoringSnapshotV1,
  AuthoringModelSelectionV1,
} from "./authoring-types.js";
import type {
  AnalysisInputV1,
  PelAnalysisV1,
  ValueSummaryV1,
  PreviewEffectV1,
  PreviewDependencyV1,
  DynamicRegionV1,
} from "./analysis-types.js";

type Env = Map<string, A>;
type A = {
  deps: Set<string>;
  schemaId?: string;
  origins?: SourceSpan[];
  schema?: PelDataSchemaV1;
} & (
  | { tag: "known"; value: PelValue }
  | {
      tag: "unknown";
      schema: PelDataSchemaV1;
      origins: SourceSpan[];
      schemaId?: string;
    }
  | { tag: "list"; items: A[] }
  | { tag: "pair"; key: string; value: A }
  | { tag: "functions"; choices: F[] }
  | { tag: "conditional"; origins: SourceSpan[] }
  | { tag: "cell"; value?: A }
);
type B =
  | { kind: "value"; value: A }
  | { kind: "syntax"; node: PelNode; env: Env; caret?: A };
interface F {
  id: string;
  spec: ArgSpecV1;
  kind: "builtin" | "host" | "user";
  name: string;
  env: Env;
  bound: Record<string, B>;
  defaults: Record<string, A>;
  body?: PelNode;
  caret?: A;
}
interface Context {
  env: Env;
  caret?: A;
  structure: boolean;
  depth: number;
  path: string;
  region?: string;
  branch?: string;
  ordered: boolean;
  multiplier?: number;
  controlDeps?: Set<string>;
}
const anySchema: PelDataSchemaV1 = {
  type: "data",
  maxDepth: 32,
  maxBytes: 1048576,
};
const nil = (): A => known({ tag: "nil" });
const known = (value: PelValue, deps: Set<string> = new Set()): A => ({
  tag: "known",
  value,
  deps,
});
const deps = (values: readonly A[]): Set<string> =>
  new Set(values.flatMap((v) => [...v.deps]));
function concrete(v: A): PelValue | undefined {
  if (v.tag === "known") return v.value;
  if (v.tag === "pair") {
    const value = concrete(v.value);
    return value === undefined ? undefined : { tag: "pair", key: v.key, value };
  }
  if (v.tag === "list") {
    const values = v.items.map(concrete);
    return values.some((x) => x === undefined)
      ? undefined
      : { tag: "list", items: values as PelValue[] };
  }
  return undefined;
}
function data(v: PelValue): v is PelDataValue {
  return (
    v.tag !== "closure" &&
    v.tag !== "syntax" &&
    v.tag !== "symbol" &&
    (v.tag !== "list" || v.items.every(data)) &&
    (v.tag !== "pair" || data(v.value))
  );
}
function summary(v: A): ValueSummaryV1 {
  const value = concrete(v);
  if (value && data(value)) return { kind: "known", value };
  if (v.tag === "functions")
    return {
      kind: "callable",
      codeReferences: v.choices.map((f) => f.id),
      remainingArguments: [
        ...new Set(
          v.choices.flatMap((f) =>
            f.spec.kind === "fixed"
              ? f.spec.parameters
                  .filter((p) => !Object.hasOwn(f.bound, p.name))
                  .map((p) => p.name)
              : [],
          ),
        ),
      ],
    };
  return {
    kind: "unresolved",
    ...(v.schema
      ? { schema: v.schema, ...(v.schemaId ? { schemaId: v.schemaId } : {}) }
      : {}),
    reason: value ? "quoted syntax" : "value depends on host results",
    originSpans: v.origins ?? [],
  };
}
function unknown(
  schema: PelDataSchemaV1,
  span: SourceSpan,
  dependencies = new Set<string>(),
  schemaId?: string,
): A {
  if (schema.type === "association")
    return {
      tag: "list",
      deps: dependencies,
      schema,
      origins: [span],
      ...(schemaId ? { schemaId } : {}),
      items: schema.fields.map((f) => ({
        tag: "pair",
        key: f.key,
        value: unknown(f.schema, span, dependencies),
        deps: dependencies,
      })),
    };
  if (schema.type === "nil") return known({ tag: "nil" }, dependencies);
  return {
    tag: "unknown",
    schema,
    origins: [span],
    deps: dependencies,
    ...(schemaId ? { schemaId } : {}),
  };
}
function merge(a: A, b: A, span: SourceSpan): A {
  if (a === b) return a;
  const ac = concrete(a),
    bc = concrete(b);
  const dependencies = deps([a, b]);
  if (ac && bc && canonicalize(ac) === canonicalize(bc))
    return known(ac, dependencies);
  if (a.tag === "functions" && b.tag === "functions")
    return {
      tag: "functions",
      choices: [...new Set([...a.choices, ...b.choices])],
      deps: dependencies,
    };
  if (a.tag === "pair" && b.tag === "pair" && a.key === b.key)
    return {
      tag: "pair",
      key: a.key,
      value: merge(a.value, b.value, span),
      deps: dependencies,
    };
  if (a.tag === "unknown" && b.tag === "unknown") {
    const schema: PelDataSchemaV1 =
      canonicalize(a.schema) === canonicalize(b.schema)
        ? a.schema
        : { type: "union", variants: [a.schema, b.schema] };
    return unknown(
      schema,
      span,
      dependencies,
      a.schemaId === b.schemaId ? a.schemaId : undefined,
    );
  }
  if (a.tag === "list" && b.tag === "list" && a.items.length === b.items.length)
    return {
      tag: "list",
      items: a.items.map((v, i) => merge(v, b.items[i]!, span)),
      deps: dependencies,
      ...(a.schema ? { schema: a.schema } : {}),
      ...(a.schemaId && a.schemaId === b.schemaId
        ? { schemaId: a.schemaId }
        : {}),
      origins: [...(a.origins ?? []), ...(b.origins ?? [])],
    };
  const schema =
    ac &&
    bc &&
    ac.tag === bc.tag &&
    ["number", "string", "boolean"].includes(ac.tag)
      ? ac.tag === "number"
        ? {
            type: "number" as const,
            integer: false,
            minimum: -Number.MAX_VALUE,
            maximum: Number.MAX_VALUE,
          }
        : ac.tag === "string"
          ? { type: "string" as const, maxBytes: 1048576 }
          : { type: "boolean" as const }
      : anySchema;
  return unknown(schema, span, dependencies);
}
class AnalysisFailure extends Error {
  constructor(readonly diagnostic: AuthoringDiagnostic) {
    super(diagnostic.message);
  }
}
export function analyzePel(input: AnalysisInputV1): PelAnalysisV1 {
  const { program, snapshot: s } = input;
  const effects: PreviewEffectV1[] = [];
  const dependencies: PreviewDependencyV1[] = [];
  const dynamicRegions: DynamicRegionV1[] = [];
  let reductions = 0,
    iterations = 0;
  let ordinal = 0;
  let effectCalls = 0;
  const effectWeights = new Map<string, number>();
  const localNames = new WeakMap<Env, Set<string>>();
  const reserved = new Set([
    ...Object.keys(builtinArgSpecs),
    ...s.registry.descriptors.map((d) => d.name),
  ]);
  function scope(parent: Env, copyLocals = false): Env {
    const result = new Map(parent);
    localNames.set(
      result,
      copyLocals ? new Set(localNames.get(parent) ?? []) : new Set(),
    );
    return result;
  }
  function caretUsed(n: PelNode, c: Context): boolean {
    if (n.kind === "quote") return false;
    if (n.kind === "caret") return true;
    if (n.kind === "pipe") return caretUsed(n.left, c);
    if (n.kind === "pair") return caretUsed(n.value, c);
    if (n.kind === "call") {
      const head = n.items[0];
      const value = head?.kind === "symbol" ? c.env.get(head.name) : undefined;
      if (
        value?.tag === "functions" &&
        value.choices.every((f) => f.name === "case")
      ) {
        return n.items
          .slice(1)
          .some((a, i) =>
            a.kind === "pair"
              ? a.key !== "body" && caretUsed(a.value, c)
              : i === 0 && n.items.length > 2 && caretUsed(a, c),
          );
      }
    }
    return (
      (n.kind === "list" || n.kind === "call") &&
      n.items.some((i) => caretUsed(i, c))
    );
  }
  function inject(n: PelNode, value: A, c: Context): PelNode {
    if (n.kind === "pipe") return { ...n, left: inject(n.left, value, c) };
    if (n.kind !== "call")
      fail("PEL_TYPE", n, "Pipe without a caret requires a call");
    const name = `@abstract-injected/${ordinal++}`;
    c.env.set(name, value);
    return {
      ...n,
      items: [n.items[0]!, { ...n, kind: "symbol", name }, ...n.items.slice(1)],
    };
  }
  function fail(
    code: string,
    node: PelNode,
    message: string,
    relatedSpans: readonly SourceSpan[] = [],
  ): never {
    throw new AnalysisFailure({
      code,
      severity: "error",
      span: node.span,
      message,
      relatedSpans,
      expectedForms: [],
    });
  }
  function tick(n: PelNode, c: Context): void {
    if (++reductions > s.limits.maxReductions)
      fail("PEL_LIMIT", n, "Abstract evaluation exceeds maxReductions");
    if (c.depth > s.limits.maxCallDepth)
      fail("PEL_LIMIT", n, "Abstract evaluation exceeds maxCallDepth");
  }
  function expect(v: A, types: readonly string[], n: PelNode): void {
    const possible = (schema: PelDataSchemaV1): boolean =>
      schema.type === "data" ||
      (schema.type === "union"
        ? schema.variants.some(possible)
        : types.includes(schema.type));
    if (v.tag === "unknown" && !possible(v.schema))
      fail(
        "PEL_TYPE",
        n,
        `No result schema variant can satisfy ${types.join(" or ")}`,
      );
    const cv = concrete(v);
    const type =
      cv?.tag ??
      (v.tag === "list"
        ? "list"
        : v.tag === "functions"
          ? "closure"
          : v.tag === "unknown"
            ? v.schema.type
            : undefined);
    if (type && type !== "data" && type !== "union" && !types.includes(type))
      fail("PEL_TYPE", n, `Expected ${types.join(" or ")}; received ${type}`);
  }
  function text(v: A | undefined): string | undefined {
    const cv = v && concrete(v);
    return cv?.tag === "string" ? cv.value : undefined;
  }
  function val(b: B | undefined, c: Context): A {
    if (!b) return nil();
    return b.kind === "value"
      ? b.value
      : ev(b.node, {
          ...c,
          env: b.env,
          ...(b.caret ? { caret: b.caret } : {}),
        });
  }
  function syntax(
    b: B | undefined,
    n: PelNode,
  ): Extract<B, { kind: "syntax" }> {
    if (b?.kind !== "syntax") fail("PEL_TYPE", n, "Expected syntax argument");
    return b;
  }
  function mergeEnvs(target: Env, a: Env, b: Env, n: PelNode): void {
    for (const name of new Set([...a.keys(), ...b.keys()])) {
      const av = a.get(name),
        bv = b.get(name);
      if (av && bv) target.set(name, merge(av, bv, n.span));
      else
        target.set(name, {
          tag: "conditional",
          origins: [n.span],
          deps: new Set(),
        });
    }
    localNames.set(
      target,
      new Set([...(localNames.get(a) ?? []), ...(localNames.get(b) ?? [])]),
    );
  }
  function region(
    n: PelNode,
    c: Context,
    reason: DynamicRegionV1["reason"],
    count: number,
    run: (child: Context) => A,
  ): A {
    if (c.structure) return run(c);
    const start = effects.length,
      id = `region/${n.nodeId}/${ordinal++}`;
    const value = run({
      ...c,
      region: id,
      multiplier: (c.multiplier ?? 1) * count,
    });
    const members = effects.slice(start);
    const calls =
      members.reduce(
        (sum, e) => sum + (effectWeights.get(e.effectId) ?? 1),
        0,
      ) / (c.multiplier ?? 1);
    if (!Number.isSafeInteger(calls) || calls > s.policy.maxEffects)
      fail(
        "PEL_DYNAMIC_EFFECT_UNBOUNDED",
        n,
        "Dynamic region exceeds the admitted host-call bound",
      );
    dynamicRegions.push({
      regionId: id,
      spans: [n.span],
      reason,
      possibleRegistryIds: [
        ...new Set(members.map((e) => e.registryId)),
      ].sort(),
      models: members.flatMap((e) =>
        e.model
          ? [{ profileId: e.model.profileId, transportId: e.model.transportId }]
          : [],
      ),
      capabilities: [...new Set(members.flatMap((e) => e.capabilities))].sort(),
      resources: {
        reads: [...new Set(members.flatMap((e) => e.resources.reads))].sort(),
        writes: [...new Set(members.flatMap((e) => e.resources.writes))].sort(),
      },
      maxIterations: count,
      maxCalls: calls,
      maxOutputBytes: s.policy.maxOutputBytes,
      maxCostUnits: s.policy.maxCostUnits,
      maxElapsedMs: s.policy.maxElapsedMs,
      resultSchema: value.tag === "unknown" ? value.schema : anySchema,
      deferredRequirements: [
        "Validate runtime arguments and results against the bound policy and schemas before dispatch.",
      ],
    });
    return value;
  }
  function host(f: F, args: Record<string, A>, n: PelNode, c: Context): A {
    const d = s.registry.descriptors.find((d) => d.id === f.name);
    if (!d)
      fail("PEL_UNBOUND_SYMBOL", n, `Host descriptor ${f.name} is missing`);
    for (const name of [
      "id",
      "model",
      "output",
      "transport",
      "gate",
      "policy",
      "destination",
      "query",
      "bundle",
      "name",
    ])
      if (
        args[name] &&
        !(name === "transport" && concrete(args[name])?.tag === "nil")
      )
        expect(args[name]!, ["string"], n);
    if (args.limit) {
      expect(args.limit, ["number"], n);
      const v = concrete(args.limit);
      if (
        v?.tag === "number" &&
        (!Number.isInteger(v.value) || v.value < 1 || v.value > 20)
      )
        fail("PEL_TYPE", n, "Research limit must be an integer from 1 to 20");
    }
    if (c.structure)
      return unknown(
        s.registry.dataSchemas[d.resultSchemaId]!,
        n.span,
        deps(Object.values(args)),
        d.resultSchemaId,
      );
    for (const cap of d.capabilities)
      if (!s.policy.allowedCapabilities.includes(cap))
        fail("PEL_CAPABILITY_DENIED", n, `Capability ${cap} is not admitted`);
    if (!s.policy.allowedEffectKinds.includes(d.effectKind))
      fail(
        "PEL_UNSUPPORTED_EFFECT",
        n,
        `Effect kind ${d.effectKind} is not admitted`,
      );
    if (!s.policy.allowedSchemaIds.includes(d.resultSchemaId))
      fail(
        "PEL_SCHEMA",
        n,
        `Result schema ${d.resultSchemaId} is not admitted`,
      );
    let model: AuthoringModelSelectionV1 | null = null;
    if (args.model) {
      const id = text(args.model);
      if (!id)
        fail(
          "PEL_DYNAMIC_EFFECT_UNBOUNDED",
          n,
          "A model selection must resolve to an exact finite profile and transport",
        );
      const selection = resolveModelSelection(s, id, text(args.transport));
      if (!selection.ok)
        throw new AnalysisFailure({ ...selection.error[0]!, span: n.span });
      model = selection.value;
    }
    if (d.name === "pel/nl-condition") {
      if (!s.nlConditionProfile)
        fail(
          "PEL_PROFILE_UNSUPPORTED",
          n,
          "Natural-language conditions need an explicit model profile",
        );
      const p = s.nlConditionProfile;
      const selection = resolveModelSelection(s, p.profileId, p.transportId);
      if (!selection.ok)
        throw new AnalysisFailure({ ...selection.error[0]!, span: n.span });
      model = {
        ...selection.value,
        controls:
          p.controls as unknown as AuthoringModelSelectionV1["controls"],
        credentialProfileRef: p.credentialProfileRef,
      };
    }
    for (const [name, allowed, code] of [
      ["output", s.policy.allowedSchemaIds, "PEL_SCHEMA"],
      ["policy", s.policy.allowedReviewPolicies, "PEL_CAPABILITY_DENIED"],
      ["gate", s.policy.allowedGates, "PEL_GATE_DENIED"],
      ["destination", s.policy.allowedDestinations, "PEL_RESOURCE_DENIED"],
    ] as const) {
      if (args[name]) {
        const v = text(args[name]);
        if (v && !allowed.includes(v))
          fail(code, n, `${name} ${v} is not admitted`);
        if (!v)
          fail(
            "PEL_DYNAMIC_EFFECT_UNBOUNDED",
            n,
            `${name} must resolve within a finite admitted set`,
          );
      }
    }
    const reads = new Set(d.resources.reads),
      writes = new Set(d.resources.writes);
    let unresolved = d.resources.unknown;
    for (const name of ["input", "bundle"]) {
      const v = args[name];
      if (!v) continue;
      const value = text(v);
      if (value) {
        if (value.startsWith("workspace:") || value.startsWith("source:"))
          reads.add(value);
        if (value.startsWith("artifact:")) {
          if (!s.policy.artifactConstraints.allowedIds.includes(value))
            fail("PEL_ARTIFACT_DENIED", n, `Artifact ${value} is not admitted`);
          reads.add(value);
        }
        if (value.includes("../") || value.startsWith("/"))
          fail(
            "PEL_RESOURCE_DENIED",
            n,
            "Resource path escapes the admitted scope",
          );
      } else if (!concrete(v)) unresolved = true;
    }
    for (const [paths, allowed] of [
      [reads, s.policy.resourceEnvelope.reads],
      [writes, s.policy.resourceEnvelope.writes],
    ] as const)
      for (const p of paths)
        if (!allowed.includes(p))
          fail(
            "PEL_RESOURCE_DENIED",
            n,
            `Resource ${p} is outside the policy envelope`,
          );
    if (
      unresolved &&
      s.policy.resourceEnvelope.reads.length +
        s.policy.resourceEnvelope.writes.length ===
        0
    )
      fail(
        "PEL_DYNAMIC_EFFECT_UNBOUNDED",
        n,
        "Unknown resource has no finite policy envelope",
      );
    const effectId = sha256Hex(
      `${program.sourceDigest}:${n.nodeId}:${c.path}:${ordinal++}`,
    );
    const effect: PreviewEffectV1 = {
      effectId,
      nodeId: n.nodeId,
      invocationPath: c.path,
      span: n.span,
      registryId: d.id,
      arguments: Object.fromEntries(
        Object.entries(args).map(([k, v]) => [k, summary(v)]),
      ),
      model,
      controlsSource: model
        ? text(args.model)?.startsWith("role:")
          ? "default"
          : "explicit"
        : null,
      capabilities: d.capabilities,
      resources: {
        reads: [...reads],
        writes: [...writes],
        unknown: unresolved,
      },
      gates: text(args.gate) ? [text(args.gate)!] : [],
      ...(c.region ? { regionId: c.region } : {}),
      ...(c.branch ? { branch: c.branch } : {}),
    };
    for (const from of new Set([
      ...deps(Object.values(args)),
      ...(c.controlDeps ?? []),
    ]))
      dependencies.push({
        from,
        to: effectId,
        kind: "value",
        reason: "Host argument depends on this result",
      });
    const previous = effects.at(-1);
    if (c.ordered && previous && previous.branch === effect.branch)
      dependencies.push({
        from: previous.effectId,
        to: effectId,
        kind: "order",
        reason: "Ordered Pel evaluation",
      });
    for (const before of effects) {
      // Separate conditions may both run; retain conservative serialization.
      const conflict =
        before.resources.writes.some((p) => writes.has(p) || reads.has(p)) ||
        [...writes].some((p) => before.resources.reads.includes(p)) ||
        (before.resources.unknown && writes.size > 0) ||
        (unresolved && before.resources.writes.length > 0);
      if (conflict)
        dependencies.push({
          from: before.effectId,
          to: effectId,
          kind: "serialization",
          reason: "Resource accesses can conflict",
        });
    }
    effects.push(effect);
    const weight = c.multiplier ?? 1;
    effectWeights.set(effectId, weight);
    effectCalls += weight;
    if (!Number.isSafeInteger(effectCalls) || effectCalls > s.policy.maxEffects)
      fail("PEL_LIMIT", n, "Plan exceeds maxEffects");
    let resultSchema = s.registry.dataSchemas[d.resultSchemaId]!;
    if (d.name === "fm/research" && resultSchema.type === "association") {
      const limit = args.limit && concrete(args.limit);
      const maximum = limit?.tag === "number" ? limit.value : 20;
      resultSchema = {
        ...resultSchema,
        fields: resultSchema.fields.map((field) =>
          field.key === "results" && field.schema.type === "list"
            ? {
                ...field,
                schema: {
                  ...field.schema,
                  maxItems: Math.min(field.schema.maxItems, maximum),
                },
              }
            : field,
        ),
      };
    }
    const result = unknown(
      resultSchema,
      n.span,
      new Set([effectId]),
      d.resultSchemaId,
    );
    if (d.name === "fm/retry" || d.name === "fm/race") {
      const runBody = (body: A | undefined, context: Context): A => {
        if (
          body?.tag !== "functions" ||
          body.choices.some(
            (f) =>
              f.kind !== "user" ||
              f.spec.kind !== "fixed" ||
              f.spec.parameters.some(
                (p) => p.required && !Object.hasOwn(f.bound, p.name),
              ),
          )
        )
          fail(
            "PEL_DYNAMIC_EFFECT_UNBOUNDED",
            n,
            "Control body must be a finite set of zero-argument Pel closures",
          );
        return call(body, [], n, context);
      };
      const context = {
        ...c,
        controlDeps: new Set([...(c.controlDeps ?? []), effectId]),
      };
      if (d.name === "fm/retry") {
        const count = args.attempts && concrete(args.attempts);
        if (
          count?.tag !== "number" ||
          !Number.isSafeInteger(count.value) ||
          count.value < 1 ||
          count.value > s.limits.maxIterations
        )
          fail(
            "PEL_DYNAMIC_EFFECT_UNBOUNDED",
            n,
            "Retry attempts require a positive finite integer within the iteration limit",
          );
        const categories = args.on && concrete(args.on);
        if (
          categories?.tag !== "list" ||
          categories.items.length === 0 ||
          categories.items.some((v) => v.tag !== "key")
        )
          fail(
            "PEL_TYPE",
            n,
            "Retry categories must be an evaluated list of quoted keys",
          );
        region(n, context, "unknown condition", count.value, (rc) =>
          runBody(args.body, rc),
        );
      } else {
        if (text(args.winner) !== "first-valid")
          fail("PEL_TYPE", n, "Race winner must be first-valid");
        const tasks = args.tasks;
        if (
          tasks?.tag !== "list" ||
          tasks.items.length === 0 ||
          tasks.items.length > s.policy.maxEffects
        )
          fail(
            "PEL_DYNAMIC_EFFECT_UNBOUNDED",
            n,
            "Race tasks require a finite nonempty closure list",
          );
        region(n, context, "unknown callable", 1, (rc) => {
          const values = tasks.items.map((body, i) =>
            runBody(body, {
              ...rc,
              ordered: false,
              path: `${rc.path}/race/${i + 1}`,
            }),
          );
          return values.reduce((a, b) => merge(a, b, n.span));
        });
      }
    }
    if (unresolved && !c.region)
      dynamicRegions.push({
        regionId: `region/${effectId}`,
        spans: [n.span],
        reason: "unknown argument",
        possibleRegistryIds: [d.id],
        models: model
          ? [{ profileId: model.profileId, transportId: model.transportId }]
          : [],
        capabilities: d.capabilities,
        resources: {
          reads: s.policy.resourceEnvelope.reads,
          writes: s.policy.resourceEnvelope.writes,
        },
        maxIterations: 1,
        maxCalls: 1,
        maxOutputBytes: s.policy.maxOutputBytes,
        maxCostUnits: s.policy.maxCostUnits,
        maxElapsedMs: s.policy.maxElapsedMs,
        resultSchema: s.registry.dataSchemas[d.resultSchemaId]!,
        deferredRequirements: [
          "Resolve the resource within the bound envelope before dispatch.",
        ],
      });
    return result;
  }
  function sequence(nodes: readonly PelNode[], c: Context): A {
    if (c.ordered) {
      let result = nil();
      for (const n of nodes) result = ev(n, c);
      return result;
    }
    const graph = analyzeSequence(nodes);
    if (graph.cycles.length && nodes[0])
      fail(
        "PEL_DEPENDENCY_CYCLE",
        nodes[0],
        "Automatic block contains a dependency cycle",
      );
    const done = new Map<number, A>();
    while (done.size < nodes.length) {
      let advanced = false;
      for (const row of graph.expressions)
        if (
          !done.has(row.index) &&
          row.dependencies.every((i) => done.has(i))
        ) {
          done.set(row.index, ev(nodes[row.index]!, c));
          advanced = true;
        }
      if (!advanced && nodes[0])
        fail(
          "PEL_DEPENDENCY_CYCLE",
          nodes[0],
          "Automatic block cannot make progress",
        );
    }
    return done.get(nodes.length - 1) ?? nil();
  }
  function invoke(f: F, raw: readonly PelNode[], n: PelNode, c: Context): A {
    tick(n, c);
    if (f.spec.kind === "sequence")
      return sequence(
        raw.length === 1 && raw[0]?.kind === "list" ? raw[0].items : raw,
        { ...c, env: scope(c.env), ordered: f.name === "do" },
      );
    const plan = planArguments(
      {
        argSpec: f.spec,
        boundArguments: f.bound,
      } as unknown as PelClosureValue,
      raw,
      n.span,
    );
    if (!plan.ok) throw new AnalysisFailure(plan.error);
    const bound = { ...f.bound };
    for (const p of plan.value)
      bound[p.name] =
        p.evaluation === "strict"
          ? { kind: "value", value: ev(p.node, c) }
          : {
              kind: "syntax",
              node: p.node,
              env: c.env,
              ...(c.caret ? { caret: c.caret } : {}),
            };
    const missing = f.spec.parameters.filter(
      (p) => p.required && !Object.hasOwn(bound, p.name),
    );
    if (missing.length) {
      if (f.name === "+" && missing.length === 1 && bound.x?.kind === "value") {
        const x = bound.x.value,
          cv = concrete(x);
        if (cv?.tag === "list") {
          const r = pureBuiltin("+", { x: cv }, n.span);
          if (!r.ok) throw new AnalysisFailure(r.error);
          return known(r.value, x.deps);
        }
        if (
          x.tag === "list" ||
          (x.tag === "unknown" && x.schema.type === "list")
        ) {
          const items =
            x.tag === "list"
              ? x.items
              : [
                  unknown(
                    x.schema.type === "list" ? x.schema.items : anySchema,
                    n.span,
                  ),
                ];
          for (const item of items) expect(item, ["number"], n);
          return unknown(
            {
              type: "number",
              integer: false,
              minimum: -Number.MAX_VALUE,
              maximum: Number.MAX_VALUE,
            },
            n.span,
            x.deps,
          );
        }
      }
      return { tag: "functions", choices: [{ ...f, bound }], deps: new Set() };
    }
    for (const p of f.spec.parameters)
      if (!Object.hasOwn(bound, p.name)) {
        if (p.evaluation === "syntax" && p.defaultExpression)
          bound[p.name] = {
            kind: "syntax",
            node: p.defaultExpression,
            env: f.env,
          };
        else
          bound[p.name] = {
            kind: "value",
            value:
              f.defaults[p.name] ??
              (p.defaultExpression
                ? ev(p.defaultExpression, { ...c, env: f.env })
                : nil()),
          };
      }
    const child = {
      ...c,
      depth: c.depth + 1,
      path: `${c.path}/${n.nodeId}/${ordinal++}`,
    };
    if (f.kind === "user") {
      if (c.structure) return unknown(anySchema, n.span);
      const env = scope(f.env);
      for (const [name, arg] of Object.entries(bound)) {
        env.set(name, val(arg, c));
        localNames.get(env)!.add(name);
      }
      return ev(f.body!, {
        ...child,
        env,
        ...(f.caret ? { caret: f.caret } : {}),
      });
    }
    if (f.kind === "host")
      return host(
        f,
        Object.fromEntries(
          Object.entries(bound).map(([name, b]) => [name, val(b, c)]),
        ),
        n,
        child,
      );
    if (f.name === "def") {
      const target = syntax(bound.name, n),
        rhs = syntax(bound.value, n);
      if (target.node.kind !== "symbol")
        fail("PEL_TYPE", n, "def name must be a symbol");
      const name = target.node.name;
      if (reserved.has(name) || localNames.get(target.env)?.has(name))
        fail("PEL_DUPLICATE_BINDING", n, `Binding ${name} already exists`);
      if (!localNames.has(target.env)) localNames.set(target.env, new Set());
      localNames.get(target.env)!.add(name);
      const cell: A = { tag: "cell", deps: new Set() };
      target.env.set(name, cell);
      const result = val(rhs, child);
      cell.value = result;
      target.env.set(name, result);
      return result;
    }
    if (f.name === "lambda") {
      const params = syntax(bound.params, n),
        body = syntax(bound.body, n);
      if (params.node.kind !== "list")
        fail("PEL_TYPE", n, "lambda requires an argument list");
      const names = new Set<string>();
      const parameters = [];
      const defaults: Record<string, A> = {};
      const capture = new Map(params.env);
      for (const p of params.node.items) {
        if (p.kind !== "pair" || names.has(p.key))
          fail("PEL_ARGUMENT_NAME", n, "Lambda parameters must be unique keys");
        names.add(p.key);
        parameters.push({
          name: p.key,
          required: !p.valuePresent,
          evaluation: "strict" as const,
          ...(p.valuePresent ? { defaultExpression: p.value } : {}),
        });
        if (p.valuePresent)
          defaults[p.key] = ev(p.value, {
            ...child,
            env: capture,
            ...(params.caret ? { caret: params.caret } : {}),
          });
      }
      const closure: F = {
        id: n.nodeId,
        spec: { kind: "fixed", parameters },
        kind: "user",
        name: "lambda",
        env: capture,
        bound: {},
        defaults,
        body: body.node,
        ...(body.caret ? { caret: body.caret } : {}),
      };
      const checkEnv = new Map(capture);
      for (const name of names) checkEnv.set(name, unknown(anySchema, n.span));
      ev(body.node, {
        ...child,
        env: checkEnv,
        structure: true,
        ...(body.caret ? { caret: body.caret } : {}),
      });
      return { tag: "functions", choices: [closure], deps: new Set() };
    }
    if (f.name === "if") {
      const condition = val(bound.cond, child);
      expect(condition, ["boolean"], n);
      const cv = concrete(condition),
        yes = syntax(bound.then, n),
        no = syntax(bound.else, n);
      if (cv?.tag === "boolean") {
        const selected = cv.value ? yes : no,
          dead = cv.value ? no : yes;
        ev(dead.node, {
          ...child,
          env: scope(dead.env, true),
          structure: true,
        });
        return val(selected, child);
      }
      return region(
        n,
        {
          ...child,
          controlDeps: new Set([
            ...(child.controlDeps ?? []),
            ...condition.deps,
          ]),
        },
        "unknown condition",
        1,
        (rc) => {
          const a = scope(yes.env, true),
            b = scope(no.env, true);
          const av = ev(yes.node, {
              ...rc,
              env: a,
              branch: `${n.nodeId}/then`,
            }),
            bv = ev(no.node, { ...rc, env: b, branch: `${n.nodeId}/else` });
          mergeEnvs(c.env, a, b, n);
          const result = merge(av, bv, n.span);
          return { ...result, deps: deps([result, condition]) };
        },
      );
    }
    if (f.name === "for") {
      const collection = val(bound.coll, child),
        iterator = syntax(bound.iterator, n),
        body = syntax(bound.body, n);
      if (iterator.node.kind !== "symbol")
        fail("PEL_TYPE", n, "for iterator must be a symbol");
      const name = iterator.node.name;
      expect(collection, ["list", "association"], n);
      const cv = concrete(collection);
      const items =
        collection.tag === "list"
          ? collection.items
          : cv?.tag === "list"
            ? cv.items.map((v) => known(v, collection.deps))
            : undefined;
      const one = (value: A, context: Context, index: number) => {
        if (
          !context.structure &&
          (iterations += context.multiplier ?? 1) > s.limits.maxIterations
        )
          fail("PEL_LIMIT", n, "Abstract iteration exceeds maxIterations");
        const env = scope(body.env);
        env.set(name, value);
        return ev(body.node, {
          ...context,
          env,
          path: `${context.path}/iteration/${index}`,
        });
      };
      if (
        items &&
        !c.structure &&
        items.length * (c.multiplier ?? 1) + iterations > s.limits.maxIterations
      )
        fail(
          "PEL_LIMIT",
          n,
          "Known collection exceeds the remaining iteration bound",
        );
      if (items)
        return {
          tag: "list",
          items: items.map((v, i) => one(v, child, i)),
          deps: collection.deps,
        };
      const schema =
        collection.tag === "unknown" ? collection.schema : anySchema;
      if (schema.type !== "list")
        fail(
          "PEL_DYNAMIC_EFFECT_UNBOUNDED",
          n,
          "Unknown collection needs a finite list schema",
        );
      const count = Math.min(schema.maxItems, s.limits.maxIterations);
      if (count === 0) {
        one(
          unknown(schema.items, n.span, collection.deps),
          { ...child, structure: true },
          0,
        );
        return { tag: "list", items: [], deps: collection.deps };
      }
      return region(n, child, "unknown collection", count, (rc) => {
        const item = one(unknown(schema.items, n.span, collection.deps), rc, 0);
        return unknown(
          {
            type: "list",
            items: item.tag === "unknown" ? item.schema : anySchema,
            minItems: 0,
            maxItems: count,
          },
          n.span,
          deps([item, collection]),
        );
      });
    }
    if (f.name === "case") {
      const scrut = val(bound.scrut, child),
        body = syntax(bound.body, n);
      if (body.node.kind !== "list" || body.node.items.length % 2 !== 0)
        fail("PEL_TYPE", n, "case requires condition/result pairs");
      const pairs = body.node.items;
      function next(index: number, context: Context): A {
        if (index >= pairs.length) return nil();
        const conditionNode = pairs[index]!,
          resultNode = pairs[index + 1]!;
        const conditionContext = { ...context, caret: scrut };
        const conditionExpression =
          !caretUsed(conditionNode, conditionContext) &&
          (conditionNode.kind === "call" || conditionNode.kind === "pipe")
            ? inject(conditionNode, scrut, conditionContext)
            : conditionNode;
        let condition = ev(conditionExpression, conditionContext);
        if (condition.tag === "functions")
          condition = applyValues(condition, [scrut], conditionNode, context);
        else {
          const v = concrete(condition);
          if (conditionNode.kind === "string") {
            const predicate = env.get("pel/nl-condition")!;
            condition = applyValues(
              predicate,
              [scrut, condition],
              conditionNode,
              context,
            );
          }
        }
        expect(condition, ["boolean"], conditionNode);
        const cv = concrete(condition);
        if (cv?.tag === "boolean") {
          if (cv.value) {
            next(index + 2, {
              ...context,
              env: scope(context.env, true),
              structure: true,
            });
            return ev(resultNode, context);
          }
          ev(resultNode, {
            ...context,
            env: scope(context.env, true),
            structure: true,
          });
          return next(index + 2, context);
        }
        return region(
          conditionNode,
          {
            ...context,
            controlDeps: new Set([
              ...(context.controlDeps ?? []),
              ...condition.deps,
            ]),
          },
          "unknown condition",
          1,
          (rc) => {
            const left = scope(rc.env, true),
              right = scope(rc.env, true);
            const a = ev(resultNode, {
                ...rc,
                env: left,
                branch: `${n.nodeId}/${index}`,
              }),
              b = next(index + 2, {
                ...rc,
                env: right,
                branch: `${n.nodeId}/rest/${index}`,
              });
            mergeEnvs(rc.env, left, right, n);
            return merge(a, b, n.span);
          },
        );
      }
      return next(0, child);
    }
    const values = Object.fromEntries(
      Object.entries(bound).map(([k, b]) => [k, val(b, child)]),
    );
    const numeric = ["+", "-", "*", "/", "pow", "sqrt", "gt", "lt"];
    if (numeric.includes(f.name))
      for (const v of Object.values(values)) expect(v, ["number"], n);
    if (f.name === "concat")
      for (const v of Object.values(values)) expect(v, ["string"], n);
    if (f.name === "not") expect(values.x!, ["boolean"], n);
    if (f.name === "len")
      expect(values.value!, ["list", "string", "association"], n);
    const concreteArgs = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, concrete(v)]),
    );
    if (Object.values(concreteArgs).every((v) => v !== undefined)) {
      const r = pureBuiltin(
        f.name,
        concreteArgs as Record<string, PelValue>,
        n.span,
      );
      if (r.ok) return known(r.value, deps(Object.values(values)));
      if (!c.structure || r.error.code !== "PEL_NUMERIC_DOMAIN")
        throw new AnalysisFailure(r.error);
    }
    return unknown(
      ["gt", "lt", "eq", "not"].includes(f.name)
        ? { type: "boolean" }
        : f.name === "concat"
          ? { type: "string", maxBytes: s.limits.maxValueBytes }
          : {
              type: "number",
              integer: false,
              minimum: -Number.MAX_VALUE,
              maximum: Number.MAX_VALUE,
            },
      n.span,
      deps(Object.values(values)),
    );
  }
  function applyValues(fn: A, values: A[], n: PelNode, c: Context): A {
    const env = new Map(c.env);
    const nodes = values.map((v, i) => {
      const name = `#abstract-argument-${i}`;
      env.set(name, v);
      return { ...n, kind: "symbol" as const, name };
    });
    return call(fn, nodes, n, { ...c, env });
  }
  function call(fn: A, raw: readonly PelNode[], n: PelNode, c: Context): A {
    c = { ...c, controlDeps: new Set([...(c.controlDeps ?? []), ...fn.deps]) };
    if (c.structure && fn.tag === "unknown" && fn.schema.type === "data") {
      const named = raw.filter((a) => a.kind === "pair").length;
      if (named !== 0 && named !== raw.length)
        fail(
          "PEL_ARGUMENT_MODE",
          n,
          "A call cannot mix named and positional arguments",
        );
      for (const argument of raw) ev(argument, c);
      return unknown(anySchema, n.span);
    }
    if (fn.tag === "cell") {
      if (fn.value) return call(fn.value, raw, n, c);
      if (c.structure) {
        for (const arg of raw) ev(arg, c);
        return unknown(anySchema, n.span);
      }
      fail(
        "PEL_UNINITIALIZED_BINDING",
        n,
        "Recursive binding is not initialized",
      );
    }
    if (fn.tag === "functions") {
      if (fn.choices.length === 1) return invoke(fn.choices[0]!, raw, n, c);
      return region(n, c, "unknown callable", 1, (rc) => {
        const values = fn.choices.map((f, i) =>
          invoke(f, raw, n, {
            ...rc,
            env: new Map(c.env),
            branch: `${n.nodeId}/callable/${i}`,
          }),
        );
        return values.reduce((a, b) => merge(a, b, n.span));
      });
    }
    const cv = concrete(fn);
    if (
      fn.tag === "list" ||
      cv?.tag === "list" ||
      (fn.tag === "unknown" &&
        (fn.schema.type === "list" || fn.schema.type === "association"))
    ) {
      const p = planArguments(
        {
          argSpec: builtinArgSpecs.list,
          boundArguments: {},
        } as unknown as PelClosureValue,
        raw,
        n.span,
      );
      if (!p.ok) throw new AnalysisFailure(p.error);
      const args = Object.fromEntries(
        p.value.map((a) => [a.name, ev(a.node, c)]),
      );
      const at = args.at && concrete(args.at);
      const from = args.from && concrete(args.from),
        to = args.to && concrete(args.to);
      if (
        at &&
        at.tag !== "nil" &&
        ((from && from.tag !== "nil") || (to && to.tag !== "nil"))
      )
        fail(
          "PEL_ARGUMENT_MODE",
          n,
          ":at cannot be combined with :from or :to",
        );
      if (
        (!args.at || at?.tag === "nil") &&
        (!args.from || from?.tag === "nil") &&
        (!args.to || to?.tag === "nil")
      )
        return fn;
      for (const v of [args.from, args.to])
        if (v && concrete(v)?.tag !== "nil") expect(v, ["number"], n);
      if (at?.tag === "list") {
        const items = at.items.map((selector) =>
          applyValues(fn, [known(selector)], n, c),
        );
        return {
          tag: "list",
          items,
          deps: deps([fn, ...items, ...Object.values(args)]),
        };
      }
      if (
        (!args.at || at?.tag === "nil") &&
        fn.tag === "unknown" &&
        fn.schema.type === "list"
      ) {
        for (const index of [from, to])
          if (
            index?.tag === "number" &&
            (!Number.isSafeInteger(index.value) ||
              index.value < 1 ||
              index.value > fn.schema.maxItems)
          )
            fail(
              "PEL_INDEX",
              n,
              "Slice index is outside every admitted collection length",
            );
        const first = from?.tag === "number" ? from.value : 1;
        const last = to?.tag === "number" ? to.value : fn.schema.maxItems;
        return unknown(
          {
            ...fn.schema,
            minItems: 0,
            maxItems: Math.max(0, last - first + 1),
          },
          n.span,
          deps([fn, ...Object.values(args)]),
        );
      }
      if (
        (!args.at || at?.tag === "nil") &&
        fn.tag === "list" &&
        Object.values(args).every((a) => concrete(a))
      ) {
        const indices = callableList(
          fn.items.map((_, i) => ({ tag: "number", value: i })),
          Object.fromEntries(
            Object.entries(args).map(([k, v]) => [k, concrete(v)!]),
          ),
          n.span,
        );
        if (!indices.ok) throw new AnalysisFailure(indices.error);
        if (indices.value.tag === "list")
          return {
            tag: "list",
            items: indices.value.items.map(
              (i) => fn.items[i.tag === "number" ? i.value : -1]!,
            ),
            deps: deps([fn, ...Object.values(args)]),
          };
      }
      if (
        fn.tag === "unknown" &&
        fn.schema.type === "list" &&
        at?.tag === "number" &&
        (!Number.isSafeInteger(at.value) ||
          at.value < 1 ||
          at.value > fn.schema.maxItems)
      )
        fail(
          "PEL_INDEX",
          n,
          "List index is outside every admitted collection length",
        );
      if (fn.tag === "list" && at?.tag === "key")
        return fn.items.find(
          (v) => v.tag === "pair" && v.key === at.name && v.value,
        )?.tag === "pair"
          ? (
              fn.items.find(
                (v) => v.tag === "pair" && v.key === at.name,
              ) as Extract<A, { tag: "pair" }>
            ).value
          : nil();
      if (fn.tag === "list" && at?.tag === "number") {
        if (
          !Number.isSafeInteger(at.value) ||
          at.value < 1 ||
          at.value > fn.items.length
        )
          fail("PEL_INDEX", n, "List index is out of bounds");
        return fn.items[at.value - 1]!;
      }
      if (cv?.tag === "list" && Object.values(args).every((a) => concrete(a))) {
        const r = callableList(
          cv.items,
          Object.fromEntries(
            Object.entries(args).map(([k, v]) => [k, concrete(v)!]),
          ),
          n.span,
        );
        if (!r.ok) throw new AnalysisFailure(r.error);
        return known(r.value, deps([fn, ...Object.values(args)]));
      }
      return unknown(
        fn.tag === "unknown" && fn.schema.type === "list"
          ? fn.schema.items
          : anySchema,
        n.span,
        deps([fn, ...Object.values(args)]),
      );
    }
    fail(
      "PEL_DYNAMIC_EFFECT_UNBOUNDED",
      n,
      "Callable target is not a known closure, list, or finite closure set",
    );
  }
  function ev(n: PelNode, c: Context): A {
    const result = evaluateNode(n, c);
    const value = concrete(result);
    if (
      value &&
      Buffer.byteLength(canonicalize(value)) > s.limits.maxValueBytes
    )
      fail("PEL_LIMIT", n, "Abstract value exceeds maxValueBytes");
    return result;
  }
  function evaluateNode(n: PelNode, c: Context): A {
    tick(n, c);
    switch (n.kind) {
      case "number":
      case "string":
      case "boolean":
        return known({ tag: n.kind, value: n.value } as PelValue);
      case "nil":
        return nil();
      case "key":
        return known({ tag: "key", name: n.name });
      case "symbol": {
        const v = c.env.get(n.name);
        if (!v) fail("PEL_UNBOUND_SYMBOL", n, `Unknown symbol ${n.name}`);
        if (v.tag === "conditional")
          fail(
            "PEL_CONDITIONAL_BINDING",
            n,
            `Binding ${n.name} exists on only some feasible branches`,
            v.origins,
          );
        if (v.tag === "cell" && v.value) return v.value;
        if (v.tag === "cell" && !c.structure)
          fail(
            "PEL_UNINITIALIZED_BINDING",
            n,
            `Binding ${n.name} is not initialized`,
          );
        return v;
      }
      case "caret":
        if (!c.caret) fail("PEL_CARET_SCOPE", n, "Caret has no pipeline value");
        return c.caret;
      case "quote":
        return n.expression.kind === "key"
          ? known({ tag: "key", name: n.expression.name })
          : known({ tag: "syntax", node: n.expression });
      case "pair": {
        const value = ev(n.value, c);
        return { tag: "pair", key: n.key, value, deps: value.deps };
      }
      case "list": {
        const items = n.items.map((i) => ev(i, c));
        return { tag: "list", items, deps: deps(items) };
      }
      case "call":
        if (!n.items[0]) fail("PEL_TYPE", n, "Call has no target");
        return call(ev(n.items[0], c), n.items.slice(1), n, c);
      case "pipe": {
        const left = ev(n.left, c);
        const context = { ...c, caret: left };
        return ev(
          caretUsed(n.right, context)
            ? n.right
            : inject(n.right, left, context),
          context,
        );
      }
    }
  }
  const env: Env = new Map();
  for (const [name, spec] of Object.entries(builtinArgSpecs))
    if (name !== "list")
      env.set(name, {
        tag: "functions",
        choices: [
          {
            id: `builtin:${name}`,
            kind: "builtin",
            name,
            spec,
            env: new Map(),
            bound: {},
            defaults: {},
          },
        ],
        deps: new Set(),
      });
  for (const d of s.registry.descriptors)
    env.set(d.name, {
      tag: "functions",
      choices: [
        {
          id: d.id,
          kind: "host",
          name: d.id,
          spec: d.argSpec,
          env: new Map(),
          bound: {},
          defaults: {},
        },
      ],
      deps: new Set(),
    });
  try {
    const result = sequence(program.expressions, {
      env,
      structure: false,
      depth: 0,
      path: "root",
      ordered: s.dependencyMode === "ordered",
    });
    return {
      finalValueSummary: summary(result),
      effects,
      dependencies,
      dynamicRegions,
      diagnostics: [],
      status: dynamicRegions.length ? "bounded-dynamic" : "static",
      consumed: { reductions, iterations },
    };
  } catch (error) {
    if (!(error instanceof AnalysisFailure)) throw error;
    return {
      finalValueSummary: {
        kind: "unresolved",
        reason: "Invalid program",
        originSpans: [error.diagnostic.span],
      },
      effects,
      dependencies,
      dynamicRegions,
      diagnostics: [error.diagnostic],
      status: dynamicRegions.length ? "bounded-dynamic" : "static",
      consumed: { reductions, iterations },
    };
  }
}
