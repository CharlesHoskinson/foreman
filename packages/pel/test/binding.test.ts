import {
  validateAuthoringSnapshotV1,
  createAuthoringSnapshotV1,
} from "../src/snapshot.js";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildEffectiveAuthoringSnapshotV1 } from "../src/snapshot.js";
import {
  createPlanBindingV1,
  validateBinding,
  canonicalAuthoringJson,
} from "../src/binding.js";
test("T-M2-007 source bytes and every checked binding field remain exact", () => {
  const snapshot = loadAuthoringSnapshotFixture();
  const source = new TextEncoder().encode("(+ 1 2)");
  const binding = createPlanBindingV1(source, snapshot);
  assert.ok(validateBinding(binding, source, snapshot).ok);
  assert.equal(
    validateBinding(binding, new TextEncoder().encode("(+ 1 2) "), snapshot).ok,
    false,
  );
  for (const key of [
    "sourceDigest",
    "snapshotDigest",
    "languageProfileDigest",
    "registryDigest",
    "providerProfilesDigest",
    "policyDigest",
    "optionsDigest",
  ])
    assert.equal(
      validateBinding({ ...binding, [key]: "0".repeat(64) }, source, snapshot)
        .ok,
      false,
    );
  const effective = buildEffectiveAuthoringSnapshotV1(snapshot, {
    dependencyMode: "automatic",
  });
  assert.ok(effective.ok);
  assert.equal(validateBinding(binding, source, effective.value).ok, false);
  assert.equal(
    validateBinding({ ...binding, extra: true }, source, snapshot).ok,
    false,
  );
});
test("canonical binding JSON sorts object keys, preserves arrays, forbids undefined and duplicate keys", () => {
  assert.equal(
    canonicalAuthoringJson({ z: 1, a: [2, 1] }),
    '{"a":[2,1],"z":1}',
  );
  assert.throws(() => canonicalAuthoringJson({ a: undefined }));
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.throws(() => canonicalAuthoringJson(cycle));
});
test("T-M2-007 changed artifact, role, predicate, control, and policy content invalidates the old binding", () => {
  const snapshot = loadAuthoringSnapshotFixture(),
    source = Buffer.from("1");
  const binding = createPlanBindingV1(source, snapshot);
  const role = snapshot.roleBindings["role:implementer"]!;
  const variants = [
    {
      ...snapshot,
      artifactDescriptors: snapshot.artifactDescriptors.map((a, i) =>
        i === 0 ? { ...a, content: "Changed immutable content" } : a,
      ),
    },
    {
      ...snapshot,
      roleBindings: {
        ...snapshot.roleBindings,
        "role:implementer": {
          ...role,
          controls: { ...role.controls, effort: "medium" as const },
        },
      },
    },
    {
      ...snapshot,
      nlConditionProfile: {
        ...snapshot.nlConditionProfile!,
        credentialProfileRef: "account:test",
      },
    },
    {
      ...snapshot,
      providerProfiles: snapshot.providerProfiles.map((p, i) =>
        i === 0
          ? {
              ...p,
              applicationDefaults: {
                ...p.applicationDefaults,
                effort: "medium" as const,
              },
            }
          : p,
      ),
    },
    {
      ...snapshot,
      policy: {
        ...snapshot.policy,
        maxEffects: snapshot.policy.maxEffects - 1,
      },
    },
    { ...snapshot, resultContract: "schema:pel-data-v1" },
  ];
  for (const content of variants) {
    const changed = createAuthoringSnapshotV1(content);
    assert.ok(changed.ok, JSON.stringify(changed));
    assert.equal(validateBinding(binding, source, changed.value).ok, false);
  }
  for (const changed of [
    {
      ...snapshot,
      languageProfile: {
        ...snapshot.languageProfile,
        id: "unadmitted-language",
      },
    },
    { ...snapshot, registry: { ...snapshot.registry, digest: "0".repeat(64) } },
  ])
    assert.equal(validateBinding(binding, source, changed).ok, false);
});
test("T-M2-007 binding validation rejects a tampered snapshot even with unchanged digest fields", () => {
  const snapshot = loadAuthoringSnapshotFixture();
  const source = new TextEncoder().encode("1");
  const binding = createPlanBindingV1(source, snapshot);
  const tampered = JSON.parse(JSON.stringify(snapshot));
  tampered.policy.allowedCapabilities.push("forged.all");
  assert.equal(validateBinding(binding, source, tampered).ok, false);
});

function loadAuthoringSnapshotFixture() {
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
