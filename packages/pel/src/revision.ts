import { canonicalize, sha256Hex } from "@foreman/core";
import type { PelNode, PelProgram, SourceSpan } from "./ast.js";
import { diagnostic, type PelDiagnostic } from "./diagnostics.js";
import {
  decodeHostArgumentsV1,
  encodeHostArgumentsV1,
  type HostArgumentsEncodingV1,
} from "./host-arguments.js";
import type {
  JsonValue,
  PelDataValue,
  PelEnvironmentTableV1,
  PelValue,
  Result,
} from "./types.js";
import { encodePelData } from "./values.js";

export interface RecordedRevisionCallV1 {
  readonly oldRequestId: string;
  readonly nodeId: string;
  readonly invocationPath: string;
  readonly boundArguments: Readonly<Record<string, PelValue>>;
  readonly environmentTable?: PelEnvironmentTableV1;
}

export interface PelRevisionNodeMappingV1 {
  readonly path: string;
  readonly oldNodeId: string;
  readonly newNodeId: string;
}

interface PelRevisionCallMappingBaseV1 {
  readonly oldRequestId: string;
  readonly oldNodeId: string;
  readonly newNodeId: string;
  readonly nodePath: string;
  readonly invocationPath: string;
  readonly boundArgumentsDigest: string;
}

export type PelRevisionCallMappingV1 = PelRevisionCallMappingBaseV1 &
  (
    | {
        readonly argumentKind: "data";
        readonly boundArguments: Readonly<Record<string, PelDataValue>>;
        readonly argumentEncoding?: never;
      }
    | {
        readonly argumentKind: "internal";
        readonly argumentEncoding: HostArgumentsEncodingV1;
        readonly boundArguments?: never;
      }
  );

export interface PelRevisionPrefixV1 {
  readonly completedPrefixCount: number;
  readonly oldSourceDigest: string;
  readonly newSourceDigest: string;
  readonly prefixDigest: string;
  readonly nodeMappings: readonly PelRevisionNodeMappingV1[];
  readonly callMappings: readonly PelRevisionCallMappingV1[];
}

const neutralSpan: SourceSpan = {
  start: 0,
  end: 0,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
};

function mismatch(
  span: SourceSpan,
  message: string,
): Result<never, PelDiagnostic> {
  return {
    ok: false,
    error: diagnostic("PEL_CONTINUATION_MISMATCH", span, message),
  };
}

export function normalizePelNode(node: PelNode): JsonValue {
  switch (node.kind) {
    case "number":
      return {
        kind: "number",
        value: Object.is(node.value, -0) ? 0 : node.value,
      };
    case "string":
      return { kind: "string", value: node.value };
    case "boolean":
      return { kind: "boolean", value: node.value };
    case "nil":
      return { kind: "nil" };
    case "key":
      return { kind: "key", name: node.name };
    case "symbol":
      return { kind: "symbol", name: node.name };
    case "caret":
      return { kind: "caret" };
    case "pair":
      return {
        kind: "pair",
        key: node.key,
        value: normalizePelNode(node.value),
        valuePresent: node.valuePresent,
      };
    case "list":
      return { kind: "list", items: node.items.map(normalizePelNode) };
    case "call":
      return { kind: "call", items: node.items.map(normalizePelNode) };
    case "quote":
      return { kind: "quote", expression: normalizePelNode(node.expression) };
    case "pipe":
      return {
        kind: "pipe",
        left: normalizePelNode(node.left),
        right: normalizePelNode(node.right),
      };
  }
}

function nodeChildren(node: PelNode): readonly PelNode[] {
  switch (node.kind) {
    case "pair":
      return [node.value];
    case "list":
    case "call":
      return node.items;
    case "quote":
      return [node.expression];
    case "pipe":
      return [node.left, node.right];
    default:
      return [];
  }
}

