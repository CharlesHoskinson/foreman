import type { PelNode, PelProgram, SourceSpan } from "./ast.js";
import type { PelDataSchemaV1 } from "./host-contract.js";
import type { PelDataValue, PelLimitsV1 } from "./types.js";
import type {
  AuthoringDiagnostic,
  AuthoringModelSelectionV1,
  AuthoringSnapshotV1,
  PlanBindingV1,
} from "./authoring-types.js";
import type { PelProfileV1 } from "./profile.js";
export type ValueSummaryV1 =
  | { readonly kind: "known"; readonly value: PelDataValue }
  | {
      readonly kind: "unresolved";
      readonly schemaId?: string;
      readonly schema?: PelDataSchemaV1;
      readonly reason: string;
      readonly originSpans: readonly SourceSpan[];
    }
  | {
      readonly kind: "callable";
      readonly codeReferences: readonly string[];
      readonly remainingArguments: readonly string[];
    };
export interface PreviewEffectV1 {
  readonly effectId: string;
  readonly nodeId: string;
  readonly invocationPath: string;
  readonly span: SourceSpan;
  readonly registryId: string;
  readonly arguments: Readonly<Record<string, ValueSummaryV1>>;
  readonly model: AuthoringModelSelectionV1 | null;
  readonly controlsSource: "default" | "explicit" | null;
  readonly capabilities: readonly string[];
  readonly resources: {
    readonly reads: readonly string[];
    readonly writes: readonly string[];
    readonly unknown: boolean;
  };
  readonly gates: readonly string[];
  readonly regionId?: string;
  readonly branch?: string;
}
export interface PreviewDependencyV1 {
  readonly from: string;
  readonly to: string;
  readonly kind: "value" | "order" | "serialization";
  readonly reason: string;
}
export interface DynamicRegionV1 {
  readonly regionId: string;
  readonly spans: readonly SourceSpan[];
  readonly reason:
    | "unknown condition"
    | "unknown collection"
    | "unknown callable"
    | "unknown argument";
  readonly possibleRegistryIds: readonly string[];
  readonly models: readonly {
    readonly profileId: string;
    readonly transportId: string;
  }[];
  readonly capabilities: readonly string[];
  readonly resources: {
    readonly reads: readonly string[];
    readonly writes: readonly string[];
  };
  readonly maxIterations: number;
  readonly maxCalls: number;
  readonly maxOutputBytes: number;
  readonly maxCostUnits: number;
  readonly maxElapsedMs: number;
  readonly resultSchema: PelDataSchemaV1;
  readonly deferredRequirements: readonly string[];
}
export interface PelAnalysisV1 {
  readonly finalValueSummary: ValueSummaryV1;
  readonly effects: readonly PreviewEffectV1[];
  readonly dependencies: readonly PreviewDependencyV1[];
  readonly dynamicRegions: readonly DynamicRegionV1[];
  readonly diagnostics: readonly AuthoringDiagnostic[];
  readonly status: "static" | "bounded-dynamic";
  readonly consumed: {
    readonly reductions: number;
    readonly iterations: number;
  };
}
export interface CheckedProgramV1 {
  readonly source: Uint8Array;
  readonly sourceDigest: string;
  readonly program: PelProgram;
  readonly normalizedAst: readonly unknown[];
  readonly languageProfile: PelProfileV1;
  readonly snapshot: AuthoringSnapshotV1;
  readonly binding: PlanBindingV1;
  readonly bindingDigest: string;
  readonly optionsDigest: string;
  readonly analysis: PelAnalysisV1;
}
export interface PlanPreviewV1 extends PelAnalysisV1 {
  readonly schemaVersion: 1;
  readonly binding: PlanBindingV1;
  readonly bindingDigest: string;
  readonly limits: PelLimitsV1;
}
export interface CheckInputV1 {
  readonly source: Uint8Array;
  readonly snapshot: AuthoringSnapshotV1;
  readonly profile?: PelProfileV1;
}
export type CheckResultV1 =
  | {
      readonly tag: "ok";
      readonly checked: CheckedProgramV1;
      readonly warnings: readonly AuthoringDiagnostic[];
    }
  | {
      readonly tag: "invalid";
      readonly diagnostics: readonly AuthoringDiagnostic[];
    };
export interface AnalysisInputV1 {
  readonly program: PelProgram;
  readonly snapshot: AuthoringSnapshotV1;
}
export type AnalysisNode = PelNode;
