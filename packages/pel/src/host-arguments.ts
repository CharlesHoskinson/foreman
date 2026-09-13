import { canonicalize, sha256Hex } from "@foreman/core";
import { diagnostic, type PelDiagnostic } from "./diagnostics.js";
import type {
  ArgSpecV1,
  BoundArgumentV1,
  PelEnvironmentTableV1,
  PelValue,
  Result,
} from "./types.js";
import { decodePelData } from "./values.js";

export const CODEC_MAX_BYTES = 16 * 1024 * 1024;
const span = { start: 0, end: 0, line: 1, column: 1, endLine: 1, endColumn: 1 };
export const codecFailure = (message: string): PelDiagnostic =>
  diagnostic("PEL_CONTINUATION_MISMATCH", span, message);
export const hashData = (value: unknown): string =>
  sha256Hex(canonicalize(value));
export const isText = (v: unknown): v is string =>
  typeof v === "string" &&
  v.isWellFormed() &&
  Buffer.byteLength(v) <= CODEC_MAX_BYTES;
export const isDigest = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export const isNatural = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export function isRecord(v: unknown): v is Record<string, unknown> {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype ||
      Object.getPrototypeOf(v) === null)
  );
}
export function exact(
  v: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): v is Record<string, unknown> {
  if (!isRecord(v)) return false;
  const ds = Object.getOwnPropertyDescriptors(v);
  return (
    Reflect.ownKeys(v).every(
      (k) =>
        typeof k === "string" &&
        (required.includes(k) || optional.includes(k)) &&
        ds[k]?.enumerable &&
        "value" in ds[k]!,
    ) && required.every((k) => Object.hasOwn(ds, k))
  );
}
/** Validate before reading properties; logical graph cycles use references, never object cycles. */
export function boundedJson(value: unknown): boolean {
  let nodes = 0,
    bytes = 0;
  const active = new Set<object>();
  function visit(v: unknown, depth: number): boolean {
    if (++nodes > 300000 || depth > 256) return false;
    if (v === null || typeof v === "boolean") return true;
    if (typeof v === "string") {
      bytes += Buffer.byteLength(v);
      return v.isWellFormed() && bytes <= CODEC_MAX_BYTES;
    }
    if (typeof v === "number")
      return (
        Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v))
      );
    if (typeof v !== "object" || v === null || active.has(v)) return false;
    const array = Array.isArray(v);
    if (array ? Object.getPrototypeOf(v) !== Array.prototype : !isRecord(v))
      return false;
    const ds = Object.getOwnPropertyDescriptors(v),
      keys = Reflect.ownKeys(v);
    if (array && keys.length !== (v as unknown[]).length + 1) return false;
    active.add(v);
    for (const k of keys) {
      if (array && k === "length") continue;
      if (
        typeof k !== "string" ||
        !k.isWellFormed() ||
        !ds[k]?.enumerable ||
        !("value" in ds[k]!)
      ) {
        active.delete(v);
        return false;
      }
      bytes += Buffer.byteLength(k);
      if (bytes > CODEC_MAX_BYTES || !visit(ds[k]!.value, depth + 1)) {
        active.delete(v);
        return false;
      }
    }
    active.delete(v);
    return true;
  }
  try {
    return (
      visit(value, 0) &&
      Buffer.byteLength(canonicalize(value)) <= CODEC_MAX_BYTES
    );
  } catch {
    return false;
  }
}
export interface ArgumentBindingsV1 {
  readonly sourceDigest: string;
  readonly registryDigest: string;
  readonly optionsDigest: string;
}
/** Structural validators operate only after boundedJson has rejected active objects. */
export function runtimeValidators(
  sourceDigest: string,
  environments: Readonly<Record<string, unknown>>,
) {
  const sourceNode = (id: unknown): boolean =>
    isText(id) &&
    (id.startsWith(`${sourceDigest}:`) ||
      /^(print:(sep|nl)|builtin:)/.test(id));
  const environment = (id: unknown): boolean =>
    typeof id === "string" && Object.hasOwn(environments, id);
  function node(n: unknown, depth = 0): boolean {
    if (
      depth > 256 ||
      !isRecord(n) ||
      !sourceNode(n.nodeId) ||
      !validSpan(n.span)
    )
      return false;
    const base = ["kind", "nodeId", "span"];
    switch (n.kind) {
      case "number":
        return (
          exact(n, [...base, "value"]) &&
          typeof n.value === "number" &&
          Number.isFinite(n.value) &&
          (!Number.isInteger(n.value) || Number.isSafeInteger(n.value))
        );
      case "string":
        return exact(n, [...base, "value"]) && isText(n.value);
      case "boolean":
        return exact(n, [...base, "value"]) && typeof n.value === "boolean";
      case "nil":
      case "caret":
        return exact(n, base);
      case "key":
      case "symbol":
        return exact(n, [...base, "name"]) && isText(n.name);
      case "list":
      case "call":
        return (
          exact(n, [...base, "items"]) &&
          Array.isArray(n.items) &&
          n.items.every((x) => node(x, depth + 1))
        );
      case "pair":
        return (
          exact(n, [...base, "key", "value", "valuePresent"]) &&
          isText(n.key) &&
          typeof n.valuePresent === "boolean" &&
          node(n.value, depth + 1)
        );
      case "quote":
        return (
          exact(n, [...base, "expression"]) && node(n.expression, depth + 1)
        );
      case "pipe":
        return (
          exact(n, [...base, "left", "right"]) &&
          node(n.left, depth + 1) &&
          node(n.right, depth + 1)
        );
      default:
        return false;
    }
  }
  function argSpec(s: unknown): s is ArgSpecV1 {
    if (exact(s, ["kind"]) && s.kind === "sequence") return true;
    if (
      !exact(s, ["kind", "parameters"]) ||
      s.kind !== "fixed" ||
      !Array.isArray(s.parameters)
    )
      return false;
    const names = new Set();
    return s.parameters.every((p) => {
      if (
        !exact(p, ["name", "required", "evaluation"], ["defaultExpression"]) ||
        !isText(p.name) ||
        !p.name ||
        names.has(p.name) ||
        typeof p.required !== "boolean" ||
        !["strict", "syntax"].includes(String(p.evaluation))
      )
        return false;
      names.add(p.name);
      return p.required
        ? !Object.hasOwn(p, "defaultExpression")
        : node(p.defaultExpression);
    });
  }
  function map(v: unknown, predicate: (x: unknown) => boolean): boolean {
    return isRecord(v) && Object.values(v).every(predicate);
  }
  function bound(b: unknown): b is BoundArgumentV1 {
    return exact(b, ["kind", "value"]) && b.kind === "value"
      ? value(b.value)
      : exact(b, ["kind", "node", "environmentId"], ["caret"]) &&
          b.kind === "syntax" &&
          node(b.node) &&
          environment(b.environmentId) &&
          (!Object.hasOwn(b, "caret") || value(b.caret));
  }
  function value(v: unknown, depth = 0): v is PelValue {
    if (depth > 256 || !isRecord(v)) return false;
    if (v.tag === "list")
      return (
        exact(v, ["tag", "items"]) &&
        Array.isArray(v.items) &&
        v.items.every((x) => value(x, depth + 1))
      );
    if (v.tag === "pair")
      return (
        exact(v, ["tag", "key", "value"]) &&
        isText(v.key) &&
        value(v.value, depth + 1)
      );
    if (v.tag === "symbol") return exact(v, ["tag", "name"]) && isText(v.name);
    if (v.tag === "syntax") return exact(v, ["tag", "node"]) && node(v.node);
    if (v.tag !== "closure") return decodePelData(v).ok;
    if (
      !exact(
        v,
        [
          "tag",
          "nodeId",
          "sourceDigest",
          "environmentId",
          "callable",
          "argSpec",
          "boundArguments",
          "defaults",
        ],
        ["caret"],
      ) ||
      v.sourceDigest !== sourceDigest ||
      !sourceNode(v.nodeId) ||
      !environment(v.environmentId) ||
      !argSpec(v.argSpec) ||
      !map(v.boundArguments, bound) ||
      !map(v.defaults, (x) => value(x, depth + 1)) ||
      (Object.hasOwn(v, "caret") && !value(v.caret, depth + 1))
    )
      return false;
    const spec = v.argSpec;
    if (spec.kind === "fixed") {
      const names = new Set(spec.parameters.map((p) => p.name));
      if (
        Object.keys(v.boundArguments as object).some((k) => !names.has(k)) ||
        Object.keys(v.defaults as object).some(
          (k) => !spec.parameters.some((p) => p.name === k && !p.required),
        )
      )
        return false;
    }
    const c = v.callable;
    return (
      (exact(c, ["kind", "body"]) && c.kind === "user" && node(c.body)) ||
      (exact(c, ["kind", "name"]) && c.kind === "builtin" && isText(c.name)) ||
      (exact(c, ["kind", "registryId"]) &&
        c.kind === "host" &&
        isText(c.registryId)) ||
      (exact(c, ["kind", "items"]) &&
        c.kind === "list" &&
        Array.isArray(c.items) &&
        c.items.every((x) => value(x, depth + 1)))
    );
  }
  return { node, argSpec, bound, value, map, environment, sourceNode };
}
export function validSpan(v: unknown): boolean {
  return (
    exact(v, ["start", "end", "line", "column", "endLine", "endColumn"]) &&
    Object.values(v).every(isNatural) &&
    (v.end as number) >= (v.start as number) &&
    (v.line as number) > 0 &&
    (v.column as number) > 0 &&
    (v.endLine as number) >= (v.line as number) &&
    (v.endColumn as number) > 0
  );
}
export function validEnvironmentTable(
  table: unknown,
): table is PelEnvironmentTableV1 {
  if (
    !exact(table, [
      "sourceDigest",
      "registryDigest",
      "optionsDigest",
      "records",
    ]) ||
    ![table.sourceDigest, table.registryDigest, table.optionsDigest].every(
      isDigest,
    ) ||
    !isRecord(table.records)
  )
    return false;
  const validate = runtimeValidators(
    table.sourceDigest as string,
    table.records,
  );
  for (const [id, e] of Object.entries(table.records)) {
    if (
      !exact(e, ["id", "bindings"], ["parent"]) ||
      e.id !== id ||
      !isRecord(e.bindings) ||
      (Object.hasOwn(e, "parent") && !validate.environment(e.parent))
    )
      return false;
    if (
      !Object.values(e.bindings).every(
        (v) =>
          (exact(v, ["tag", "cellId"]) &&
            v.tag === "uninitialized" &&
            isText(v.cellId)) ||
          validate.value(v),
      )
    )
      return false;
  }
  const complete = new Set<string>();
  for (const id of Object.keys(table.records)) {
    if (complete.has(id)) continue;
    const path = new Set<string>();
    let current: string | undefined = id;
    while (current !== undefined && !complete.has(current)) {
      if (path.has(current)) return false;
      path.add(current);
      current = (table.records[current] as { parent?: string }).parent;
    }
    for (const visited of path) complete.add(visited);
  }
  return true;
}
type Ref = { readonly ref: string };
export interface HostArgumentsEncodingV1 extends ArgumentBindingsV1 {
  readonly schemaVersion: 1;
  readonly arguments: readonly {
    readonly name: string;
    readonly value: unknown;
  }[];
  readonly nodes: readonly Record<string, unknown>[];
  readonly environmentDigest: string;
}
export interface DecodedHostArgumentsV1 {
  readonly boundArguments: Readonly<Record<string, PelValue>>;
  readonly environmentTable: PelEnvironmentTableV1;
}
export function encodeHostArgumentsV1(
  boundArguments: Readonly<Record<string, PelValue>>,
  environmentTable: PelEnvironmentTableV1,
): Result<HostArgumentsEncodingV1, PelDiagnostic> {
  try {
    if (
      !boundedJson({ boundArguments, environmentTable }) ||
      !validEnvironmentTable(environmentTable) ||
      !isRecord(boundArguments) ||
      !Object.values(boundArguments).every(
        runtimeValidators(
          environmentTable.sourceDigest,
          environmentTable.records,
        ).value,
      )
    )
      throw Error("invalid host arguments or environment");
    const nodes: Record<string, unknown>[] = [],
      objectIds = new Map<object, string>(),
      envIds = new Map<string, string>();
    const allocate = (): Record<string, unknown> => {
      const n: Record<string, unknown> = { id: `n${nodes.length}` };
      nodes.push(n);
      return n;
    };
    function env(id: string): Ref {
      const prior = envIds.get(id);
      if (prior) return { ref: prior };
      const n = allocate();
      envIds.set(id, n.id as string);
      const record = environmentTable.records[id]!;
      Object.assign(n, {
        kind: "environment",
        environmentId: id,
        ...(record.parent === undefined ? {} : { parent: env(record.parent) }),
        bindings: Object.keys(record.bindings)
          .sort(scalarCompare)
          .map((name) => ({
            name,
            value: val(record.bindings[name] as PelValue),
          })),
      });
      return { ref: n.id as string };
    }
    function bound(v: BoundArgumentV1): unknown {
      return v.kind === "value"
        ? { kind: "value", value: val(v.value) }
        : {
            kind: "syntax",
            node: v.node,
            environment: env(v.environmentId),
            ...(v.caret === undefined ? {} : { caret: val(v.caret) }),
          };
    }
    function val(v: PelValue): unknown {
      if (decodePelData(v).ok) return v;
      const existing = objectIds.get(v);
      if (existing) return { ref: existing };
      const n = allocate();
      objectIds.set(v, n.id as string);
      if (v.tag === "closure") {
        Object.assign(n, {
          kind: "closure-ref",
          sourceDigest: v.sourceDigest,
          nodeId: v.nodeId,
          environment: env(v.environmentId),
          argSpec: v.argSpec,
          argSpecDigest: hashData(v.argSpec),
          callable:
            v.callable.kind === "list"
              ? { kind: "list", items: v.callable.items.map(val) }
              : v.callable,
          boundArguments: (v.argSpec.kind === "fixed"
            ? v.argSpec.parameters.map((p) => p.name)
            : Object.keys(v.boundArguments)
          )
            .filter((name) => Object.hasOwn(v.boundArguments, name))
            .map((name) => ({ name, value: bound(v.boundArguments[name]!) })),
          defaults: Object.keys(v.defaults)
            .sort(scalarCompare)
            .map((name) => ({ name, value: val(v.defaults[name]!) })),
          ...(v.caret === undefined ? {} : { caret: val(v.caret) }),
        });
      } else if (v.tag === "syntax")
        Object.assign(n, {
          kind: "syntax-ref",
          sourceDigest: environmentTable.sourceDigest,
          nodeId: v.node.nodeId,
          node: v.node,
        });
      else if (v.tag === "list")
        Object.assign(n, { kind: "list", items: v.items.map(val) });
      else if (v.tag === "pair")
        Object.assign(n, { kind: "pair", key: v.key, value: val(v.value) });
      else if (v.tag === "symbol")
        Object.assign(n, { kind: "symbol", name: v.name });
      else
        Object.assign(n, {
          kind: "cell",
          cellId: (v as unknown as { cellId: string }).cellId,
        });
      return { ref: n.id as string };
    }
    const args = Object.entries(boundArguments).map(([name, value]) => ({
      name,
      value: val(value),
    }));
    const payload = {
      schemaVersion: 1 as const,
      sourceDigest: environmentTable.sourceDigest,
      registryDigest: environmentTable.registryDigest,
      optionsDigest: environmentTable.optionsDigest,
      arguments: args,
      nodes,
    };
    const environmentDigest = hashData(payload);
    for (const n of nodes)
      if (n.kind === "closure-ref") n.environmentDigest = environmentDigest;
    return { ok: true, value: { ...payload, environmentDigest } };
  } catch {
    return {
      ok: false,
      error: codecFailure("invalid host arguments or environment references"),
    };
  }
}
function scalarCompare(a: string, b: string): number {
  const aa = [...a],
    bb = [...b];
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    const diff = aa[i]!.codePointAt(0)! - bb[i]!.codePointAt(0)!;
    if (diff) return diff;
  }
  return aa.length - bb.length;
}
export function decodeHostArgumentsV1(
  encoding: unknown,
  bindings: ArgumentBindingsV1,
): Result<DecodedHostArgumentsV1, PelDiagnostic> {
  try {
    if (
      !boundedJson(encoding) ||
      !exact(encoding, [
        "schemaVersion",
        "sourceDigest",
        "registryDigest",
        "optionsDigest",
        "arguments",
        "nodes",
        "environmentDigest",
      ]) ||
      encoding.schemaVersion !== 1 ||
      !Array.isArray(encoding.arguments) ||
      !Array.isArray(encoding.nodes) ||
      !isDigest(encoding.environmentDigest) ||
      !(["sourceDigest", "registryDigest", "optionsDigest"] as const).every(
        (k) => isDigest(bindings[k]) && encoding[k] === bindings[k],
      )
    )
      throw Error("identity");
    const { environmentDigest, ...payload } = encoding;
    const bareNodes = encoding.nodes.map((n) => {
      if (!isRecord(n)) throw Error("node");
      const copy = { ...n };
      delete copy.environmentDigest;
      return copy;
    });
    if (hashData({ ...payload, nodes: bareNodes }) !== environmentDigest)
      throw Error("digest");
    const table = new Map<string, Record<string, unknown>>();
    encoding.nodes.forEach((n, i) => {
      if (!isRecord(n) || n.id !== `n${i}`) throw Error("node ID");
      table.set(n.id as string, n);
    });
    const environments: Record<string, any> = Object.create(null),
      memo = new Map<string, any>(),
      activeValues = new Set<string>();
    function ref(x: unknown): Record<string, unknown> {
      if (!exact(x, ["ref"]) || typeof x.ref !== "string" || !table.has(x.ref))
        throw Error("reference");
      return table.get(x.ref)!;
    }
    function env(x: unknown): string {
      const n = ref(x);
      if (
        !exact(n, ["id", "kind", "environmentId", "bindings"], ["parent"]) ||
        n.kind !== "environment" ||
        !isText(n.environmentId)
      )
        throw Error("environment");
      if (memo.has(n.id as string)) return n.environmentId;
      if (Object.hasOwn(environments, n.environmentId))
        throw Error("duplicate environment");
      const e: any = { id: n.environmentId, bindings: Object.create(null) };
      environments[n.environmentId] = e;
      memo.set(n.id as string, e);
      if (n.parent !== undefined) e.parent = env(n.parent);
      e.bindings = entries(n.bindings, val);
      return e.id;
    }
    function entries(
      xs: unknown,
      decode: (v: unknown) => unknown,
    ): Record<string, any> {
      if (!Array.isArray(xs)) throw Error("entries");
      const out = Object.create(null);
      for (const x of xs) {
        if (
          !exact(x, ["name", "value"]) ||
          !isText(x.name) ||
          Object.hasOwn(out, x.name)
        )
          throw Error("entry");
        out[x.name] = decode(x.value);
      }
      return out;
    }
    function bound(x: unknown): unknown {
      if (exact(x, ["kind", "value"]) && x.kind === "value")
        return { kind: "value", value: val(x.value) };
      if (
        !exact(x, ["kind", "node", "environment"], ["caret"]) ||
        x.kind !== "syntax"
      )
        throw Error("bound");
      return {
        kind: "syntax",
        node: x.node,
        environmentId: env(x.environment),
        ...(x.caret === undefined ? {} : { caret: val(x.caret) }),
      };
    }
    function val(x: unknown): any {
      const data = decodePelData(x);
      if (data.ok) return data.value;
      const n = ref(x),
        id = n.id as string;
      if (memo.has(id)) {
        if (activeValues.has(id)) throw Error("physical value cycle");
        return memo.get(id);
      }
      const out: any = {};
      memo.set(id, out);
      activeValues.add(id);
      switch (n.kind) {
        case "closure-ref": {
          if (
            !exact(
              n,
              [
                "id",
                "kind",
                "sourceDigest",
                "nodeId",
                "environment",
                "argSpec",
                "argSpecDigest",
                "callable",
                "boundArguments",
                "defaults",
                "environmentDigest",
              ],
              ["caret"],
            ) ||
            n.environmentDigest !== environmentDigest ||
            hashData(n.argSpec) !== n.argSpecDigest ||
            n.sourceDigest !== bindings.sourceDigest
          )
            throw Error("closure");
          // Permit the environment's lexical self reference to this completed closure shell.
          activeValues.delete(id);
          Object.assign(out, {
            tag: "closure",
            sourceDigest: n.sourceDigest,
            nodeId: n.nodeId,
            argSpec: n.argSpec,
            environmentId: env(n.environment),
          });
          activeValues.add(id);
          const c = n.callable as any;
          Object.assign(out, {
            callable:
              c?.kind === "list"
                ? { kind: "list", items: c.items.map(val) }
                : c,
            boundArguments: entries(n.boundArguments, bound),
            defaults: entries(n.defaults, val),
            ...(n.caret === undefined ? {} : { caret: val(n.caret) }),
          });
          break;
        }
        case "syntax-ref":
          if (
            !exact(n, ["id", "kind", "sourceDigest", "nodeId", "node"]) ||
            n.sourceDigest !== bindings.sourceDigest ||
            (n.node as any)?.nodeId !== n.nodeId
          )
            throw Error("syntax");
          Object.assign(out, { tag: "syntax", node: n.node });
          break;
        case "list":
          if (!exact(n, ["id", "kind", "items"]) || !Array.isArray(n.items))
            throw Error("list");
          Object.assign(out, { tag: "list", items: n.items.map(val) });
          break;
        case "pair":
          if (!exact(n, ["id", "kind", "key", "value"])) throw Error("pair");
          Object.assign(out, { tag: "pair", key: n.key, value: val(n.value) });
          break;
        case "symbol":
          if (!exact(n, ["id", "kind", "name"])) throw Error("symbol");
          Object.assign(out, { tag: "symbol", name: n.name });
          break;
        case "cell":
          if (!exact(n, ["id", "kind", "cellId"])) throw Error("cell");
          Object.assign(out, { tag: "uninitialized", cellId: n.cellId });
          break;
        default:
          throw Error("value node");
      }
      activeValues.delete(id);
      return out;
    }
    const boundArguments = entries(encoding.arguments, val),
      environmentTable = { ...bindings, records: environments };
    const encoded = encodeHostArgumentsV1(boundArguments, environmentTable);
    if (!encoded.ok || canonicalize(encoded.value) !== canonicalize(encoding))
      throw Error("noncanonical or forged graph");
    return { ok: true, value: { boundArguments, environmentTable } };
  } catch {
    return {
      ok: false,
      error: codecFailure(
        "invalid host argument encoding, digest or references",
      ),
    };
  }
}
