import assert from "node:assert/strict";
import { test } from "node:test";
import { hashAuthoringContent, type PelDataValue } from "@foreman/pel";
import { createDefaultAuthoringSnapshotV1 } from "./pel-host-descriptors.js";
import { classifyPelFinalResult, decodeRunResultV1 } from "./pel-run-result.js";
const registry = createDefaultAuthoringSnapshotV1().registry;
const s = (value: string): PelDataValue => ({ tag: "string", value });
const nil: PelDataValue = { tag: "nil" };
const rows = (...items: PelDataValue[]): PelDataValue => ({ tag: "list", items });
const assoc = (fields: Record<string, PelDataValue>): PelDataValue => rows(...Object.entries(fields).map(([key, value]) => ({ tag: "pair" as const, key, value })));
const task = assoc({ status: s("no-change"), candidate: nil, artifacts: rows(), "implementation-receipt": nil, findings: rows() });
const input = (value: PelDataValue, classification: "generic" | "delivery-v1" = "delivery-v1") => {
  const schemaId = classification === "generic" ? "schema:pel-data-v1" : "schema:delivery-final-v1";
  return { binding: { runId: "run-1", registryDigest: registry.digest, resultContract: { schemaId, schemaSha256: hashAuthoringContent(registry.dataSchemas[schemaId]), classification }, requiredMilestones: [] }, registry, value, externalOutcome: "none" as const, pendingEffects: 0, hostEvidence: { milestones: [], receiptRefs: [] }, now: 1 };
};
test("T-M4-023 generic status-like data stays data; delivery needs-action is terminal", () => {
  assert.equal(classifyPelFinalResult(input(assoc({ status: s("needs-action") }), "generic")).state, "succeeded");
  const value = assoc({ status: s("needs-action"), candidate: nil, delivery: task, reason: s("No publication authority"), "round-count": { tag: "number", value: 1 }, findings: rows() });
  const result = classifyPelFinalResult(input(value));
  assert.equal(result.state, "needs-action");
  assert.equal(result.resumeMode, "final-value");
});
test("T-M4-023 malformed and duplicate-key delivery lookalikes fail original schema validation", () => {
  const permissive = input(assoc({status: s('invented-success')}), 'generic');
  assert.equal(classifyPelFinalResult({...permissive, binding: {...permissive.binding, resultContract: {...permissive.binding.resultContract, classification:'delivery-v1'}}}).state,'failed');
  for (const value of [assoc({ status: s("approved") }), rows({ tag: "pair", key: "status", value: s("needs-action") }, { tag: "pair", key: "status", value: s("published") })]) {
    const result = classifyPelFinalResult(input(value));
    assert.equal(result.state, "failed");
    assert.equal(result.diagnostics[0]?.code, "final-result-invalid");
  }
});
test("T-M4-023 positive verification cannot manufacture host evidence and negative verification remains needs-action", () => {
  const value = assoc({ status: s("verified"), passed: { tag: "boolean", value: true }, candidate: s("candidate:1"), task, verification: s("receipt:verify"), checks: rows(), findings: rows() });
  const base = input(value);
  assert.equal(classifyPelFinalResult(base).state, "needs-action");
  assert.equal(classifyPelFinalResult({ ...base, hostEvidence: { milestones: ["checks"], receiptRefs: ["receipt:verify"], receiptCandidates: {'receipt:verify':'candidate:1'} } }).state, "succeeded");
  assert.equal(classifyPelFinalResult({ ...base, hostEvidence: { milestones: ["checks"], receiptRefs: ["receipt:verify"], receiptCandidates: {'receipt:verify':'candidate:other'} } }).state, "needs-action");
  const negative = assoc({ status: s("verification-failed"), passed: { tag: "boolean", value: false }, candidate: s("candidate:1"), task, verification: s("receipt:verify"), checks: rows(), findings: rows() });
  assert.equal(classifyPelFinalResult({ ...base, value: negative, hostEvidence: { milestones: ["checks"], receiptRefs: ["receipt:verify"] } }).state, "needs-action");
});
test("T-M4-023 pending external effects and missing required milestones prevent success", () => {
  const base = input({ tag: "number", value: 42 }, "generic");
  assert.equal(classifyPelFinalResult({ ...base, pendingEffects: 1, externalOutcome: "unknown" }).resumeMode, "pending-effect");
  assert.equal(classifyPelFinalResult({ ...base, binding: { ...base.binding, requiredMilestones: ["audit"] } }).state, "needs-action");
  assert.equal(decodeRunResultV1({ schemaVersion: 1, runId: "r", state: "succeeded" }).ok, false);
});
