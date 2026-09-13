import { Effect, Stream } from "effect";
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { isCoreFailure, parseJsonRejectDuplicateKeys } from "@foreman/core";
import { ProviderGenerationPort } from "../../providers/src/contract.js";
import {
  generatePelPlan,
  makeGenerationRequest,
  makeGenerationBudget,
  GenerationBudgetPort,
} from "./pel-generation.js";
import {
  nodeAuthoringInput,
  nodeAuthoringOutput,
  runPelAuthoringMain,
} from "./pel-authoring-main.js";
import { authoringFailure } from "./pel-authoring-contract.js";
import {
  resolveProfile,
  controlsHash,
  listProviderCells,
  runQualification,
  decodeProviderResult,
} from "../../providers/src/index.js";
import type {
  ProviderTransport,
  ProviderIdentityV1,
  ProviderRequestV1,
  ProviderEventV1,
  CapabilityEvidenceV1,
  ProfileId,
  TransportId,
} from "../../providers/src/contract.js";
import type { ProviderFailure } from "../../providers/src/errors.js";
import type { ProviderCliServices } from "./pel-provider-cli.js";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const hashPattern = /^[a-f0-9]{64}$/;
const snapshotPath = "runtime/assets/pel/default-authoring-snapshot.json";
const safeRelativePath = (path: string) =>
  path.length > 0 &&
  Buffer.byteLength(path) <= 4096 &&
  !isAbsolute(path) &&
  !/[\\:\0]/.test(path) &&
  path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
const within = (root: string, path: string) => {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith("../") && !isAbsolute(part);
};

