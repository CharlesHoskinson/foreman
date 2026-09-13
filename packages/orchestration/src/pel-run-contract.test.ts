import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodePelArtifactRefV1, decodePelContractJson, decodePelRecoveryDecisionV1,
  decodePelRevisionDecisionV1, decodeResourceSetV1, decodeRunStatusV1,
  decodeExecutionBindingV1, decodePelRunLimitsV1,
} from "./pel-run-contract.js";
import { DEFAULT_LIMITS, PEL_PROFILE, hashAuthoringContent } from "@foreman/pel";
import { strictEndstopLimits } from "./execution-contract.js";

const artifact = { artifactId: "artifact:source", byteLength: 2, sha256: "a".repeat(64) };
const receipt = { effectId: "effect:1", sequence: 1, sha256: "b".repeat(64) };
test("M4 status cannot report cancellation or success while the remote outcome is unknown", () => {
  const base = { schemaVersion: 1, runId: "run-1", updatedAt: 1, externalOutcome: "unknown" };
  for (const state of ["cancelled", "succeeded"]) assert.equal(decodeRunStatusV1({ ...base, state }).ok, false);
  assert.equal(decodeRunStatusV1({ ...base, state: "needs-action", resumeMode: "pending-effect" }).ok, true);
  assert.equal(decodeRunStatusV1({ ...base, state: "needs-action" }).ok, false);
  assert.equal(decodeRunStatusV1({ ...base, state: "failed", resumeMode: "pending-effect" }).ok, false);
  assert.equal(decodeRunStatusV1({ ...base, state: "running", runId: "../run" }).ok, false);
});
test("M4 recovery decisions require the original binding and exact evidence shape", () => {
  const base = { schemaVersion: 1, runId: "run-1", effectId: "effect:1", checkedDigest: "c".repeat(64), evidenceRefs: [artifact], authorityReceipt: receipt };
  assert.equal(decodePelRecoveryDecisionV1({ ...base, decision: "accept-result" }).ok, false);
  assert.equal(decodePelRecoveryDecisionV1({ ...base, decision: "accept-result", resultRef: artifact }).ok, true);
  assert.equal(decodePelRecoveryDecisionV1({ ...base, decision: "confirm-no-dispatch" }).ok, true);
  assert.equal(decodePelRecoveryDecisionV1({ ...base, decision: "confirm-no-dispatch", resultRef: artifact }).ok, false);
  assert.equal(decodePelRecoveryDecisionV1({ ...base, decision: "abandon", replenishedBudget: 100 }).ok, false);
});
test("M4 revision decisions preserve the complete top-level prefix boundary", () => {
  const base = { schemaVersion: 1, runId: "run-1", parentSourceDigest: "a".repeat(64), revisedSourceDigest: "b".repeat(64), completedPrefixDigest: "c".repeat(64), completedTopLevelCount: 2, pendingSuffixBoundary: 2, authorityReceipt: receipt };
  assert.equal(decodePelRevisionDecisionV1(base).ok, true);
  assert.equal(decodePelRevisionDecisionV1({ ...base, pendingSuffixBoundary: 3 }).ok, false);
});
test("M4 serialized contracts reject duplicate keys, invalid UTF-8, unknown fields and resource aliases", () => {
  assert.equal(decodePelContractJson(Buffer.from('{"artifactId":"a","artifactId":"b","byteLength":0,"sha256":"' + "a".repeat(64) + '"}'), decodePelArtifactRefV1).ok, false);
  assert.equal(decodePelContractJson(Uint8Array.of(0xff), decodePelArtifactRefV1).ok, false);
  assert.equal(decodePelArtifactRefV1({ ...artifact, path: "/etc/passwd" }).ok, false);
  assert.equal(decodeResourceSetV1({ reads: ["workspace:a", "workspace:a"], writes: [] }).ok, false);
  assert.equal(decodeResourceSetV1({ reads: [], writes: [], unknownScope: "workspace:a" }).ok, true);
});

test("M4 run binding rejects changed authority, options, attempt identity and widened malformed limits", () => {
  const options = { dependencyMode: "ordered", nlConditionProfile: null, nlConditionProfileDigest: null, replay: { mode: "none" } };
  const limits = { execution: strictEndstopLimits, pel: DEFAULT_LIMITS, deadline: 10000, maxConcurrentEffects: 2, maxInputTokens: 1000, maxOutputTokens: 1000, maxToolCalls: 0, maxOutputBytes: 65536, maxCostUsd: 1, cancellationObservationMs: 100, maxReplayReductions: 100000 };
  const authority = { kind: "v1", authoritySha256: "a".repeat(64), authorityRef: artifact };
  const binding = { schemaVersion: 1, evidenceKind: "product", runId: "run-1", attempt: { runId: "run-1", laneId: "pel", attemptId: 1 }, contractId: "contract-1", contractSha256: "a".repeat(64), authority, authoritySha256: authority.authoritySha256, checkedProgramDigest: "a".repeat(64), revisionDigest: "a".repeat(64), sourceDigest: artifact.sha256, snapshotDigest: "a".repeat(64), registryDigest: "a".repeat(64), configurationDigest: "a".repeat(64), runtimeVersion: "1", languageProfileId: PEL_PROFILE.id, languageProfileDigest: PEL_PROFILE.digest, runtimeHandlerVersion: "1", stateRoot: "/tmp/state", ownerLeaseRef: "lease:run-1", repository: { gitCommonDir: "/tmp/repo/.git", identitySha256: "a".repeat(64) }, artifacts: { source: artifact, snapshot: artifact, registry: artifact, configuration: artifact }, options, optionsDigest: hashAuthoringContent(options), resultContract: { schemaId: "schema:pel-data-v1", schemaSha256: "a".repeat(64), classification: "generic" }, limits, requiredMilestones: [] };
  assert.equal(decodeExecutionBindingV1(binding).ok, true);
  assert.equal(decodeExecutionBindingV1({ ...binding, authoritySha256: "b".repeat(64) }).ok, false);
  assert.equal(decodeExecutionBindingV1({ ...binding, options: { ...options, dependencyMode: "automatic" } }).ok, false);
  assert.equal(decodeExecutionBindingV1({ ...binding, attempt: { ...binding.attempt, runId: "other" } }).ok, false);
  assert.equal(decodeExecutionBindingV1({ ...binding, unsafe: true }).ok, false);
  assert.equal(decodePelRunLimitsV1({ ...limits, maxCostUsd: Infinity }).ok, false);
  assert.equal(decodePelRunLimitsV1({ ...limits, execution: { ...strictEndstopLimits, totalActions: 101 } }).ok, false);
});