function collectMappings(
  oldNode: PelNode,
  newNode: PelNode,
  path: string,
  mappings: PelRevisionNodeMappingV1[],
): void {
  mappings.push({ path, oldNodeId: oldNode.nodeId, newNodeId: newNode.nodeId });
  const oldChildren = nodeChildren(oldNode);
  const newChildren = nodeChildren(newNode);
  for (let index = 0; index < oldChildren.length; index += 1) {
    const oldChild = oldChildren[index];
    const newChild = newChildren[index];
    if (oldChild !== undefined && newChild !== undefined) {
      collectMappings(oldChild, newChild, `${path}.${String(index)}`, mappings);
    }
  }
}

function hasValidUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function encodeBoundArguments(
  input: Readonly<Record<string, PelValue>>,
  environmentTable: PelEnvironmentTableV1 | undefined,
  sourceDigest: string,
  span: SourceSpan,
): Result<
  | {
      readonly argumentKind: "data";
      readonly boundArguments: Readonly<Record<string, PelDataValue>>;
      readonly boundArgumentsDigest: string;
    }
  | {
      readonly argumentKind: "internal";
      readonly argumentEncoding: HostArgumentsEncodingV1;
      readonly boundArgumentsDigest: string;
    },
  PelDiagnostic
> {
  try {
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null)
      return mismatch(span, "recorded bound arguments must be a plain record");
    if (Object.getOwnPropertySymbols(input).length !== 0)
      return mismatch(span, "recorded bound arguments contain symbol fields");
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const values: Record<string, PelValue> = Object.create(null) as Record<
      string,
      PelValue
    >;
    const data: Record<string, PelDataValue> = Object.create(null) as Record<
      string,
      PelDataValue
    >;
    let dataOnly = true;
    for (const name of Object.keys(descriptors)) {
      const descriptor = descriptors[name];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        !hasValidUnicode(name)
      ) {
        return mismatch(
          span,
          "recorded bound arguments contain an unsafe field",
        );
      }
      const value = descriptor.value as PelValue;
      values[name] = value;
      const encoded = encodePelData(value);
      if (encoded.ok) data[name] = encoded.value;
      else dataOnly = false;
    }
    if (dataOnly) {
      return {
        ok: true,
        value: {
          argumentKind: "data",
          boundArguments: data,
          boundArgumentsDigest: sha256Hex(canonicalize(data)),
        },
      };
    }
    if (environmentTable === undefined) {
      return mismatch(
        span,
        "recorded internal arguments require their lexical environment table",
      );
    }
    if (environmentTable.sourceDigest !== sourceDigest) {
      return mismatch(
        span,
        "recorded argument environment belongs to another source",
      );
    }
    const encoded = encodeHostArgumentsV1(values, environmentTable);
    if (!encoded.ok) {
      return mismatch(
        span,
        "recorded internal arguments or environment references are invalid",
      );
    }
    const decoded = decodeHostArgumentsV1(encoded.value, {
      sourceDigest,
      registryDigest: environmentTable.registryDigest,
      optionsDigest: environmentTable.optionsDigest,
    });
    if (!decoded.ok) {
      return mismatch(
        span,
        "recorded internal argument encoding does not match its bindings",
      );
    }
    return {
      ok: true,
      value: {
        argumentKind: "internal",
        argumentEncoding: encoded.value,
        boundArgumentsDigest: sha256Hex(canonicalize(encoded.value)),
      },
    };
  } catch {
    return mismatch(
      span,
      "recorded bound arguments could not be inspected safely",
    );
  }
}

function topExpressionFromInvocationPath(path: string): number | undefined {
  const match = /^root\/expression\/(\d+)(?:\/|$)/.exec(path);
  if (match?.[1] === undefined) return undefined;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) ? index : undefined;
}