interface ProviderFixtureCell {
  readonly profileId: ProfileId;
  readonly transportId: TransportId;
  readonly credentialProfileRef: string;
  readonly scenario:
    | "completed"
    | "refused"
    | "truncated"
    | "disconnected"
    | "model-mismatch"
    | "authentication-required"
    | "cancelled";
}
interface ProviderFixtures {
  readonly now: number;
  readonly endpointIdentity: string;
  readonly cells: readonly ProviderFixtureCell[];
}
function decodeProviderFixtures(value: unknown) {
  return Effect.gen(function* () {
    const bad = () =>
      authoringFailure(
        "PEL_SCHEMA",
        "Invalid bounded provider fixture manifest",
      );
    if (
      !record(value) ||
      !Number.isSafeInteger(value.now) ||
      Number(value.now) <= 0 ||
      typeof value.endpointIdentity !== "string" ||
      !/^fake:\/\/[a-zA-Z0-9/_.-]+$/.test(value.endpointIdentity) ||
      value.endpointIdentity.length > 512 ||
      !Array.isArray(value.cells) ||
      value.cells.length < 1 ||
      value.cells.length > 12 ||
      Object.keys(value).some(
        (k) => !["now", "endpointIdentity", "cells"].includes(k),
      )
    )
      return yield* Effect.fail(bad());
    const cells: ProviderFixtureCell[] = [];
    const seen = new Set<string>();
    for (const cell of value.cells) {
      if (
        !record(cell) ||
        typeof cell.profileId !== "string" ||
        typeof cell.transportId !== "string" ||
        typeof cell.credentialProfileRef !== "string" ||
        !/^fixture:[a-zA-Z0-9_.-]+$/.test(cell.credentialProfileRef) ||
        typeof cell.scenario !== "string" ||
        ![
          "completed",
          "refused",
          "truncated",
          "disconnected",
          "model-mismatch",
          "authentication-required",
          "cancelled",
        ].includes(cell.scenario) ||
        Object.keys(cell).some(
          (k) =>
            ![
              "profileId",
              "transportId",
              "credentialProfileRef",
              "scenario",
            ].includes(k),
        )
      )
        return yield* Effect.fail(bad());
      const profile = resolveProfile(cell.profileId);
      if (
        !profile.ok ||
        !profile.value.transports.includes(cell.transportId as TransportId)
      )
        return yield* Effect.fail(bad());
      const key = cell.profileId + "/" + cell.transportId;
      if (seen.has(key)) return yield* Effect.fail(bad());
      seen.add(key);
      cells.push(cell as unknown as ProviderFixtureCell);
    }
    return {
      now: Number(value.now),
      endpointIdentity: value.endpointIdentity,
      cells,
    } satisfies ProviderFixtures;
  });
}
function fixtureProviderServices(
  fixtures: ProviderFixtures,
  manifestHash: string,
): ProviderCliServices {
  const fail = (message: string): ProviderFailure => ({
    _tag: "UnsupportedCapability",
    retryClass: "never",
    message,
  });
  const identity = (cell: ProviderFixtureCell): ProviderIdentityV1 => {
    const profile = resolveProfile(cell.profileId);
    if (!profile.ok) throw new Error("Validated fixture profile disappeared");
    const base = {
      provider: profile.value.provider,
      profileId: cell.profileId,
      model: cell.profileId,
      transportId: cell.transportId,
      credentialProfileRef: cell.credentialProfileRef,
    };
    return [
      "xai-responses",
      "anthropic-messages",
      "openai-responses",
      "google-interactions",
    ].includes(cell.transportId)
      ? {
          ...base,
          kind: "api",
          endpointRevision: "fixture-v1",
          responseId: "fixture-response",
        }
      : {
          ...base,
          kind: "native",
          protocolVersion: "fixture-v1",
          sessionId: "fixture-session",
          threadId: "fixture-thread",
          turnId: "fixture-turn",
        };
  };
  const evidence: CapabilityEvidenceV1[] = fixtures.cells
    .filter((c) => c.scenario === "completed")
    .map((cell) => {
      const p = resolveProfile(cell.profileId);
      if (!p.ok) throw new Error("Validated fixture profile disappeared");
      return {
        capability: "generation",
        state: "fixture-tested",
        profileId: cell.profileId,
        transportId: cell.transportId,
        profileHash: p.value.profileHash,
        sourceManifestHash: p.value.sourceManifestHash,
        transportVersion: "fixture-v1",
        controlsHash: controlsHash(p.value.defaults),
        observedAt: fixtures.now,
        expiresAt: fixtures.now + 60000,
        observedIdentity: identity(cell),
        evidenceRef: "fixture:provider-list",
        fixtureManifestHash: manifestHash,
        endpointIdentity: fixtures.endpointIdentity,
      };
    });
  return {
    now: () => fixtures.now,
    fixtureBinding: {
      manifestHash,
      endpointIdentity: fixtures.endpointIdentity,
    },
    list: () => Effect.succeed(listProviderCells(evidence, fixtures.now)),
    qualify: (selection) =>
      Effect.gen(function* () {
        if (
          selection.binding.kind !== "qualification-fixture" ||
          selection.binding.fixtureManifestHash !== manifestHash ||
          selection.binding.endpointIdentity !== fixtures.endpointIdentity
        )
          return yield* Effect.fail(
            fail("Fixture service cannot mint product qualification evidence"),
          );
        const cell = fixtures.cells.find(
          (c) =>
            c.profileId === selection.profileId &&
            c.transportId === selection.transportId &&
            c.credentialProfileRef === selection.credentialProfileRef,
        );
        if (!cell)
          return yield* Effect.fail(
            fail(
              "Exact fixture model, transport and account are not in this manifest",
            ),
          );
        const p = resolveProfile(cell.profileId);
        if (!p.ok) return yield* Effect.fail(p.error);
        const requestedIdentity = identity(cell);
        const request: ProviderRequestV1 = {
          schemaVersion: 1,
          effectId: "fixture:qualification",
          profileId: cell.profileId,
          transportId: cell.transportId,
          trustedInstructions: "Return the harmless boolean true.",
          artifacts: [],
          toolPolicy: { mode: "none" },
          outputSchema: {
            id: "schema:pel-boolean-v1",
            content: { type: "boolean" },
          },
          controls: selection.controls,
          limits: selection.limits,
          credentialProfileRef: cell.credentialProfileRef,
          profileHash: p.value.profileHash,
          sourceManifestHash: p.value.sourceManifestHash,
          transportVersion: "fixture-v1",
        };
        const event = (
          payload: ProviderEventV1["payload"],
          cursor: string,
        ): ProviderEventV1 => ({
          schemaVersion: 1,
          effectId: request.effectId,
          providerIdentity:
            cell.scenario === "model-mismatch"
              ? {
                  ...requestedIdentity,
                  profileId: "unrequested-model",
                  model: "unrequested-model",
                }
              : requestedIdentity,
          sourceEventId: cursor,
          cursor,
          payload,
        });
        const unsupported = () =>
          Effect.fail(
            fail(
              "Fixture exposes no unrequested network, credential, tool or lifecycle operation",
            ),
          );
        const transport: ProviderTransport = {
          id: cell.transportId,
          version: "fixture-v1",
          probe: () =>
            Effect.fail({
              _tag: "ProbeUnknown",
              retryClass: "never",
              message: "Fixture metadata uses the bound manifest only",
            }),
          start: () =>
            Effect.gen(function* () {
              if (cell.scenario === "authentication-required")
                return yield* Effect.fail({
                  _tag: "AuthenticationRequired",
                  retryClass: "never",
                  message: "Fixture selected account is signed out",
                } as const);
              const started = event({ type: "started" }, "start");
              if (cell.scenario === "disconnected")
                return Stream.concat(
                  Stream.make(started),
                  Stream.fail({
                    _tag: "TransportDisconnected",
                    retryClass: "transient",
                    message: "Fixture stream disconnected",
                  } as const),
                );
              if (cell.scenario === "truncated")
                return Stream.concat(
                  Stream.make(started),
                  Stream.fail({
                    _tag: "OutputIncomplete",
                    retryClass: "never",
                    message: "Fixture output was truncated",
                  } as const),
                );
              if (cell.scenario === "refused")
                return Stream.make(
                  started,
                  event(
                    { type: "refused", message: "Fixture provider refused" },
                    "refused",
                  ),
                );
              if (cell.scenario === "cancelled")
                return Stream.make(
                  started,
                  event(
                    {
                      type: "cancelled",
                      observation: {
                        requested: true,
                        acknowledged: true,
                        localCleanup: "complete",
                        remoteOutcome: "cancelled",
                      },
                    },
                    "cancelled",
                  ),
                );
              const result = decodeProviderResult(
                '{"value":true}',
                request.outputSchema,
                request.limits.maxOutputBytes,
              );
              if (!result.ok) return yield* Effect.fail(result.error);
              return Stream.make(
                started,
                event(
                  {
                    type: "completed",
                    result: result.value,
                    usage: {
                      inputTokens: 1,
                      outputTokens: 1,
                      providerCounters: {},
                    },
                  },
                  "completed",
                ),
              );
            }),
          sendToolResult: unsupported,
          cancel: () =>
            Effect.succeed({
              requested: true,
              acknowledged: false,
              localCleanup: "complete",
              remoteOutcome: "unknown",
            }),
          observe: () =>
            Effect.succeed({
              status: "unsupported",
              providerIdentity: requestedIdentity,
              reason: "Fixture does not expose remote observation",
            }),
          resume: unsupported,
        };
        return yield* runQualification(
          {
            request,
            requiredCapabilities: selection.requiredCapabilities,
            binding: selection.binding,
          },
          { transport, now: () => fixtures.now },
        );
      }),
  };
}

