/** Shared declarations only. Runtime handlers must bind these exact records. */
import {
  createHostRegistry,
  PEL_PROFILE,
  DEFAULT_LIMITS,
  createAuthoringSnapshotV1,
  type HostFunctionDescriptorSpecV1,
  type HostFailureSchemaV1,
  type PelDataSchemaV1,
  type JsonValue,
  type AuthoringProviderControlsV1,
  type AuthoringProviderProfileV1,
  type AuthoringSnapshotV1,
} from "@foreman/pel";
const string = (
  maxBytes = 4096,
  enums?: readonly string[],
): PelDataSchemaV1 => ({
  type: "string",
  maxBytes,
  ...(enums ? { enum: enums } : {}),
});
const list = (items: PelDataSchemaV1, maxItems = 1000): PelDataSchemaV1 => ({
  type: "list",
  items,
  minItems: 0,
  maxItems,
});
const association = (
  fields: readonly (readonly [string, PelDataSchemaV1])[],
): PelDataSchemaV1 => ({
  type: "association",
  fields: fields.map(([key, schema]) => ({ key, schema, required: true })),
  additionalKeys: false,
});
const nullable = (schema: PelDataSchemaV1): PelDataSchemaV1 => ({
  type: "union",
  variants: [{ type: "nil" }, schema],
});
const data: PelDataSchemaV1 = { type: "data", maxDepth: 32, maxBytes: 65536 };
const artifact = string();
const reference = nullable(artifact);
const findings = list(string());
const boolean: PelDataSchemaV1 = { type: "boolean" };
const task = association([
  ["status", string(64, ["candidate-ready", "no-change"])],
  ["candidate", reference],
  ["artifacts", list(artifact)],
  ["implementation-receipt", reference],
  ["findings", findings],
]);
const verify = association([
  ["status", string(64, ["verified", "verification-failed"])],
  ["passed", boolean],
  ["candidate", reference],
  ["task", task],
  ["verification", reference],
  ["checks", list(data)],
  ["findings", findings],
]);
const review = association([
  [
    "status",
    string(64, [
      "approved",
      "changes-requested",
      "unverified",
      "verification-failed",
    ]),
  ],
  ["approved", boolean],
  ["candidate", reference],
  ["verification", verify],
  ["review", reference],
  ["verdict", string(64, ["approved", "changes-requested", "unverified"])],
  ["findings", findings],
]);
const publish = association([
  ["status", string(64, ["published", "needs-action"])],
  ["candidate", reference],
  ["delivery", review],
  ["publication", reference],
  ["next-action", nullable(string())],
  ["findings", findings],
]);
const delivery: PelDataSchemaV1 = {
  type: "union",
  variants: [task, verify, review, publish],
};
const needsAction = association([
  ["status", string(64, ["needs-action"])],
  ["candidate", reference],
  ["delivery", delivery],
  ["reason", string()],
  ["round-count", { type: "number", integer: true, minimum: 0, maximum: 1000 }],
  ["findings", findings],
]);
const researchRow = association([
  ["sourceLocator", string()],
  ["hash", string(128)],
  ["capturedAt", string(128)],
  [
    "claimClass",
    string(128, ["primary", "secondary", "inference", "unverified"]),
  ],
  ["freshness", string(128, ["current", "stale", "unknown"])],
  ["excerpt", string(16384)],
  ["coverage", string(128, ["complete", "partial", "unknown"])],
]);
export const foremanDataSchemasV1: Readonly<Record<string, PelDataSchemaV1>> = {
  "schema:candidate-v1": association([
    ["summary", string(8192)],
    ["claimedPaths", list(string(), 1000)],
    ["findings", list(string(), 100)],
  ]),
  "schema:task-result-v1": task,
  "schema:verify-result-v1": verify,
  "schema:review-result-v1": review,
  "schema:publish-result-v1": publish,
  "schema:delivery-result-v1": delivery,
  "schema:delivery-needs-action-v1": needsAction,
  "schema:delivery-final-v1": {
    type: "union",
    variants: [needsAction, task, verify, review, publish],
  },
  "schema:checkpoint-result-v1": association([
    ["name", string()],
    [
      "sequence",
      {
        type: "number",
        integer: true,
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
      },
    ],
  ]),
  "schema:research-result-v1": association([
    ["status", string(64, ["complete", "partial", "unavailable"])],
    ["results", list(researchRow, 20)],
  ]),
  "schema:pel-source-v1": association([["pelSource", string(1048576)]]),
};
export const foremanFailureSchemasV1: Readonly<
  Record<string, HostFailureSchemaV1>
