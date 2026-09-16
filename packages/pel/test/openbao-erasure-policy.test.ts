import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { checkPel } from "../src/checker.js";
import { validateAuthoringSnapshotV1 } from "../src/snapshot.js";

const policyPath = "examples/pel/openbao-erasure-policy.pel";
const controls = ["intact", "missing", "inconsistent", "unavailable"] as const;
const accounts = ["new", "active", "pending", "tombstoned", "quarantined"] as const;
const materials = ["absent", "active-match", "tombstone-match", "mismatch", "invalid", "unavailable"] as const;
type Decision = readonly [classification: string, reason: string];

const controlDecisions: Readonly<Record<string, Decision>> = {
  unavailable: ["backend-blocked", "authority-unavailable"],
  missing: ["backend-blocked", "provisioning-required"],
  inconsistent: ["backend-blocked", "control-reconciliation-required"],
};

const intactDecisions: Readonly<Record<string, Decision>> = {
  "new/absent": ["import-candidate", "reservation-required"],
  "new/active-match": ["account-blocked", "orphan-or-invalid-material"],
  "new/tombstone-match": ["account-blocked", "orphan-or-invalid-material"],
  "new/mismatch": ["account-blocked", "orphan-or-invalid-material"],
  "new/invalid": ["account-blocked", "orphan-or-invalid-material"],
  "new/unavailable": ["account-blocked", "observation-unavailable"],
  "active/absent": ["account-blocked", "known-account-erased"],
  "active/active-match": ["active-candidate", "current-authority-required"],
  "active/tombstone-match": ["account-blocked", "account-reconciliation-required"],
  "active/mismatch": ["account-blocked", "account-reconciliation-required"],
  "active/invalid": ["account-blocked", "account-reconciliation-required"],
  "active/unavailable": ["account-blocked", "observation-unavailable"],
  "pending/absent": ["account-blocked", "operation-reconciliation-required"],
  "pending/active-match": ["account-blocked", "operation-reconciliation-required"],
  "pending/tombstone-match": ["account-blocked", "operation-reconciliation-required"],
  "pending/mismatch": ["account-blocked", "operation-reconciliation-required"],
  "pending/invalid": ["account-blocked", "operation-reconciliation-required"],
  "pending/unavailable": ["account-blocked", "observation-unavailable"],
  "tombstoned/absent": ["account-blocked", "recovery-required"],
  "tombstoned/active-match": ["account-blocked", "recovery-required"],
  "tombstoned/tombstone-match": ["account-blocked", "recovery-required"],
  "tombstoned/mismatch": ["account-blocked", "recovery-required"],
  "tombstoned/invalid": ["account-blocked", "recovery-required"],
  "tombstoned/unavailable": ["account-blocked", "observation-unavailable"],
  "quarantined/absent": ["account-blocked", "account-reconciliation-required"],
  "quarantined/active-match": ["account-blocked", "account-reconciliation-required"],
  "quarantined/tombstone-match": ["account-blocked", "account-reconciliation-required"],
  "quarantined/mismatch": ["account-blocked", "account-reconciliation-required"],
  "quarantined/invalid": ["account-blocked", "account-reconciliation-required"],
  "quarantined/unavailable": ["account-blocked", "observation-unavailable"],
};

function snapshot() {
  const result = validateAuthoringSnapshotV1(
    JSON.parse(
      readFileSync(
        "packages/pel/test/fixtures/authoring-snapshot.json",
        "utf8",
      ),
    ),
  );
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

function pelLiteral(value: string | boolean | number): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "#t" : "#f";
  return String(value);
}

function expectedDecision(control: string, account: string, material: string): Decision {
  if (!(controls as readonly string[]).includes(control) ||
      !(accounts as readonly string[]).includes(account) ||
      !(materials as readonly string[]).includes(material)) {
    return ["blocked", "invalid-observation"];
  }
  const expected = controlDecisions[control] ?? intactDecisions[`${account}/${material}`];
  assert.ok(expected, JSON.stringify({ control, account, material }));
  return expected;
}

