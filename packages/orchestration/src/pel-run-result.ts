import { hashAuthoringContent, isPelDataValue, validateDataSchema, verifyRegistry, type HostRegistryV1, type PelDataValue, type Result, type SourceSpan } from "@foreman/pel";
import { decodeAttemptId, decodeLaneId } from "@foreman/event-log";
import { normalizeUsage } from "@foreman/providers";
import type { ProviderUsageV1 } from "@foreman/providers";
import type { ExecutionMilestone } from "./execution-contract.js";
import { decodePelArtifactRefV1, decodePelReceiptRefV1, decodeRunStatusV1, decodePelResultContractV1, type ExecutionBindingV1, type ExternalOutcomeV1, type PelContractDecodeFailureV1, type PelRunDiagnosticV1, type RunResultV1 } from "./pel-run-contract.js";

export interface PelFinalClassification {
  readonly state: "succeeded" | "needs-action" | "failed";
  readonly resumeMode?: "pending-effect" | "final-value";
  readonly diagnostics: readonly PelRunDiagnosticV1[];
}
export interface PelFinalClassificationInput {
  readonly binding: Pick<ExecutionBindingV1, "registryDigest" | "resultContract" | "requiredMilestones">;
  readonly value: PelDataValue;
  readonly registry: HostRegistryV1;
  /** Current validated host records only. Provider output is not evidence. */
  readonly hostEvidence: { readonly milestones: readonly ExecutionMilestone[]; readonly receiptRefs: readonly string[]; readonly receiptCandidates?: Readonly<Record<string, string>> };
  readonly externalOutcome: ExternalOutcomeV1;
  readonly pendingEffects: number;
  readonly now: number;
  readonly sourceSpan?: SourceSpan;
}
function fields(value: PelDataValue): ReadonlyMap<string, PelDataValue> {
  return new Map(value.tag === "list" ? value.items.filter(v => v.tag === "pair").map(v => [v.key, v.value]) : []);
}
const stringValue = (value: PelDataValue | undefined): string | undefined => value?.tag === "string" ? value.value : undefined;
export function classifyPelFinalResult(input: PelFinalClassificationInput): PelFinalClassification {
  const diagnostic = (code: string, message: string, nextAction: string): PelRunDiagnosticV1 => ({ code, message, sourceSpan: input.sourceSpan ?? null, effectId: null, retryable: false, nextAction, evidenceRefs: [] });
  const schema = input.registry.dataSchemas[input.binding.resultContract.schemaId];
  if (!decodePelResultContractV1(input.binding.resultContract).ok || !verifyRegistry(input.registry) || input.registry.digest !== input.binding.registryDigest || !schema || hashAuthoringContent(schema) !== input.binding.resultContract.schemaSha256 || !validateDataSchema(input.value, schema))
    return { state: "failed", diagnostics: [diagnostic("final-result-invalid", "The final value does not satisfy the bound result schema", "Correct the final expression under the admitted result contract.")] };
  if (input.pendingEffects > 0 || input.externalOutcome === "pending" || input.externalOutcome === "unknown")
    return { state: "needs-action", resumeMode: "pending-effect", diagnostics: [diagnostic("reconciliation-required", "An external effect remains unresolved", "Reconcile the recorded effect before resuming.")] };
  const missing = input.binding.requiredMilestones.filter(m => !input.hostEvidence.milestones.includes(m));
  let negative = false, missingReceipt = false;
  if (input.binding.resultContract.classification === "delivery-v1") {
    let deliveryCandidate: string | undefined;
    const inspect = (value: PelDataValue, depth: number): void => {
      if (depth > 8) { missingReceipt = true; return; }
      const row = fields(value), status = stringValue(row.get("status"));
      const candidate = stringValue(row.get('candidate'));
      if (candidate !== undefined) {
        if (deliveryCandidate !== undefined && candidate !== deliveryCandidate) missingReceipt = true;
        deliveryCandidate ??= candidate;
      }
      if (["needs-action", "verification-failed", "changes-requested", "unverified"].includes(status ?? "")) negative = true;
      const passed = row.get("passed"), approved = row.get("approved");
      if (passed?.tag === "boolean" && !passed.value || approved?.tag === "boolean" && !approved.value) negative = true;
      if (status === "approved" && stringValue(row.get("verdict")) !== "approved") negative = true;
      const referenceKey = status === "verified" ? "verification" : status === "approved" ? "review" : status === "published" ? "publication" : status === "candidate-ready" ? "implementation-receipt" : undefined;
      if (referenceKey) {
        const ref = stringValue(row.get(referenceKey));
        if (!ref || !candidate || !input.hostEvidence.receiptRefs.includes(ref) || input.hostEvidence.receiptCandidates?.[ref] !== candidate) missingReceipt = true;
        const milestone = status === "verified" ? "checks" : status === "approved" ? "audit" : status === "published" ? "published" : undefined;
        if (milestone && !input.hostEvidence.milestones.includes(milestone)) missingReceipt = true;
      }
      for (const key of ["task", "verification", "delivery"]) {
        const nested = row.get(key);
        if (nested?.tag === "list") inspect(nested, depth + 1);
      }
    };
    inspect(input.value, 0);
  }
  if (negative || missingReceipt || missing.length)
    return { state: "needs-action", resumeMode: "final-value", diagnostics: [diagnostic("reconciliation-required", missing.length ? `Required host milestones are absent: ${missing.join(", ")}` : missingReceipt ? "The result lacks matching current host receipts" : "The validated delivery result requires further work", "Inspect the final result and host evidence; this terminal value cannot redispatch completed effects.")] };
  return { state: "succeeded", diagnostics: [] };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).every(key => typeof key === "string" && "value" in Object.getOwnPropertyDescriptor(value, key)!);
}
const exact = (value: Record<string, unknown>, names: readonly string[]) => Object.keys(value).length === names.length && names.every(key => Object.hasOwn(value, key));
const natural = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const text = (value: unknown): value is string => typeof value === "string" && value.isWellFormed() && Buffer.byteLength(value) <= 16384;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const array = (value: unknown): value is unknown[] => Array.isArray(value) && value.length <= 100000 && Object.keys(value).length === value.length;
function span(value: unknown): boolean {
  return value === null || object(value) && exact(value, ["start", "end", "line", "column", "endLine", "endColumn"]) && Object.values(value).every(natural) && (value.end as number) >= (value.start as number) && (value.line as number) > 0 && (value.column as number) > 0 && (value.endLine as number) >= (value.line as number) && (value.endColumn as number) > 0;
}
/** Validates stored/output shape; positive delivery evidence is checked separately by the classifier. */
export function decodeRunResultV1(value: unknown): Result<RunResultV1, PelContractDecodeFailureV1> {
  const fail = (fieldPath: string): Result<never, PelContractDecodeFailureV1> => ({ ok: false, error: { code: "invalid-contract", fieldPath } });
  try {
    if (!object(value)) return fail("result");
    const statusKeys = ["schemaVersion", "runId", "state", "externalOutcome", "updatedAt", ...(value.state === "needs-action" ? ["resumeMode"] : [])];
    if (!exact(value, [...statusKeys, "programDigest", "attempt", "finalValue", "artifacts", "receipts", "outputs", "usage", "diagnostics"]) || !decodeRunStatusV1(Object.fromEntries(statusKeys.map(k => [k, value[k]]))).ok || !hash(value.programDigest)) return fail("result.status");
    const attempt = value.attempt;
    if (!object(attempt) || !exact(attempt, ["runId", "laneId", "attemptId"]) || attempt.runId !== value.runId || typeof attempt.laneId !== "string" || typeof decodeLaneId(attempt.laneId) !== "string" || typeof attempt.attemptId !== "number" || typeof decodeAttemptId(attempt.attemptId) !== "number") return fail("result.attempt");
    if (value.finalValue !== null && (!isPelDataValue(value.finalValue) || !validateDataSchema(value.finalValue, { type: "data", maxDepth: 256, maxBytes: 16 * 1024 * 1024 }))) return fail("result.finalValue");
    if (value.finalValue === null && (value.state === "succeeded" || value.state === "needs-action" && value.resumeMode === "final-value")) return fail("result.finalValue");
    for (const key of ["artifacts", "outputs"]) if (!array(value[key]) || !(value[key] as unknown[]).every(r => decodePelArtifactRefV1(r).ok)) return fail(`result.${key}`);
    if (!array(value.receipts) || !value.receipts.every(r => decodePelReceiptRefV1(r).ok)) return fail("result.receipts");
    const usage = value.usage;
    if (!object(usage) || !exact(usage, ["observed", "reservedCostUsd", "unresolvedEffectIds", "counters"]) || typeof usage.reservedCostUsd !== "number" || !Number.isFinite(usage.reservedCostUsd) || usage.reservedCostUsd < 0 || !array(usage.unresolvedEffectIds) || !usage.unresolvedEffectIds.every(text) || !object(usage.observed) || !object(usage.observed.providerCounters)) return fail("result.usage");
    const usageKeys = ["inputTokens", "outputTokens", "cachedReadTokens", "cacheWriteTokens", "costUsd", "priceScheduleRef", "priceSchedule", "providerCounters"];
    if (Object.keys(usage.observed).some(k => !usageKeys.includes(k)) || !normalizeUsage(usage.observed as unknown as ProviderUsageV1).ok) return fail("result.usage.observed");
    if (!Object.entries(usage.observed.providerCounters).every(([k, v]) => text(k) && (typeof v === "number" && Number.isFinite(v) && v >= 0 || text(v)))) return fail("result.usage.providerCounters");
    const schedule = usage.observed.priceSchedule;
    if (schedule !== undefined && (!object(schedule) || !["effectiveDate", "tier", "currency"].every(k => Object.hasOwn(schedule, k)) || Object.keys(schedule).some(k => !["effectiveDate", "tier", "currency", "longContextThreshold", "cacheReadRateRef", "cacheWriteRateRef"].includes(k)))) return fail("result.usage.priceSchedule");
    if (!object(usage.counters) || !exact(usage.counters, ["sourceBytes", "tokens", "astNodes", "syntaxDepthPeak", "reductions", "iterations", "callDepthPeak", "valueBytesPeak"]) || !Object.values(usage.counters).every(natural)) return fail("result.usage.counters");
    if (!array(value.diagnostics) || !value.diagnostics.every(d => object(d) && exact(d, ["code", "message", "sourceSpan", "effectId", "retryable", "nextAction", "evidenceRefs"]) && text(d.code) && text(d.message) && span(d.sourceSpan) && (d.effectId === null || text(d.effectId)) && typeof d.retryable === "boolean" && text(d.nextAction) && array(d.evidenceRefs) && d.evidenceRefs.every(r => decodePelArtifactRefV1(r).ok))) return fail("result.diagnostics");
    return { ok: true, value: structuredClone(value) as unknown as RunResultV1 };
  } catch { return fail("result"); }
}