> = {
  "schema:foreman-failure-v1": {
    codes: [
      "capability-denied",
      "resource-denied",
      "schema-invalid",
      "verification-failed",
      "provider-failure",
      "timeout",
      "needs-action",
      "unknown-external-outcome",
    ],
    maxMessageBytes: 4096,
    maxCauseBytes: 65536,
    requiredCauseKeys: [],
  },
};
export const foremanResolverCatalogV1: Readonly<Record<string, JsonValue>> = {
  static: { version: 1 },
  "foreman-resources-v1": {
    version: 1,
    artifactPrefix: "artifact:",
    workspacePrefix: "workspace:",
    pathRules: {
      relativeOnly: true,
      rejectParentTraversal: true,
      rejectSymlinkEscape: true,
    },
    modelFields: ["model", "transport"],
    resourceFields: ["input", "bundle", "destination"],
    researchLimit: { minimum: 1, maximum: 20 },
    hostValidationRequired: true,
  },
};
const span = { start: 0, end: 0, line: 1, column: 1, endLine: 1, endColumn: 1 };
function descriptor(
  name: string,
  required: readonly string[],
  resultSchemaId: string,
  effectKind: string,
  capabilities: readonly string[],
  writes = false,
  optional?: "transport" | "limit",
): HostFunctionDescriptorSpecV1 {
  return {
    id: name,
    name,
    argSpec: {
      kind: "fixed",
      parameters: [
        ...required.map((name) => ({
          name,
          required: true,
          evaluation: "strict" as const,
        })),
        ...(optional
          ? [
              {
                name: optional,
                required: false,
                evaluation: "strict" as const,
                defaultExpression:
                  optional === "limit"
                    ? {
                        kind: "number" as const,
                        value: 5,
                        nodeId: `${name}:limit`,
                        span,
                      }
                    : {
                        kind: "nil" as const,
                        nodeId: `${name}:transport`,
                        span,
                      },
              },
            ]
          : []),
      ],
    },
    resultSchemaId,
    failureSchemaId: "schema:foreman-failure-v1",
    effectKind,
    capabilities,
    resources: {
      reads: ["workspace:default", "artifact:approved-spec"],
      writes: writes ? ["workspace:default"] : [],
      unknown: false,
    },
    resourceResolverId: "foreman-resources-v1",
    resourceEnvelope: {
      reads: ["workspace:default", "artifact:approved-spec"],
      writes: writes ? ["workspace:default"] : [],
      hostValidationRequired: true,
    },
  };
}
export const foremanDescriptorSpecsV1: readonly HostFunctionDescriptorSpecV1[] =
  [
    descriptor(
      "fm/task",
      ["id", "model", "input", "output"],
      "schema:task-result-v1",
      "task",
      ["task.execute"],
      true,
      "transport",
    ),
    descriptor(
      "fm/verify",
      ["id", "input", "gate"],
      "schema:verify-result-v1",
      "verify",
      ["verification.execute"],
    ),
    descriptor(
      "fm/review",
      ["id", "model", "input", "policy"],
      "schema:review-result-v1",
      "review",
      ["review.execute"],
      false,
      "transport",
    ),
    descriptor(
      "fm/publish",
      ["id", "input", "destination"],
      "schema:publish-result-v1",
      "publish",
      ["publication.write"],
    ),
    descriptor(
      "fm/race",
      ["tasks", "winner"],
      "schema:pel-data-v1",
      "race",
      [],
    ),
    descriptor(
      "fm/retry",
      ["attempts", "on", "body"],
      "schema:pel-data-v1",
      "retry",
      [],
    ),
    {
      ...descriptor(
        "fm/checkpoint",
        ["name"],
        "schema:checkpoint-result-v1",
        "journal",
        ["journal.write"],
      ),
      resources: { reads: [], writes: [], unknown: false },
      resourceEnvelope: { reads: [], writes: [] },
    },
    descriptor(
      "fm/research",
      ["id", "query", "bundle"],
      "schema:research-result-v1",
      "research",
      ["research.read"],
      false,
      "limit",
    ),
  ];
