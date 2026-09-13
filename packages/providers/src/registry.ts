import type { Result } from "@foreman/pel";
import type {
  AdmissionBindingV1,
  Capability,
  CapabilityEvidenceV1,
  ProviderIdentityV1,
  ToolPolicyV1,
  TransportId,
} from "./contract.js";
import type { ProviderFailure } from "./errors.js";
import {
  PROVIDER_PROFILES,
  controlsHash,
  documentedCapability,
  resolveProfile,
  validateProfileControls,
  type ProviderProfileV1,
} from "./profiles.js";
const fail = (
  tag: "ModelUnavailable" | "UnsupportedCapability" | "CapabilityUnverified",
  message: string,
  fieldPath: string,
): Result<never, ProviderFailure> => ({
  ok: false,
  error: { _tag: tag, retryClass: "never", message, fieldPath },
});
export function isNativeTransport(id: TransportId): boolean {
  return ["grok-acp", "claude-code", "codex-app-server", "gemini-cli"].includes(
    id,
  );
}
export function exactIdentity(
  profile: ProviderProfileV1,
  transportId: TransportId,
  identity: ProviderIdentityV1 | undefined,
  credentialProfileRef: string,
  expectedIdentityRevision?: string,
): boolean {
  return (
    identity !== undefined &&
    identity.profileId === profile.id &&
    (identity.model === undefined || identity.model === profile.exactModel) &&
    identity.provider === profile.provider &&
    identity.transportId === transportId &&
    identity.credentialProfileRef === credentialProfileRef &&
    (expectedIdentityRevision === undefined ||
      (identity.kind === "api" ? identity.endpointRevision : identity.protocolVersion) === expectedIdentityRevision) &&
    (isNativeTransport(transportId)
      ? identity.kind === "native" &&
        identity.protocolVersion.length > 0 &&
        identity.sessionId.length > 0
      : identity.kind === "api" &&
        identity.endpointRevision.length > 0 &&
        identity.responseId.length > 0)
  );
}
export interface AdmittedCellV1 {
  readonly expectedIdentityRevision: string;
  readonly profile: ProviderProfileV1;
  readonly transportId: TransportId;
  readonly transportVersion: string;
  readonly controls: AdmissionBindingV1["controls"];
  readonly evidence: readonly CapabilityEvidenceV1[];
  readonly bindingKind: AdmissionBindingV1["kind"];
}
export function admitCell(
  profileId: string,
  transportId: TransportId,
  requiredCapabilities: readonly Capability[],
  evidence: readonly CapabilityEvidenceV1[],
  binding: AdmissionBindingV1,
): Result<AdmittedCellV1, ProviderFailure> {
  if (typeof binding.expectedIdentityRevision !== "string" || !binding.expectedIdentityRevision.trim())
    return fail("CapabilityUnverified", "An explicit endpoint or protocol revision is required", "expectedIdentityRevision");
  const profile = resolveProfile(profileId);
  if (!profile.ok) return profile;
  if (!profile.value.transports.includes(transportId))
    return fail(
      "ModelUnavailable",
      "Exact profile and transport pair is unavailable",
      "transportId",
    );
  const required = new Set(requiredCapabilities);
  if (required.has("codingTask")) {
    required.add("permissionBoundary");
    required.add("workspaceBoundary");
  }
  if (binding.controls.execution.mode === "background")
    required.add("background");
  if (typeof binding.controls.execution.store === "boolean")
    required.add("store");
  const checked = validateProfileControls(
    profileId,
    binding.controls,
    transportId,
    [...required],
  );
  if (!checked.ok) return checked;
  const accepted: CapabilityEvidenceV1[] = [];
  for (const capability of required) {
    if (
      documentedCapability(profile.value, transportId, capability) ===
      "unsupported"
    )
      return fail(
        "UnsupportedCapability",
        `Transport does not support ${capability}`,
        capability,
      );
    const found = evidence.find(
      (e) =>
        e.capability === capability &&
        e.profileId === profileId &&
        e.transportId === transportId &&
        e.profileHash === profile.value.profileHash &&
        e.sourceManifestHash === profile.value.sourceManifestHash &&
        e.transportVersion === binding.transportVersion &&
        e.controlsHash === controlsHash(binding.controls) &&
        Number.isFinite(e.observedAt) &&
        e.observedAt <= binding.now &&
        Number.isFinite(e.expiresAt) &&
        e.expiresAt > binding.now &&
        e.expiresAt > e.observedAt &&
        e.evidenceRef.length > 0 &&
        exactIdentity(
          profile.value,
          transportId,
          e.observedIdentity,
          binding.credentialProfileRef,
          binding.expectedIdentityRevision,
        ) &&
        (binding.kind === "product"
          ? e.state === "live-qualified" && e.fixtureManifestHash === undefined
          : e.state === "fixture-tested" &&
            e.fixtureManifestHash === binding.fixtureManifestHash &&
            e.endpointIdentity === binding.endpointIdentity),
    );
    if (!found)
      return fail(
        "CapabilityUnverified",
        `No matching current ${binding.kind} evidence for ${capability}`,
        capability,
      );
    accepted.push(found);
  }
  return {
    ok: true,
    value: {
      expectedIdentityRevision: binding.expectedIdentityRevision,
      profile: profile.value,
      transportId,
      transportVersion: binding.transportVersion,
      controls: checked.value,
      evidence: accepted,
      bindingKind: binding.kind,
    },
  };
}
export function resolveTransport(
  profileId: string,
  selected: TransportId | undefined,
  admitted: readonly TransportId[],
): Result<TransportId, ProviderFailure> {
  const profile = resolveProfile(profileId);
  if (!profile.ok) return profile;
  const candidates = [
    ...new Set(admitted.filter((t) => profile.value.transports.includes(t))),
  ];
  if (selected !== undefined)
    return candidates.includes(selected)
      ? { ok: true, value: selected }
      : fail(
          "ModelUnavailable",
          "Selected profile and transport are not admitted",
          "transportId",
        );
  if (candidates.length === 0)
    return fail(
      "ModelUnavailable",
      "No transport is admitted for this exact profile",
      "transportId",
    );
  if (candidates.length !== 1)
    return fail(
      "UnsupportedCapability",
      "Transport selection is ambiguous; select an explicit transport",
      "transportId",
    );
  return { ok: true, value: candidates[0]! };
}
export function validateToolPolicy(
  transportId: TransportId,
  policy: ToolPolicyV1,
  operation: "generation" | "review" | "codingTask",
): Result<ToolPolicyV1, ProviderFailure> {
  if (
    operation === "codingTask" &&
    (!isNativeTransport(transportId) || policy.mode !== "native-coding")
  )
    return fail(
      "UnsupportedCapability",
      "Coding requires a native host permission and workspace boundary",
      "toolPolicy",
    );
  if (operation !== "codingTask" && policy.mode !== "none")
    return fail(
      "UnsupportedCapability",
      "Generation and review require toolPolicy none",
      "toolPolicy",
    );
  if (
    policy.mode === "native-coding" &&
    (!policy.workspaceGrantId ||
      !policy.hostPermissionPortRef ||
      policy.permissionGrantIds.some((g) => !g))
  )
    return fail(
      "UnsupportedCapability",
      "Native grants must be explicit",
      "toolPolicy",
    );
  return { ok: true, value: policy };
}
export interface ProviderCellViewV1 {
  readonly profileId: string;
  readonly transportId: TransportId;
  readonly profileHash: string;
  readonly sourceManifestHash: string;
  readonly status:
    "unavailable" | "documented" | "test-fixture" | "live-qualified" | "stale";
  readonly capabilities: readonly {
    readonly capability: Capability;
    readonly state: string;
  }[];
}
const listedCapabilities: readonly Capability[] = [
  "generation",
  "review",
  "codingTask",
  "structuredOutput",
  "grammar",
  "permissionBoundary",
  "workspaceBoundary",
  "toolPolicyNone",
  "continuation",
  "cursorReplay",
  "remoteCancellation",
  "reconcile",
  "background",
  "store",
  "promptChannel",
];
export function listProviderCells(
  evidence: readonly CapabilityEvidenceV1[],
  now: number,
  bindings: readonly {
    readonly profileId: string;
    readonly transportId: TransportId;
    readonly binding: AdmissionBindingV1;
  }[] = [],
): readonly ProviderCellViewV1[] {
  return PROVIDER_PROFILES.flatMap((profile) =>
    profile.transports.map((transportId) => {
      const matching = evidence.filter(
        (e) =>
          e.profileId === profile.id &&
          e.transportId === transportId &&
          e.profileHash === profile.profileHash &&
          e.sourceManifestHash === profile.sourceManifestHash,
      );
      const current = bindings.find(
        (b) => b.profileId === profile.id && b.transportId === transportId,
      )?.binding;
      const capabilities = listedCapabilities.map((capability) => {
        const records = matching.filter((e) => e.capability === capability);
        const fresh =
          current?.kind === "product" &&
          admitCell(profile.id, transportId, [capability], records, {
            ...current,
            now,
          }).ok;
        const fixture = records.find(
          (e) =>
            e.state === "fixture-tested" &&
            e.fixtureManifestHash !== undefined &&
            e.expiresAt > now &&
            e.observedAt <= now,
        );
        return {
          capability,
          state: fresh
            ? "live-qualified"
            : fixture
              ? "test-fixture"
              : records.length
                ? "stale"
                : documentedCapability(profile, transportId, capability),
        };
      });
      const execution = capabilities.find(
        (c) => c.capability === "generation",
      )!;
      const status: ProviderCellViewV1["status"] =
        execution.state === "live-qualified"
          ? "live-qualified"
          : execution.state === "test-fixture"
            ? "test-fixture"
            : execution.state === "stale"
              ? "stale"
              : execution.state === "unsupported"
                ? "unavailable"
                : "documented";
      return {
        profileId: profile.id,
        transportId,
        profileHash: profile.profileHash,
        sourceManifestHash: profile.sourceManifestHash,
        status,
        capabilities,
      };
    }),
  );
}
