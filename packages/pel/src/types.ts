import type { PelNode } from "./ast.js";
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type PelDataValue =
  | { readonly tag: "number"; readonly value: number }
  | { readonly tag: "string"; readonly value: string }
  | { readonly tag: "boolean"; readonly value: boolean }
  | { readonly tag: "nil" }
  | { readonly tag: "key"; readonly name: string }
  | { readonly tag: "pair"; readonly key: string; readonly value: PelDataValue }
  | { readonly tag: "list"; readonly items: readonly PelDataValue[] };
export type PelValue =
  | Exclude<PelDataValue, { tag: "pair" | "list" }>
  | { readonly tag: "pair"; readonly key: string; readonly value: PelValue }
  | { readonly tag: "list"; readonly items: readonly PelValue[] }
  | { readonly tag: "symbol"; readonly name: string }
  | { readonly tag: "syntax"; readonly node: PelNode }
  | PelClosureValue;
export type ArgParameterV1 = {
  readonly name: string;
  readonly required: boolean;
  readonly evaluation: "strict" | "syntax";
  readonly defaultExpression?: PelNode;
};
export type ArgSpecV1 =
  | { readonly kind: "fixed"; readonly parameters: readonly ArgParameterV1[] }
  | { readonly kind: "sequence" };
export type BoundArgumentV1 =
  | { readonly kind: "value"; readonly value: PelValue }
  | {
      readonly kind: "syntax";
      readonly node: PelNode;
      readonly environmentId: string;
      readonly caret?: PelValue;
    };
export type PelCallableV1 =
  | { readonly kind: "user"; readonly body: PelNode }
  | { readonly kind: "builtin"; readonly name: string }
  | { readonly kind: "host"; readonly registryId: string }
  | { readonly kind: "list"; readonly items: readonly PelValue[] };
export interface PelClosureValue {
  readonly tag: "closure";
  readonly nodeId: string;
  readonly sourceDigest: string;
  readonly environmentId: string;
  readonly callable: PelCallableV1;
  readonly argSpec: ArgSpecV1;
  readonly boundArguments: Readonly<Record<string, BoundArgumentV1>>;
  readonly defaults: Readonly<Record<string, PelValue>>;
  readonly caret?: PelValue;
}
export interface PelLimitsV1 {
  readonly maxSourceBytes: number;
  readonly maxTokens: number;
  readonly maxAstNodes: number;
  readonly maxSyntaxDepth: number;
  readonly maxReductions: number;
  readonly maxIterations: number;
  readonly maxCallDepth: number;
  readonly maxValueBytes: number;
}
export interface PelCounters {
  sourceBytes: number;
  tokens: number;
  astNodes: number;
  syntaxDepthPeak: number;
  reductions: number;
  iterations: number;
  callDepthPeak: number;
  valueBytesPeak: number;
}
export interface PelPredicateSelectionV1 {
  readonly profileId: string;
  readonly transportId: string;
  readonly controls: JsonValue;
  readonly credentialProfileRef: string;
  readonly outputSchemaId: string;
}
export interface PelRunOptionsV1 {
  readonly dependencyMode: "ordered" | "automatic";
  readonly nlConditionProfile: PelPredicateSelectionV1 | null;
  readonly nlConditionProfileDigest: string | null;
  readonly replay:
    | { readonly mode: "none" }
    | {
        readonly mode: "completed-prefix";
        readonly completedPrefixCount: number;
        readonly prefixDigest: string;
        readonly recordedCounters: PelCounters;
        readonly committedCounters: PelCounters;
        readonly maxReplayReductions: number;
      };
}
export interface PelEnvironmentRecordV1 {
  readonly id: string;
  parent?: string;
  bindings: Record<
    string,
    PelValue | { readonly tag: "uninitialized"; readonly cellId: string }
  >;
}
export interface PelEnvironmentTableV1 {
  readonly sourceDigest: string;
  readonly registryDigest: string;
  readonly optionsDigest: string;
  readonly records: Readonly<Record<string, PelEnvironmentRecordV1>>;
}