function profiles(): readonly AuthoringProviderProfileV1[] {
  const choices: readonly [
    string,
    readonly string[],
    readonly AuthoringProviderControlsV1["effort"][],
  ][] = [
    [
      "grok-4.6",
      ["grok-acp", "xai-responses"],
      ["low", "medium", "high", "xhigh"],
    ],
    [
      "gpt-5.6-sol",
      ["codex-app-server", "openai-responses"],
      ["none", "low", "medium", "high", "xhigh", "max"],
    ],
    [
      "gpt-6-astra",
      ["codex-app-server", "openai-responses"],
      ["low", "medium", "high", "xhigh", "max"],
    ],
    [
      "claude-opus-5",
      ["anthropic-messages", "claude-code"],
      ["low", "medium", "high", "xhigh", "max"],
    ],
    [
      "claude-fable-5-1",
      ["anthropic-messages", "claude-code"],
      ["low", "medium", "high", "xhigh", "max"],
    ],
    [
      "gemini-3.8-flash",
      ["google-interactions", "gemini-cli"],
      ["low", "medium", "high"],
    ],
  ];
  return choices.flatMap(([profileId, transports, efforts]) =>
    transports.map((transportId) => {
      const anthropic = profileId.startsWith("claude-");
      const fable = profileId === "claude-fable-5-1";
      return {
        profileId,
        transportId,
        evidenceKind: "documented" as const,
        grammarSupport: "unknown" as const,
        supportedControls: {
          efforts,
          thinkingModes: anthropic
            ? fable
              ? ["adaptive" as const]
              : ["adaptive" as const, "enabled" as const, "disabled" as const]
            : ["provider-default" as const],
          sampling: fable ? [] : ["temperature" as const, "topP" as const],
          toolChoices: fable
            ? ["auto" as const, "none" as const]
            : [
                "auto" as const,
                "none" as const,
                "required" as const,
                "named" as const,
              ],
          executionModes: ["foreground" as const],
          store: ["provider-default" as const],
          budgetTokens: anthropic && !fable,
        },
        applicationDefaults: {
          effort:
            profileId === "gpt-5.6-sol"
              ? ("medium" as const)
              : ("high" as const),
          thinking: {
            mode: anthropic
              ? ("adaptive" as const)
              : ("provider-default" as const),
          },
          sampling: {},
          toolChoice: "auto" as const,
          execution: {
            mode: "foreground" as const,
            store: "provider-default" as const,
          },
        },
      };
    }),
  );
}
/** Pure and deterministic: the build writes canonical UTF-8 bytes from this value. */
export function createDefaultAuthoringSnapshotV1(): AuthoringSnapshotV1 {
  const registry = createHostRegistry(
    foremanDescriptorSpecsV1,
    foremanDataSchemasV1,
    foremanFailureSchemasV1,
    foremanResolverCatalogV1,
  );
  if (!registry.ok) throw new Error(JSON.stringify(registry.error));
  const providerProfiles = profiles();
  const binding = (profileId: string, transportId: string) => ({
    profileId,
    transportId,
    controls: providerProfiles.find(
      (p) => p.profileId === profileId && p.transportId === transportId,
    )!.applicationDefaults,
    credentialProfileRef: "account:default",
  });
  const result = createAuthoringSnapshotV1({
    languageProfile: PEL_PROFILE,
    registry: registry.value,
    providerProfiles,
    policy: {
      allowedCapabilities: [
        "output.write",
        "model.predicate",
        "task.execute",
        "verification.execute",
        "review.execute",
        "publication.write",
        "journal.write",
        "research.read",
        "vault.read",
      ],
      allowedEffectKinds: [
        "write",
        "model",
        "task",
        "verify",
        "review",
        "publish",
        "race",
        "retry",
        "journal",
        "research",
      ],
      allowedModelTransports: providerProfiles.map(
        ({ profileId, transportId }) => ({ profileId, transportId }),
      ),
      resourceEnvelope: {
        reads: [
          "workspace:default",
          "artifact:approved-spec",
          "artifact:source-a",
          "artifact:source-b",
          "source:approved",
        ],
        writes: ["workspace:default", "host:output"],
      },
      allowedSchemaIds: Object.keys(registry.value.dataSchemas).sort(),
      allowedGates: [
        "candidate-full",
        "gate:default",
        "gate:tests",
        "gate:verify",
        "tests",
      ],
      allowedReviewPolicies: [
        "independent-review",
        "policy:independent-review",
        "policy:default",
      ],
      allowedDestinations: [
        "destination:pull-request",
        "destination:local",
        "pull-request",
      ],
      allowedCredentialProfileRefs: ["account:default", "account:test"],
      artifactConstraints: {
        allowedIds: [
          "artifact:approved-spec",
          "artifact:source-a",
          "artifact:source-b",
        ],
        maxBytes: 1048576,
      },
      maxEffects: 100,
      maxCostUnits: 1000000,
      maxElapsedMs: 3600000,
      maxOutputBytes: 16777216,
    },
    resourceResolvers: foremanResolverCatalogV1,
    roleBindings: {
      "role:implementer": binding("grok-4.6", "grok-acp"),
      "role:reviewer": binding("gpt-5.6-sol", "codex-app-server"),
    },
    nlConditionProfile: {
      ...binding("gpt-5.6-sol", "openai-responses"),
      controls: JSON.parse(
        JSON.stringify(binding("gpt-5.6-sol", "openai-responses").controls),
      ) as JsonValue,
      outputSchemaId: "schema:pel-boolean-v1",
    },
    artifactDescriptors: [
      {
        id: "artifact:approved-spec",
        schemaId: "schema:pel-data-v1",
        content: "Implement the approved change and verify it before review.",
      },
      {
        id: "artifact:source-a",
        schemaId: "schema:pel-data-v1",
        content: "Approved immutable source bundle A.",
      },
      {
        id: "artifact:source-b",
        schemaId: "schema:pel-data-v1",
        content: "Approved immutable source bundle B.",
      },
    ],
    limits: DEFAULT_LIMITS,
    generationLimits: {
      maxSourceBytes: 1048576,
      maxInputTokens: 100000,
      maxOutputTokens: 32000,
      maxCostUnits: 100000,
      attemptTimeoutMs: 60000,
      maxElapsedMs: 180000,
      maxRepairs: 2,
    },
    defaultCredentialProfileRef: "account:default",
    dependencyMode: "ordered",
    resultContract: "schema:delivery-final-v1",
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
