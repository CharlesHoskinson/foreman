import { Effect } from "effect";
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
      Object.keys(manifest.fixtures).some((key) => key !== "responses") ||
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
    const contextIndex = command.indexOf("--context");
    const explicitContext =
      contextIndex < 0 ? undefined : command[contextIndex + 1];
    let at = 0;
    return yield* runPelAuthoringMain(command, {
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