function readAsset(root: string, path: string, maxBytes: number) {
  return Effect.gen(function* () {
    if (!safeRelativePath(path))
      return yield* Effect.fail(
        authoringFailure(
          "PEL_SCHEMA",
          "Asset path must be a normalized relative path",
          2,
          path,
        ),
      );
    const parts = path.split("/");
    for (let index = 1; index <= parts.length; index++) {
      const selected = join(root, ...parts.slice(0, index));
      const stat = yield* Effect.tryPromise({
        try: () => lstat(selected),
        catch: () =>
          authoringFailure(
            "PEL_INPUT",
            "Bound asset is unavailable",
            2,
            selected,
          ),
      });
      if (
        stat.isSymbolicLink() ||
        (index < parts.length && !stat.isDirectory()) ||
        (index === parts.length && !stat.isFile())
      )
        return yield* Effect.fail(
          authoringFailure(
            "PEL_SCHEMA",
            "Bound assets must be regular files beneath real directories",
            2,
            selected,
          ),
        );
    }
    return yield* nodeAuthoringInput.read(join(root, path), maxBytes);
  });
}

function loadAssets(assetRoot: string, expectedDigest: string) {
  return Effect.gen(function* () {
    if (
      !isAbsolute(assetRoot) ||
      resolve(assetRoot) !== assetRoot ||
      Buffer.byteLength(assetRoot) > 4096
    )
      return yield* Effect.fail(
        authoringFailure(
          "PEL_SCHEMA",
          "Asset root must be an absolute normalized directory",
        ),
      );
    const physical = yield* Effect.tryPromise({
      try: () => realpath(assetRoot),
      catch: () =>
        authoringFailure(
          "PEL_INPUT",
          "Asset root is unavailable",
          2,
          assetRoot,
        ),
    });
    if (physical !== assetRoot)
      return yield* Effect.fail(
        authoringFailure(
          "PEL_SCHEMA",
          "Asset root must not traverse symbolic links",
          2,
          assetRoot,
        ),
      );
    const bytes = yield* readAsset(assetRoot, "manifest.json", 1024 * 1024);
    if (sha256(bytes) !== expectedDigest)
      return yield* Effect.fail(
        authoringFailure(
          "PEL_SCHEMA",
          "Asset manifest digest does not match the fixture binding",
        ),
      );
    const manifest = parseJsonRejectDuplicateKeys(
      new TextDecoder().decode(bytes),
    );
    if (
      isCoreFailure(manifest) ||
      !record(manifest) ||
      manifest.schemaVersion !== 1 ||
      !Array.isArray(manifest.files) ||
      manifest.files.length < 1 ||
      manifest.files.length > 1000 ||
      Object.keys(manifest).some(
        (key) => !["schemaVersion", "files"].includes(key),
      )
    )
      return yield* Effect.fail(
        authoringFailure("PEL_SCHEMA", "Invalid bounded asset manifest"),
      );
    const assets = new Map<string, Uint8Array>();
    let total = 0;
    for (const file of manifest.files) {
      if (
        !record(file) ||
        typeof file.relativePath !== "string" ||
        !safeRelativePath(file.relativePath) ||
        typeof file.sha256 !== "string" ||
        !hashPattern.test(file.sha256) ||
        typeof file.byteLength !== "number" ||
        !Number.isSafeInteger(file.byteLength) ||
        file.byteLength < 0 ||
        file.byteLength > 16 * 1024 * 1024 ||
        Object.keys(file).some(
          (key) => !["relativePath", "sha256", "byteLength"].includes(key),
        )
      )
        return yield* Effect.fail(
          authoringFailure("PEL_SCHEMA", "Invalid bounded asset record"),
        );
      total += file.byteLength;
      const path = join(assetRoot, file.relativePath);
      if (total > 32 * 1024 * 1024 || assets.has(path))
        return yield* Effect.fail(
          authoringFailure(
            "PEL_SCHEMA",
            "Asset manifest has duplicate paths or exceeds its aggregate byte bound",
          ),
        );
      const content = yield* readAsset(
        assetRoot,
        file.relativePath,
        file.byteLength,
      );
      if (
        content.byteLength !== file.byteLength ||
        sha256(content) !== file.sha256
      )
        return yield* Effect.fail(
          authoringFailure(
            "PEL_SCHEMA",
            "Bound asset bytes do not match their manifest",
            2,
            path,
          ),
        );
      assets.set(path, content);
    }
    if (!assets.has(join(assetRoot, snapshotPath)))
      return yield* Effect.fail(
        authoringFailure(
          "PEL_SCHEMA",
          "Asset manifest omits the default authoring snapshot",
        ),
      );
    return assets;
  });
}

