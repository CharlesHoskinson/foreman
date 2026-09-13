import type { AuthoringSnapshotV1 } from "../src/authoring-types.js";
import { validateDataSchema } from "../src/host-contract.js";
import { createAuthoringSnapshotV1 } from "../src/snapshot.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalize } from "@foreman/core";

import {
  buildEffectiveAuthoringSnapshotV1,
  parseAuthoringSnapshotV1,
  resolveModelSelection,
  validateAuthoringSnapshotV1,
} from "../src/snapshot.js";

test("T-M2-014 complete default snapshot round trips and packaged bytes match its fixture", () => {
  const snapshot = loadAuthoringSnapshotFixture();
  assert.ok(Object.isFrozen(snapshot.policy));
  assert.ok(
    validateAuthoringSnapshotV1(JSON.parse(JSON.stringify(snapshot))).ok,
  );
  for (const path of [
    "skills/foreman/runtime/assets/pel/default-authoring-snapshot.json",
    "packages/pel/test/fixtures/authoring-snapshot.json",
  ])
    assert.equal(readFileSync(path, "utf8"), canonicalize(snapshot) + "\n");
  assert.equal(
    snapshot.roleBindings["role:implementer"]?.profileId,
    "grok-4.6",
  );
  assert.equal(
    snapshot.roleBindings["role:reviewer"]?.transportId,
    "codex-app-server",
  );
});
test("T-M2-014 rejects missing content, unknown fields, duplicate JSON keys, tampering and unsafe inputs", () => {
  const snapshot = loadAuthoringSnapshotFixture();
  for (const mutate of [
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      delete (s as unknown as Record<string, unknown>).policy;
    },
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      Object.assign(s, { extra: true });
    },
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      s.policy.maxEffects++;
    },
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      s.roleBindings["role:reviewer"]!.controls.effort = "high";
    },
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      s.registry.descriptors[0]!.resources.reads.push("workspace:outside");
    },
  ]) {
    const altered = JSON.parse(JSON.stringify(snapshot));
    mutate(altered);
    assert.equal(validateAuthoringSnapshotV1(altered).ok, false);
  }
  assert.equal(
    parseAuthoringSnapshotV1('{"schemaVersion":1,"schemaVersion":1}').ok,
    false,
  );
  const hostile = {
    get schemaVersion() {
      throw Error("getter executed");
    },
  };
  assert.equal(validateAuthoringSnapshotV1(hostile).ok, false);
});
test("T-M2-014 effective narrowing changes options and snapshots, rejects widened bounds and invalid selections", () => {
  const base = loadAuthoringSnapshotFixture();
  const result = buildEffectiveAuthoringSnapshotV1(base, {
    dependencyMode: "automatic",
    narrowingLimits: { maxIterations: 3 },
    narrowingBudgets: { maxEffects: 7 },
  });
  assert.ok(result.ok);
  assert.equal(result.value.limits.maxIterations, 3);
  assert.equal(result.value.policy.maxEffects, 7);
  assert.notEqual(result.value.optionsDigest, base.optionsDigest);
  assert.notEqual(result.value.snapshotDigest, base.snapshotDigest);
  assert.equal(
    buildEffectiveAuthoringSnapshotV1(base, {
      narrowingLimits: { maxIterations: base.limits.maxIterations + 1 },
    }).ok,
    false,
  );
  assert.equal(
    buildEffectiveAuthoringSnapshotV1(base, {
      resultContract: "schema:missing",
    }).ok,
    false,
  );
  assert.equal(
    buildEffectiveAuthoringSnapshotV1(base, { surprise: true } as never).ok,
    false,
  );
  assert.equal(buildEffectiveAuthoringSnapshotV1(base).ok, true);
  assert.equal(base.dependencyMode, "ordered");
});
test("T-M2-003 exact role selectors resolve and ambiguous model selectors fail", () => {
  const snapshot = loadAuthoringSnapshotFixture();
  const role = resolveModelSelection(snapshot, "role:implementer");
  assert.ok(role.ok);
  assert.equal(role.value.transportId, "grok-acp");
  assert.equal(resolveModelSelection(snapshot, "gpt-5.6-sol").ok, false);
  assert.ok(
    resolveModelSelection(snapshot, "gpt-5.6-sol", "openai-responses").ok,
  );
  assert.equal(
    resolveModelSelection(snapshot, "role:implementer", "xai-responses").ok,
    false,
  );
});

test("T-M2-014 rehashed snapshots still validate schemas, controls, and normalized artifact identities", () => {
  const base = loadAuthoringSnapshotFixture();
  for (const mutate of [
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      Object.assign(s.providerProfiles[0]!.applicationDefaults.sampling, {
        unrecognized: 1,
      });
    },
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      s.roleBindings["role:implementer"]!.transportId = "openai-responses";
    },
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      s.nlConditionProfile!.outputSchemaId = "schema:pel-data-v1";
    },
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      s.artifactDescriptors[0]!.id = "artifact:../escape";
    },
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      s.generationLimits.maxRepairs = 3;
    },
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      s.policy.resourceEnvelope.reads = [
        "workspace:default",
        "workspace:default",
      ];
    },
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      s.resourceResolvers.static = { version: 2 };
    },
  ]) {
    const altered = JSON.parse(JSON.stringify(base));
    mutate(altered);
    assert.equal(createAuthoringSnapshotV1(altered).ok, false);
  }
});