function evaluate(control: string | boolean | number, account: string | boolean | number, material: string | boolean | number) {
  const source = `${readFileSync(policyPath, "utf8")}\n(erasure-policy :control ${pelLiteral(control)} :account ${pelLiteral(account)} :material ${pelLiteral(material)})`;
  const result = checkPel({ source: new TextEncoder().encode(source), snapshot: snapshot() });
  assert.equal(result.tag, "ok", JSON.stringify({ control, account, material, result }));
  if (result.tag !== "ok") throw new Error("PEL policy did not check");
  assert.deepEqual(result.checked.analysis.effects, [], JSON.stringify({ control, account, material }));
  const summary = result.checked.analysis.finalValueSummary;
  assert.equal(summary.kind, "known", JSON.stringify({ control, account, material, summary }));
  if (summary.kind !== "known") throw new Error("PEL policy result was unresolved");
  assert.equal(summary.value.tag, "list");
  if (summary.value.tag !== "list") throw new Error("PEL policy result was not a keyword map");
  assert.deepEqual(summary.value.items.map((item) => item.tag === "pair" ? item.key : item.tag), ["classification", "reason"]);
  const values = summary.value.items.map((item) => {
    assert.equal(item.tag, "pair");
    if (item.tag !== "pair") throw new Error("PEL policy field was not a keyword pair");
    assert.equal(item.value.tag, "string");
    if (item.value.tag !== "string") throw new Error("PEL policy field was not a string");
    return item.value.value;
  });
  return values as unknown as Decision;
}

test("known-account erasure is account-blocked", () => {
  const source = `${readFileSync(policyPath, "utf8")}\n(erasure-policy :control "intact" :account "active" :material "absent")`;
  const result = checkPel({ source: new TextEncoder().encode(source), snapshot: snapshot() });

  assert.equal(result.tag, "ok", JSON.stringify(result));
  if (result.tag !== "ok") return;
  assert.deepEqual(result.checked.analysis.finalValueSummary, {
    kind: "known",
    value: {
      tag: "list",
      items: [
        {
          tag: "pair",
          key: "classification",
          value: { tag: "string", value: "account-blocked" },
        },
        {
          tag: "pair",
          key: "reason",
          value: { tag: "string", value: "known-account-erased" },
        },
      ],
    },
  });
  assert.deepEqual(result.checked.analysis.effects, []);
});

test("every accepted observation combination follows the independent precedence table", () => {
  for (const control of controls) {
    for (const account of accounts) {
      for (const material of materials) {
        assert.deepEqual(
          evaluate(control, account, material),
          expectedDecision(control, account, material),
          JSON.stringify({ control, account, material }),
        );
      }
    }
  }
});

test("unsupported strings, scalar types, and whitespace lookalikes are invalid observations", () => {
  const invalid = ["unknown", " intact", "intact ", true, false, 0, 1] as const;
  for (const value of invalid) {
    assert.deepEqual(evaluate(value, "active", "active-match"), ["blocked", "invalid-observation"]);
    assert.deepEqual(evaluate("intact", value, "active-match"), ["blocked", "invalid-observation"]);
    assert.deepEqual(evaluate("intact", "active", value), ["blocked", "invalid-observation"]);
  }
});

test("an account-local erasure leaves an intact sibling as an active candidate", () => {
  assert.deepEqual(evaluate("intact", "active", "absent"), ["account-blocked", "known-account-erased"]);
  assert.deepEqual(evaluate("intact", "active", "active-match"), ["active-candidate", "current-authority-required"]);
});

test("control failure blocks both siblings and never creates an import candidate", () => {
  for (const control of ["missing", "inconsistent", "unavailable"] as const) {
    const damaged = evaluate(control, "active", "absent");
    const intact = evaluate(control, "active", "active-match");
    assert.deepEqual(damaged, expectedDecision(control, "active", "absent"));
    assert.deepEqual(intact, expectedDecision(control, "active", "active-match"));
    assert.notEqual(damaged[0], "import-candidate");
    assert.notEqual(intact[0], "import-candidate");
  }
});

test("loading the policy definition is pure and ends with the specification-only marker", () => {
  const result = checkPel({ source: readFileSync(policyPath), snapshot: snapshot() });
  assert.equal(result.tag, "ok", JSON.stringify(result));
  if (result.tag !== "ok") return;
  assert.deepEqual(result.checked.analysis.effects, []);
  assert.deepEqual(result.checked.analysis.finalValueSummary, {
    kind: "known",
    value: { tag: "string", value: "policy-specification-only" },
  });
});
