import {
  authoringProfileCeilingIssue,
  isNormalizedAuthoringResourceId,
} from "./authoring-profile-ceilings.js";
import { isCoreFailure, parseJsonRejectDuplicateKeys } from "@foreman/core";
import { createHostRegistry } from "./host-contract.js";
import { PEL_PROFILE } from "./profile.js";
import { canonicalAuthoringJson, hashAuthoringContent } from "./binding.js";
import type {
  AuthoringDiagnostic,
  AuthoringModelSelectionV1,
  AuthoringProviderControlsV1,
  AuthoringProviderProfileV1,
  AuthoringSnapshotContentV1,
  AuthoringSnapshotV1,
  EffectiveAuthoringSelectionV1,
} from "./authoring-types.js";
import type { Result } from "./types.js";
const zero = { start: 0, end: 0, line: 1, column: 1, endLine: 1, endColumn: 1 };
export function authoringDiagnostic(
  code: string,
  message: string,
  expectedForms: readonly string[] = [],
): AuthoringDiagnostic {
  return {
    code,
    message,
    severity: "error",
    span: zero,
    relatedSpans: [],
    expectedForms,
  };
}
function fail<T>(
  message: string,
  code = "PEL_SCHEMA",
): Result<T, AuthoringDiagnostic[]> {
  return { ok: false, error: [authoringDiagnostic(code, message)] };
}
function record(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function keys(
  v: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): v is Record<string, unknown> {
  return (
    record(v) &&
    required.every((k) => Object.hasOwn(v, k)) &&
    Object.keys(v).every((k) => required.includes(k) || optional.includes(k))
  );
}
function names(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.length <= 1000 &&
    v.every(
      (x) =>
        typeof x === "string" && x.length > 0 && Buffer.byteLength(x) <= 4096,
    ) &&
    new Set(v).size === v.length
  );
}
function natural(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}
function freeze<T>(v: T): T {
  if (typeof v === "object" && v !== null && !Object.isFrozen(v)) {
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  }
  return v;
}
function same(a: unknown, b: unknown): boolean {
  return canonicalAuthoringJson(a) === canonicalAuthoringJson(b);
}
export function validateAuthoringControlsV1(
  value: unknown,
  profile: AuthoringProviderProfileV1,
): Result<AuthoringProviderControlsV1, AuthoringDiagnostic[]> {
  try {
    canonicalAuthoringJson(value);
    const metadataIssue = authoringProfileCeilingIssue(profile);
    if (metadataIssue) return fail(metadataIssue, "PEL_PROFILE_UNSUPPORTED");
    if (
      !keys(value, [
        "effort",
        "thinking",
        "sampling",
        "toolChoice",
        "execution",
      ]) ||
      !keys(value.thinking, ["mode"], ["budgetTokens"]) ||
      !keys(value.sampling, [], ["temperature", "topP", "topK"]) ||
      !keys(value.execution, ["mode", "store"])
    )
      return fail(
        "Controls contain missing or unknown fields",
        "PEL_PROFILE_UNSUPPORTED",
      );
    const controls = value as unknown as AuthoringProviderControlsV1;
    const supported = profile.supportedControls;
    const tool =
      typeof controls.toolChoice === "string"
        ? controls.toolChoice
        : keys(controls.toolChoice, ["name"]) &&
            typeof controls.toolChoice.name === "string" &&
            controls.toolChoice.name.length > 0
          ? "named"
          : "invalid";
    if (
      !supported.efforts.includes(controls.effort) ||
      !supported.thinkingModes.includes(controls.thinking.mode) ||
      !supported.executionModes.includes(controls.execution.mode) ||
      !supported.store.includes(controls.execution.store) ||
      !supported.toolChoices.includes(tool as never)
    )
      return fail(
        `Controls are unsupported by ${profile.profileId}/${profile.transportId}`,
        "PEL_PROFILE_UNSUPPORTED",
      );
    if (
      controls.thinking.budgetTokens !== undefined &&
      (!supported.budgetTokens ||
        !natural(controls.thinking.budgetTokens) ||
        controls.thinking.budgetTokens === 0 ||
        controls.thinking.mode !== "enabled")
    )
      return fail("Thinking budget is unsupported", "PEL_PROFILE_UNSUPPORTED");
    for (const [key, n] of Object.entries(controls.sampling))
      if (
        !supported.sampling.includes(key as never) ||
        typeof n !== "number" ||
        !Number.isFinite(n) ||
        n < 0 ||
        (key === "topP" && n > 1) ||
        (key === "temperature" && n > 2) ||
        (key === "topK" && !natural(n))
      )
        return fail(`Unsupported sampling ${key}`, "PEL_PROFILE_UNSUPPORTED");
    if (
      profile.profileId === "claude-opus-5" &&
      ["xhigh", "max"].includes(controls.effort) &&
      controls.thinking.mode === "disabled"
    )
      return fail(
        "Opus requires thinking at xhigh/max effort",
        "PEL_PROFILE_UNSUPPORTED",
      );
    return { ok: true, value: freeze(structuredClone(controls)) };
  } catch {
    return fail("Invalid provider controls", "PEL_PROFILE_UNSUPPORTED");
  }
}
function validateSelection(
  s: AuthoringSnapshotV1,
  v: unknown,
  predicate = false,
): Result<AuthoringModelSelectionV1, AuthoringDiagnostic[]> {
  if (
    !keys(
      v,
      ["profileId", "transportId", "controls", "credentialProfileRef"],
      predicate ? ["outputSchemaId"] : [],
    ) ||
    typeof v.profileId !== "string" ||
    typeof v.transportId !== "string" ||
    typeof v.credentialProfileRef !== "string"
  )
    return fail("Invalid exact model selection", "PEL_PROFILE_UNSUPPORTED");
  if (predicate && v.outputSchemaId !== "schema:pel-boolean-v1")
    return fail(
      "Natural-language predicate must use schema:pel-boolean-v1",
      "PEL_PROFILE_UNSUPPORTED",
    );
  const profile = s.providerProfiles.find(
    (p) => p.profileId === v.profileId && p.transportId === v.transportId,
  );
  if (
    !profile ||
    !s.policy.allowedModelTransports.some(
      (p) => p.profileId === v.profileId && p.transportId === v.transportId,
    ) ||
    !s.policy.allowedCredentialProfileRefs.includes(v.credentialProfileRef)
  )
    return fail(
      `Selection ${v.profileId}/${v.transportId} or credential reference is outside policy`,
      "PEL_PROFILE_UNSUPPORTED",
    );
  const controls = validateAuthoringControlsV1(v.controls, profile);
  if (!controls.ok) return controls;
  return {
    ok: true,
    value: {
      profileId: v.profileId,
      transportId: v.transportId,
      controls: controls.value,
      credentialProfileRef: v.credentialProfileRef,
    },
  };
}
export function resolveModelSelection(
  snapshot: AuthoringSnapshotV1,
  model: string,
  transport?: string,
): Result<AuthoringModelSelectionV1, AuthoringDiagnostic[]> {
  if (model.startsWith("role:")) {
    const selection = snapshot.roleBindings[model];
    if (!selection)
      return fail(`Unknown model role ${model}`, "PEL_PROFILE_UNSUPPORTED");
    if (transport !== undefined && transport !== selection.transportId)
      return fail(
        `Transport ${transport} disagrees with role ${model}: ${selection.transportId}`,
        "PEL_PROFILE_UNSUPPORTED",
      );
    return validateSelection(snapshot, selection);
  }
  const profiles = snapshot.providerProfiles.filter(
    (p) =>
      p.profileId === model &&
      (transport === undefined || p.transportId === transport) &&
      snapshot.policy.allowedModelTransports.some(
        (pair) =>
          pair.profileId === p.profileId && pair.transportId === p.transportId,
      ),
  );
  if (profiles.length !== 1)
    return {
      ok: false,
      error: [
        authoringDiagnostic(
          "PEL_PROFILE_UNSUPPORTED",
          `Select one admitted transport for ${model}; found ${profiles.length}`,
          profiles.map((p) => p.transportId),
        ),
      ],
    };
  const profile = profiles[0]!;
  return validateSelection(snapshot, {
    profileId: model,
    transportId: profile.transportId,
    controls: profile.applicationDefaults,
    credentialProfileRef: snapshot.defaultCredentialProfileRef,
  });
}
function computed(input: AuthoringSnapshotContentV1): AuthoringSnapshotV1 {
  const content = Object.fromEntries(
    Object.entries(input).filter(
      ([key]) =>
        ![
          "schemaVersion",
          "languageProfileDigest",
          "registryDigest",
          "providerProfilesDigest",
          "policyDigest",
          "nlConditionProfileDigest",
          "artifactDigests",
          "options",
          "optionsDigest",
          "snapshotDigest",
        ].includes(key),
    ),
  ) as unknown as AuthoringSnapshotContentV1;
  const nlConditionProfileDigest =
    content.nlConditionProfile === null
      ? null
      : hashAuthoringContent(content.nlConditionProfile);
  const options = {
    dependencyMode: content.dependencyMode,
    nlConditionProfile: content.nlConditionProfile,
    nlConditionProfileDigest,
    replay: { mode: "none" as const },
  };
  const payload = {
    ...content,
    schemaVersion: 1 as const,
    languageProfileDigest: hashAuthoringContent(content.languageProfile),
    registryDigest: content.registry.digest,
    providerProfilesDigest: hashAuthoringContent(content.providerProfiles),
    policyDigest: hashAuthoringContent(content.policy),
    nlConditionProfileDigest,
    artifactDigests: content.artifactDescriptors
      .map((a) => ({ id: a.id, digest: hashAuthoringContent(a) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    options,
    optionsDigest: hashAuthoringContent(options),
  };
  return { ...payload, snapshotDigest: hashAuthoringContent(payload) };
}
export function createAuthoringSnapshotV1(
  content: AuthoringSnapshotContentV1,
): Result<AuthoringSnapshotV1, AuthoringDiagnostic[]> {
  try {
    return validateAuthoringSnapshotV1(computed(content));
  } catch {
    return fail("Snapshot contains invalid JSON content");
  }
}
export function parseAuthoringSnapshotV1(
  text: string,
): Result<AuthoringSnapshotV1, AuthoringDiagnostic[]> {
  if (Buffer.byteLength(text) > 16 * 1024 * 1024)
    return fail("Snapshot exceeds 16 MiB");
  const parsed = parseJsonRejectDuplicateKeys(text);
  return isCoreFailure(parsed)
    ? fail("Snapshot must be JSON with unique object keys")
    : validateAuthoringSnapshotV1(parsed);
}
export function validateAuthoringSnapshotV1(
  value: unknown,
): Result<AuthoringSnapshotV1, AuthoringDiagnostic[]> {
  try {
    const encoded = canonicalAuthoringJson(value);
    const v: unknown = JSON.parse(encoded);
    if (
      !keys(v, [
        "schemaVersion",
        "languageProfile",
        "languageProfileDigest",
        "registry",
        "registryDigest",
        "providerProfiles",
        "providerProfilesDigest",
        "policy",
        "policyDigest",
        "resourceResolvers",
        "roleBindings",
        "nlConditionProfile",
        "nlConditionProfileDigest",
        "artifactDescriptors",
        "artifactDigests",
        "limits",
        "generationLimits",
        "defaultCredentialProfileRef",
        "dependencyMode",
        "resultContract",
        "options",
        "optionsDigest",
        "snapshotDigest",
      ]) ||
      v.schemaVersion !== 1
    )
      return fail("Snapshot has missing or unknown fields");
    if (!same(v.languageProfile, PEL_PROFILE))
      return fail(
        "Unsupported language profile content",
        "PEL_PROFILE_UNSUPPORTED",
      );
    const r = v.registry;
    if (
      !keys(r, [
        "schemaVersion",
        "profileId",
        "profileDigest",
        "descriptors",
        "dataSchemas",
        "failureSchemas",
        "resolverCatalog",
        "digest",
      ]) ||
      !Array.isArray(r.descriptors) ||
      !record(r.dataSchemas) ||
      !record(r.failureSchemas) ||
      !record(r.resolverCatalog)
    )
      return fail("Invalid registry content");
    const dataSchemas = Object.fromEntries(
      Object.entries(r.dataSchemas).filter(
        ([id]) => !["schema:pel-data-v1", "schema:pel-boolean-v1"].includes(id),
      ),
    );
    const failureSchemas = Object.fromEntries(
      Object.entries(r.failureSchemas).filter(
        ([id]) => id !== "schema:pel-host-failure-v1",
      ),
    );
    const registry = createHostRegistry(
      r.descriptors.filter(
        (d) => record(d) && d.id !== "print" && d.id !== "pel/nl-condition",
      ) as never,
      dataSchemas as never,
      failureSchemas as never,
      r.resolverCatalog as never,
    );
    if (!registry.ok || !same(r, registry.value))
      return fail("Registry content or digest mismatch");
    if (
      registry.value.descriptors.some((d) =>
        [...d.resources.reads, ...d.resources.writes].some(
          (id) => !isNormalizedAuthoringResourceId(id),
        ),
      )
    )
      return fail("Registry resources must be finite normalized IDs");
    if (!same(v.resourceResolvers, registry.value.resolverCatalog))
      return fail("Resolver content differs from the registry");
    const s = {
      ...v,
      registry: registry.value,
    } as unknown as AuthoringSnapshotV1;
    if (
      !keys(v.limits, Object.keys(PEL_PROFILE.limits)) ||
      Object.entries(v.limits).some(
        ([key, n]) =>
          !natural(n) ||
          n > PEL_PROFILE.limits[key as keyof typeof PEL_PROFILE.limits],
      )
    )
      return fail("Invalid or widened language limits");
    if (
      !keys(v.generationLimits, [
        "maxSourceBytes",
        "maxInputTokens",
        "maxOutputTokens",
        "maxCostUnits",
        "attemptTimeoutMs",
        "maxElapsedMs",
        "maxRepairs",
      ]) ||
      Object.values(v.generationLimits).some((n) => !natural(n)) ||
      s.generationLimits.maxSourceBytes > 1048576 ||
      s.generationLimits.attemptTimeoutMs > 60000 ||
      s.generationLimits.maxElapsedMs > 180000 ||
      s.generationLimits.maxRepairs > 2
    )
      return fail("Generation limits are missing, widened, or nonfinite");
    const p = v.policy;
    if (
      !keys(p, [
        "allowedCapabilities",
        "allowedEffectKinds",
        "allowedModelTransports",
        "resourceEnvelope",
        "allowedSchemaIds",
        "allowedGates",
        "allowedReviewPolicies",
        "allowedDestinations",
        "allowedCredentialProfileRefs",
        "artifactConstraints",
        "maxEffects",
        "maxCostUnits",
        "maxElapsedMs",
        "maxOutputBytes",
      ])
    )
      return fail("Policy fields are invalid");
    for (const key of [
      "allowedCapabilities",
      "allowedEffectKinds",
      "allowedSchemaIds",
      "allowedGates",
      "allowedReviewPolicies",
      "allowedDestinations",
      "allowedCredentialProfileRefs",
    ])
      if (!names(p[key])) return fail(`Invalid policy ${key}`);
    if (
      !keys(p.resourceEnvelope, ["reads", "writes"]) ||
      !names(p.resourceEnvelope.reads) ||
      !names(p.resourceEnvelope.writes) ||
      [...p.resourceEnvelope.reads, ...p.resourceEnvelope.writes].some(
        (id) => !isNormalizedAuthoringResourceId(id),
      ) ||
      !keys(p.artifactConstraints, ["allowedIds", "maxBytes"]) ||
      !names(p.artifactConstraints.allowedIds) ||
      p.artifactConstraints.allowedIds.some(
        (id) =>
          !id.startsWith("artifact:") || !isNormalizedAuthoringResourceId(id),
      ) ||
      !natural(p.artifactConstraints.maxBytes)
    )
      return fail("Policy resource or artifact bounds are invalid");
    if (
      ![p.maxEffects, p.maxCostUnits, p.maxElapsedMs, p.maxOutputBytes].every(
        natural,
      )
    )
      return fail("Policy budgets must be finite nonnegative integers");
    if (
      !Array.isArray(p.allowedModelTransports) ||
      !p.allowedModelTransports.every(
        (pair) =>
          keys(pair, ["profileId", "transportId"]) &&
          typeof pair.profileId === "string" &&
          typeof pair.transportId === "string",
      ) ||
      new Set(
        p.allowedModelTransports.map((pair) => canonicalAuthoringJson(pair)),
      ).size !== p.allowedModelTransports.length
    )
      return fail("Invalid model/transport policy");
    if (!Array.isArray(v.providerProfiles) || v.providerProfiles.length > 1000)
      return fail("Provider profiles are missing");
    const pairs = new Set<string>();
    for (const raw of v.providerProfiles) {
      if (
        !keys(raw, [
          "profileId",
          "transportId",
          "evidenceKind",
          "supportedControls",
          "applicationDefaults",
          "grammarSupport",
        ]) ||
        typeof raw.profileId !== "string" ||
        typeof raw.transportId !== "string" ||
        !names([raw.profileId]) ||
        !names([raw.transportId]) ||
        !["documented", "qualified", "fixture"].includes(
          String(raw.evidenceKind),
        ) ||
        !["qualified", "unsupported", "unknown"].includes(
          String(raw.grammarSupport),
        )
      )
        return fail("Invalid provider profile");
      const pair = raw.profileId + "/" + raw.transportId;
      if (pairs.has(pair)) return fail("Duplicate provider profile/transport");
      pairs.add(pair);
      const c = raw.supportedControls;
      if (
        !keys(c, [
          "efforts",
          "thinkingModes",
          "sampling",
          "toolChoices",
          "executionModes",
          "store",
          "budgetTokens",
        ]) ||
        ![
          c.efforts,
          c.thinkingModes,
          c.sampling,
          c.toolChoices,
          c.executionModes,
        ].every(names) ||
        !Array.isArray(c.store) ||
        new Set(c.store).size !== c.store.length ||
        !c.store.every(
          (x) => x === "provider-default" || typeof x === "boolean",
        ) ||
        typeof c.budgetTokens !== "boolean"
      )
        return fail("Invalid supported controls");
      for (const [key, allowed] of Object.entries({
        efforts: ["none", "low", "medium", "high", "xhigh", "max"],
        thinkingModes: ["provider-default", "adaptive", "enabled", "disabled"],
        sampling: ["temperature", "topP", "topK"],
        toolChoices: ["auto", "none", "required", "named"],
        executionModes: ["foreground", "background"],
      }))
        if (!(c[key] as string[]).every((x) => allowed.includes(x)))
          return fail("Unknown supported control value");
      const controls = validateAuthoringControlsV1(
        raw.applicationDefaults,
        raw as unknown as AuthoringProviderProfileV1,
      );
      if (!controls.ok) return controls;
    }
    if (
      s.policy.allowedModelTransports.some(
        (pair) => !pairs.has(pair.profileId + "/" + pair.transportId),
      )
    )
      return fail("Policy references missing provider profile");
    if (
      s.policy.allowedSchemaIds.some(
        (id) => !Object.hasOwn(registry.value.dataSchemas, id),
      )
    )
      return fail("Policy references missing schema");
    if (
      !s.policy.allowedCredentialProfileRefs.includes(
        s.defaultCredentialProfileRef,
      ) ||
      !["ordered", "automatic"].includes(s.dependencyMode) ||
      !s.policy.allowedSchemaIds.includes(s.resultContract)
    )
      return fail("Invalid credential, dependency mode, or result contract");
    if (
      !record(v.roleBindings) ||
      Object.keys(v.roleBindings).some(
        (id) => !/^role:[a-zA-Z0-9._-]+$/.test(id),
      )
    )
      return fail("Invalid role binding IDs");
    for (const role of Object.values(v.roleBindings)) {
      const result = validateSelection(s, role);
      if (!result.ok) return result;
    }
    if (v.nlConditionProfile !== null) {
      const result = validateSelection(s, v.nlConditionProfile, true);
      if (!result.ok) return result;
    }
    if (
      !Array.isArray(v.artifactDescriptors) ||
      v.artifactDescriptors.length > 1000
    )
      return fail("Missing artifact descriptors");
    const ids = new Set<string>();
    for (const a of v.artifactDescriptors) {
      if (
        !keys(a, ["id", "schemaId", "content"]) ||
        typeof a.id !== "string" ||
        !/^artifact:[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(a.id) ||
        a.id.includes("//") ||
        a.id.split("/").some((x) => x === ".." || x === ".") ||
        ids.has(a.id) ||
        typeof a.schemaId !== "string" ||
        !s.policy.allowedSchemaIds.includes(a.schemaId) ||
        !s.policy.artifactConstraints.allowedIds.includes(a.id) ||
        Buffer.byteLength(canonicalAuthoringJson(a.content)) >
          s.policy.artifactConstraints.maxBytes
      )
        return fail("Artifact identity, schema, or content bounds are invalid");
      ids.add(a.id);
    }
    const expected = computed(s);
    if (!same(s, expected))
      return fail(
        "Snapshot content does not match its canonical component digests",
        "PEL_BINDING_MISMATCH",
      );
    return { ok: true, value: freeze(s) };
  } catch {
    return fail("Snapshot contains malformed or non-declarative data");
  }
}
export function buildEffectiveAuthoringSnapshotV1(
  base: AuthoringSnapshotV1,
  selection: EffectiveAuthoringSelectionV1 = {},
): Result<AuthoringSnapshotV1, AuthoringDiagnostic[]> {
  const valid = validateAuthoringSnapshotV1(base);
  if (!valid.ok) return valid;
  try {
    canonicalAuthoringJson(selection);
    if (
      !keys(
        selection as unknown,
        [],
        [
          "roleBindings",
          "nlConditionProfile",
          "dependencyMode",
          "resultContract",
          "narrowingLimits",
          "narrowingBudgets",
        ],
      )
    )
      return fail("Unknown effective selection field", "PEL_INVALID_SELECTION");
    const limits = { ...base.limits };
    const policy = { ...base.policy };
    for (const [input, target, allowed] of [
      [selection.narrowingLimits, limits, Object.keys(limits)],
      [
        selection.narrowingBudgets,
        policy,
        ["maxEffects", "maxCostUnits", "maxElapsedMs"],
      ],
    ] as const) {
      if (input === undefined) continue;
      if (!keys(input, [], allowed))
        return fail("Unknown narrowing limit", "PEL_INVALID_SELECTION");
      for (const [key, n] of Object.entries(input)) {
        const obj = target as unknown as Record<string, unknown>;
        if (
          !natural(n) ||
          typeof obj[key] !== "number" ||
          n > (obj[key] as number)
        )
          return fail(`Selection cannot widen ${key}`, "PEL_INVALID_SELECTION");
        obj[key] = n;
      }
    }
    return createAuthoringSnapshotV1({
      ...base,
      limits,
      policy,
      roleBindings:
        selection.roleBindings === undefined
          ? base.roleBindings
          : { ...base.roleBindings, ...selection.roleBindings },
      nlConditionProfile:
        selection.nlConditionProfile === undefined
          ? base.nlConditionProfile
          : selection.nlConditionProfile,
      dependencyMode: selection.dependencyMode ?? base.dependencyMode,
      resultContract: selection.resultContract ?? base.resultContract,
    });
  } catch {
    return fail("Invalid effective selection", "PEL_INVALID_SELECTION");
  }
}
