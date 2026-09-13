import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { Effect } from "effect";
import { isCoreFailure, parseJsonRejectDuplicateKeys } from "@foreman/core";
import type {
  CapabilityEvidenceV1,
  ProviderFailure,
  Capability,
} from "@foreman/providers";
import { resolveProfile } from "@foreman/providers";
import type { LiveProviderContext } from "./pel-provider-live.js";
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const fail = (fieldPath: string): ProviderFailure => ({
  _tag: "CapabilityUnverified",
  retryClass: "never",
  message: "Provider evidence is unavailable or invalid",
  fieldPath,
});
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const boundedString = (v: unknown) =>
  typeof v === "string" && v.length > 0 && Buffer.byteLength(v) <= 4096;
const caps: readonly Capability[] = [
  "generation",
  "review",
  "codingTask",
  "structuredOutput",
  "grammar",
  "tools",
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
/** Closed decoding never echoes file contents or unknown fields in diagnostics. */
export function decodeProviderEvidence(
  bytes: Uint8Array,
): Effect.Effect<readonly CapabilityEvidenceV1[], ProviderFailure> {
  return Effect.gen(function* () {
    if (bytes.length > 1024 * 1024) return yield* Effect.fail(fail("evidence"));
    const text = yield* Effect.try({
      try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      catch: () => fail("evidence"),
    });
    const value = parseJsonRejectDuplicateKeys(text);
    if (
      isCoreFailure(value) ||
      !record(value) ||
      value.schemaVersion !== 1 ||
      Object.keys(value).some(
        (k) => !["schemaVersion", "evidence"].includes(k),
      ) ||
      !Array.isArray(value.evidence) ||
      value.evidence.length > 512
    )
      return yield* Effect.fail(fail("evidence"));
    const result: CapabilityEvidenceV1[] = [];
    for (const entry of value.evidence) {
      if (
        !record(entry) ||
        Object.keys(entry).some(
          (k) =>
            ![
              "capability",
              "state",
              "profileId",
              "transportId",
              "profileHash",
              "sourceManifestHash",
              "transportVersion",
              "controlsHash",
              "observedAt",
              "expiresAt",
              "observedIdentity",
              "evidenceRef",
              "fixtureManifestHash",
              "endpointIdentity",
            ].includes(k),
        ) ||
        !caps.includes(entry.capability as Capability) ||
        ![
          "unknown",
          "unsupported",
          "documented",
          "fixture-tested",
          "live-qualified",
        ].includes(String(entry.state)) ||
        !boundedString(entry.profileId) ||
        !boundedString(entry.transportId) ||
        !hash(entry.profileHash) ||
        !hash(entry.sourceManifestHash) ||
        !hash(entry.controlsHash) ||
        !boundedString(entry.transportVersion) ||
        !boundedString(entry.evidenceRef) ||
        !Number.isSafeInteger(entry.observedAt) ||
        Number(entry.observedAt) < 0 ||
        !Number.isSafeInteger(entry.expiresAt) ||
        Number(entry.expiresAt) <= Number(entry.observedAt) ||
        (entry.fixtureManifestHash !== undefined &&
          !hash(entry.fixtureManifestHash)) ||
        (entry.endpointIdentity !== undefined &&
          !boundedString(entry.endpointIdentity))
      )
        return yield* Effect.fail(fail("evidence.record"));
      const p = resolveProfile(entry.profileId as string);
      if (
        !p.ok ||
        !p.value.transports.includes(
          entry.transportId as CapabilityEvidenceV1["transportId"],
        )
      )
        return yield* Effect.fail(fail("evidence.profileId"));
      if (entry.observedIdentity !== undefined) {
        const i = entry.observedIdentity;
        if (
          !record(i) ||
          !["api", "native"].includes(String(i.kind)) ||
          Object.keys(i).some(
            (k) =>
              ![
                "kind",
                "provider",
                "model",
                "profileId",
                "transportId",
                "credentialProfileRef",
                ...(i.kind === "api"
                  ? ["endpointRevision", "responseId"]
                  : ["protocolVersion", "sessionId", "threadId", "turnId"]),
              ].includes(k),
          ) ||
          ![
            "provider",
            "profileId",
            "transportId",
            "credentialProfileRef",
            ...(i.kind === "api"
              ? ["endpointRevision", "responseId"]
              : ["protocolVersion", "sessionId"]),
          ].every((k) => boundedString(i[k])) ||
          ["model", "threadId", "turnId"].some(
            (k) => i[k] !== undefined && !boundedString(i[k]),
          )
        )
          return yield* Effect.fail(fail("evidence.observedIdentity"));
      }
      result.push(entry as unknown as CapabilityEvidenceV1);
    }
    return result;
  });
}
/** Missing evidence fails closed; this reader never resolves credentials or opens a provider connection. */
export function readProviderEvidence(
  context: LiveProviderContext,
  mode: "generation" | "listing" = "generation",
): Effect.Effect<readonly CapabilityEvidenceV1[], ProviderFailure> {
  return Effect.gen(function* () {
    const ioFailure = (): ProviderFailure =>
      mode === "listing"
        ? {
            _tag: "ProbeUnknown",
            retryClass: "never",
            message: "Provider evidence could not be read",
            fieldPath: "evidence.file",
          }
        : fail("evidence.file");
    const path =
      context.environment.FOREMAN_PROVIDER_EVIDENCE ??
      join(context.stateRoot, "providers", "evidence.json");
    if (
      !isAbsolute(path) ||
      normalize(path) !== path ||
      path.includes("\0") ||
      Buffer.byteLength(path) > 4096
    )
      return yield* Effect.fail(fail("FOREMAN_PROVIDER_EVIDENCE"));
    const bytes = yield* Effect.scoped(
      Effect.gen(function* () {
        const file = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => open(path, constants.O_RDONLY | constants.O_NOFOLLOW),
            catch: (error) =>
              mode === "listing" &&
              (error as NodeJS.ErrnoException).code === "ENOENT" &&
              context.environment.FOREMAN_PROVIDER_EVIDENCE === undefined
                ? fail("evidence.defaultMissing")
                : (error as NodeJS.ErrnoException).code === "ELOOP"
                  ? fail("evidence.file")
                  : ioFailure(),
          }),
          (file) => Effect.promise(() => file.close()),
        );
        const stat = yield* Effect.tryPromise({
          try: () => file.stat(),
          catch: ioFailure,
        });
        if (!stat.isFile() || stat.size > 1024 * 1024)
          return yield* Effect.fail(fail("evidence.file"));
        const buffer = Buffer.alloc(1024 * 1024 + 1);
        let length = 0;
        while (length < buffer.length) {
          const read = yield* Effect.tryPromise({
            try: () => file.read(buffer, length, buffer.length - length, null),
            catch: ioFailure,
          });
          if (read.bytesRead === 0) break;
          length += read.bytesRead;
        }
        if (length > 1024 * 1024)
          return yield* Effect.fail(fail("evidence.file"));
        return buffer.subarray(0, length);
      }),
    ).pipe(
      Effect.catchIf(
        (error) =>
          mode === "listing" && error.fieldPath === "evidence.defaultMissing",
        () => Effect.succeed(Buffer.from('{"schemaVersion":1,"evidence":[]}')),
      ),
    );
    return yield* decodeProviderEvidence(bytes);
  });
}