/** Test-only entry adapter. Importing this module does not invoke a command. */
export function runPelCliFixture(
  argv: readonly string[],
): Effect.Effect<number> {
  return Effect.gen(function* () {
    if (argv[0] !== "--fixture-manifest" || !argv[1])
      return yield* Effect.fail(
        authoringFailure(
          "PEL_CLI_USAGE",
          "Fixture entry requires --fixture-manifest FILE",
        ),
      );
    const bytes = yield* nodeAuthoringInput.read(argv[1], 4 * 1024 * 1024);
    const manifest = parseJsonRejectDuplicateKeys(
      new TextDecoder().decode(bytes),
    );
    if (
      isCoreFailure(manifest) ||
      manifest === null ||
      typeof manifest !== "object" ||
      Array.isArray(manifest) ||
      !("schemaVersion" in manifest) ||
      manifest.schemaVersion !== 1 ||
      !("fixtures" in manifest) ||
      !record(manifest.fixtures) ||
      !Array.isArray(manifest.fixtures.responses) ||
      Object.keys(manifest.fixtures).some(
        (key) => !["responses", "providers"].includes(key),
      ) ||
      !("assetRoot" in manifest) ||
      typeof manifest.assetRoot !== "string" ||
      !("assetManifestSha256" in manifest) ||
      typeof manifest.assetManifestSha256 !== "string" ||
      !hashPattern.test(manifest.assetManifestSha256) ||
      Object.keys(manifest).some(
        (k) =>
          ![
            "schemaVersion",
            "fixtures",
            "assetRoot",
            "assetManifestSha256",
          ].includes(k),
      )
    )
      return yield* Effect.fail(
        authoringFailure("PEL_SCHEMA", "Invalid fixture manifest"),
      );
    const responses = manifest.fixtures.responses;
    if (
      responses.length > 3 ||
      responses.some(
        (x) => typeof x !== "string" || Buffer.byteLength(x) > 1024 * 1024,
      )
    )
      return yield* Effect.fail(
        authoringFailure(
          "PEL_SCHEMA",
          "Fixture responses must contain at most three bounded Pel strings",
        ),
      );
    const assetRoot = manifest.assetRoot;
    const assets = yield* loadAssets(assetRoot, manifest.assetManifestSha256);
    const command = argv.slice(2);
    const providerFixtures =
      manifest.fixtures.providers === undefined
        ? undefined
        : yield* decodeProviderFixtures(manifest.fixtures.providers);
    if (command[0] === "providers" && !providerFixtures)
      return yield* Effect.fail(
        authoringFailure(
          "PEL_SCHEMA",
          "Provider commands require providers in the fixture manifest",
        ),
      );
    const contextIndex = command.indexOf("--context");
    const explicitContext =
      contextIndex < 0 ? undefined : command[contextIndex + 1];
    let at = 0;
    return yield* runPelAuthoringMain(command, {
      ...(providerFixtures
        ? {
            providers: fixtureProviderServices(providerFixtures, sha256(bytes)),
          }
        : {}),
      context: { defaultSnapshotPath: join(assetRoot, snapshotPath) },
      input: {
        read: (path, maxBytes) =>
          Effect.suspend(() => {
            const normalized = path.replace(/^\.\//, "");
            const assetReference =
              normalized.startsWith("examples/pel/") ||
              normalized.startsWith("runtime/assets/pel/");
            const absolute = resolve(
              assetReference ? assetRoot : process.cwd(),
              normalized,
            );
            if (
              path === explicitContext ||
              assetReference ||
              within(assetRoot, absolute)
            ) {
              if (!within(assetRoot, absolute))
                return Effect.fail(
                  authoringFailure(
                    "PEL_SCHEMA",
                    "Selected asset escapes the bound asset root",
                    2,
                    path,
                  ),
                );
              const bytes = assets.get(absolute);
              if (!bytes)
                return Effect.fail(
                  authoringFailure(
                    "PEL_SCHEMA",
                    "Selected asset is absent from the bound manifest",
                    2,
                    path,
                  ),
                );
              if (bytes.byteLength > maxBytes)
                return Effect.fail(
                  authoringFailure(
                    "PEL_INPUT",
                    "Selected asset exceeds the command input bound",
                    2,
                    path,
                  ),
                );
              return Effect.succeed(new Uint8Array(bytes));
            }
            return nodeAuthoringInput.read(path, maxBytes);
          }),
      },
      generate: (input) =>
        generatePelPlan(makeGenerationRequest(input), input.snapshot).pipe(
          Effect.provideService(
            GenerationBudgetPort,
            makeGenerationBudget(input.snapshot.generationLimits),
          ),
          Effect.provideService(ProviderGenerationPort, {
            generate: (request) => {
              const pelSource = responses[at++];
              if (typeof pelSource !== "string")
                return Effect.fail({
                  _tag: "OutputIncomplete" as const,
                  message: "No fixture response remains",
                  retryClass: "never" as const,
                });
              return Effect.succeed({
                pelSource,
                providerIdentity: {
                  kind: "api" as const,
                  provider: "fixture",
                  profileId: request.modelProfileId,
                  transportId: request.transportId,
                  credentialProfileRef: request.credentialProfileRef,
                  endpointRevision: "fixture-v1",
                  responseId: `fixture-${at}`,
                },
                providerRequestId: `fixture-${at}`,
                usage: {
                  inputTokens: 1,
                  outputTokens: 1,
                  providerCounters: { costUnits: 1 },
                },
              });
            },
          }),
        ),
    });
  }).pipe(
    Effect.catchAll((e) =>
      Effect.gen(function* () {
        if (argv.includes("--json"))
          yield* nodeAuthoringOutput
            .stdout(
              JSON.stringify({ schemaVersion: 1, tag: "invalid", ...e }) + "\n",
            )
            .pipe(Effect.ignore);
        else
          yield* nodeAuthoringOutput
            .stderr(`${e.code}: ${e.message}\n`)
            .pipe(Effect.ignore);
        return e.exitCode;
      }),
    ),
  );
}