test("T-M2-014 candidate and terminal delivery schemas preserve bounded exact field order", () => {
  const snapshot = loadAuthoringSnapshotFixture();
  const schemas = snapshot.registry.dataSchemas;
  const candidate = schemas["schema:candidate-v1"];
  assert.equal(candidate?.type, "association");
  if (candidate?.type !== "association") return;
  assert.deepEqual(
    candidate.fields.map((f) => f.key),
    ["summary", "claimedPaths", "findings"],
  );
  assert.ok(candidate.fields.every((f) => f.required));
  assert.equal(candidate.additionalKeys, false);
  assert.equal(
    validateDataSchema(
      {
        tag: "list",
        items: [
          {
            tag: "pair",
            key: "summary",
            value: { tag: "string", value: "Implemented" },
          },
          {
            tag: "pair",
            key: "claimedPaths",
            value: { tag: "list", items: [] },
          },
          { tag: "pair", key: "findings", value: { tag: "list", items: [] } },
        ],
      },
      candidate,
    ),
    true,
  );
  const needs = schemas["schema:delivery-needs-action-v1"];
  assert.equal(needs?.type, "association");
  if (needs?.type !== "association") return;
  assert.deepEqual(
    needs.fields.map((f) => f.key),
    ["status", "candidate", "delivery", "reason", "round-count", "findings"],
  );
});

type MutableSnapshot<T> = T extends readonly (infer U)[]
  ? MutableSnapshot<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: MutableSnapshot<T[K]> }
    : T;
function changedSnapshot(
  change: (s: MutableSnapshot<AuthoringSnapshotV1>) => void,
) {
  const raw = JSON.parse(
    JSON.stringify(loadAuthoringSnapshotFixture()),
  ) as MutableSnapshot<AuthoringSnapshotV1>;
  change(raw);
  return createAuthoringSnapshotV1(raw);
}

test("T-M2-014 exact profile metadata cannot invent transport pairs or widen pinned controls", () => {
  for (const change of [
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      const p = s.providerProfiles.find(
        (p) => p.profileId === "grok-4.6" && p.transportId === "xai-responses",
      )!;
      p.transportId = "openai-responses";
      s.policy.allowedModelTransports.find(
        (p) => p.profileId === "grok-4.6" && p.transportId === "xai-responses",
      )!.transportId = "openai-responses";
    },
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      const p = s.providerProfiles.find((p) => p.profileId === "grok-4.6")!;
      p.supportedControls.efforts.push("max");
    },
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      const p = s.providerProfiles.find((p) => p.profileId === "gpt-6-astra")!;
      p.supportedControls.efforts.push("none");
    },
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      const p = s.providerProfiles.find(
        (p) => p.profileId === "gemini-3.8-flash",
      )!;
      p.supportedControls.efforts.push("xhigh");
    },
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      const p = s.providerProfiles.find(
        (p) => p.profileId === "claude-fable-5-1",
      )!;
      p.supportedControls.thinkingModes.push("enabled");
      p.supportedControls.budgetTokens = true;
    },
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      const p = s.providerProfiles.find(
        (p) => p.profileId === "claude-fable-5-1",
      )!;
      p.supportedControls.sampling.push("temperature");
    },
    (s: MutableSnapshot<AuthoringSnapshotV1>) => {
      const p = s.providerProfiles.find(
        (p) => p.profileId === "claude-fable-5-1",
      )!;
      p.supportedControls.toolChoices.push("named");
    },
  ]) {
    const result = changedSnapshot(change);
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.equal(result.error[0]?.code, "PEL_PROFILE_UNSUPPORTED");
  }
});

test("T-M2-014 custom model fixtures remain explicit and cannot claim grammar qualification", () => {
  const custom = (
    evidenceKind: "fixture" | "documented" | "qualified",
    grammarSupport: "unknown" | "qualified" = "unknown",
  ) =>
    changedSnapshot((s) => {
      const p = s.providerProfiles[0]!;
      s.providerProfiles.push({
        ...p,
        profileId: "fixture:custom",
        transportId: "fixture-transport",
        evidenceKind,
        grammarSupport,
      });
      s.policy.allowedModelTransports.push({
        profileId: "fixture:custom",
        transportId: "fixture-transport",
      });
    });
  assert.equal(custom("fixture").ok, true);
  assert.equal(custom("documented").ok, false);
  assert.equal(custom("qualified").ok, false);
  assert.equal(custom("fixture", "qualified").ok, false);
  assert.equal(
    changedSnapshot((s) => {
      s.providerProfiles[0]!.grammarSupport = "qualified";
    }).ok,
    false,
  );
  assert.equal(
    changedSnapshot((s) => {
      s.providerProfiles[0]!.evidenceKind = "qualified";
      s.providerProfiles[0]!.grammarSupport = "qualified";
    }).ok,
    true,
  );
});

test("T-M2-014 resource scopes are finite normalized IDs, with no wildcards or traversal", () => {
  for (const resource of [
    "*",
    "workspace:*",
    "workspace:../outside",
    "workspace:default/../outside",
    "workspace:default//file",
    "workspace:/absolute",
    "workspace:default\\file",
    "workspace:default/%2e%2e/outside",
    "workspace:default?glob",
    " workspace:default",
  ])
    assert.equal(
      changedSnapshot((s) => {
        s.policy.resourceEnvelope.reads.push(resource);
      }).ok,
      false,
      resource,
    );
  assert.equal(
    changedSnapshot((s) => {
      s.policy.resourceEnvelope.reads.push("workspace:default/src/file.ts");
    }).ok,
    true,
  );
  assert.equal(
    changedSnapshot((s) => {
      s.policy.artifactConstraints.allowedIds.push("artifact:../outside");
    }).ok,
    false,
  );
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