export function validateRevisionPrefix(
  oldProgram: PelProgram,
  newProgram: PelProgram,
  completedPrefixCount: number,
  recordedCalls: readonly RecordedRevisionCallV1[],
): Result<PelRevisionPrefixV1, PelDiagnostic> {
  if (
    !Number.isSafeInteger(completedPrefixCount) ||
    completedPrefixCount < 0 ||
    completedPrefixCount > oldProgram.expressions.length ||
    completedPrefixCount > newProgram.expressions.length
  ) {
    return mismatch(
      newProgram.expressions[0]?.span ?? neutralSpan,
      "completed prefix count does not name whole top-level forms",
    );
  }
  if (
    oldProgram.profileId !== newProgram.profileId ||
    oldProgram.profileDigest !== newProgram.profileDigest
  ) {
    return mismatch(
      newProgram.expressions[0]?.span ?? neutralSpan,
      "Pel profile changed across the revision",
    );
  }

  const normalizedPrefix: JsonValue[] = [];
  const nodeMappings: PelRevisionNodeMappingV1[] = [];
  for (let index = 0; index < completedPrefixCount; index += 1) {
    const oldNode = oldProgram.expressions[index];
    const newNode = newProgram.expressions[index];
    if (oldNode === undefined || newNode === undefined) {
      return mismatch(
        newNode?.span ?? newProgram.expressions[0]?.span ?? neutralSpan,
        "completed prefix is incomplete",
      );
    }
    const oldNormalized = normalizePelNode(oldNode);
    const newNormalized = normalizePelNode(newNode);
    if (canonicalize(oldNormalized) !== canonicalize(newNormalized)) {
      return mismatch(
        newNode.span,
        `completed top-level form ${String(index)} changed`,
      );
    }
    normalizedPrefix.push(oldNormalized);
    collectMappings(oldNode, newNode, String(index), nodeMappings);
  }

  const mappingsByOldNodeId = new Map(
    nodeMappings.map((mapping) => [mapping.oldNodeId, mapping] as const),
  );
  const seenRequests = new Set<string>();
  const seenInvocations = new Set<string>();
  const callMappings: PelRevisionCallMappingV1[] = [];
  for (const recorded of recordedCalls) {
    if (
      recorded.oldRequestId.length === 0 ||
      seenRequests.has(recorded.oldRequestId)
    ) {
      return mismatch(
        oldProgram.expressions[0]?.span ?? neutralSpan,
        "recorded call identity is empty or duplicated",
      );
    }
    const nodeMapping = mappingsByOldNodeId.get(recorded.nodeId);
    if (nodeMapping === undefined) {
      return mismatch(
        oldProgram.expressions[0]?.span ?? neutralSpan,
        "recorded call node is outside the completed prefix",
      );
    }
    const topExpression = topExpressionFromInvocationPath(
      recorded.invocationPath,
    );
    const mappedTopExpression = Number(nodeMapping.path.split(".")[0]);
    if (
      topExpression === undefined ||
      topExpression >= completedPrefixCount ||
      topExpression !== mappedTopExpression
    ) {
      return mismatch(
        oldProgram.expressions[topExpression ?? 0]?.span ?? neutralSpan,
        "recorded invocation path does not match its completed form",
      );
    }
    const invocationIdentity = `${recorded.nodeId}\u0000${recorded.invocationPath}`;
    if (seenInvocations.has(invocationIdentity)) {
      return mismatch(
        oldProgram.expressions[topExpression]?.span ?? neutralSpan,
        "recorded invocation path is duplicated",
      );
    }
    const boundArguments = encodeBoundArguments(
      recorded.boundArguments,
      recorded.environmentTable,
      oldProgram.sourceDigest,
      oldProgram.expressions[topExpression]?.span ?? neutralSpan,
    );
    if (!boundArguments.ok) return boundArguments;
    seenRequests.add(recorded.oldRequestId);
    seenInvocations.add(invocationIdentity);
    callMappings.push({
      oldRequestId: recorded.oldRequestId,
      oldNodeId: recorded.nodeId,
      newNodeId: nodeMapping.newNodeId,
      nodePath: nodeMapping.path,
      invocationPath: recorded.invocationPath,
      ...boundArguments.value,
    });
  }

  return {
    ok: true,
    value: {
      completedPrefixCount,
      oldSourceDigest: oldProgram.sourceDigest,
      newSourceDigest: newProgram.sourceDigest,
      prefixDigest: sha256Hex(canonicalize(normalizedPrefix)),
      nodeMappings,
      callMappings,
    },
  };
}
