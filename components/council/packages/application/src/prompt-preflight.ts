import {
  canonicalizeCouncilAce,
  parseCouncilAce,
  validateReviewRules,
} from "@council/domain";
import {
  CanonicalCompiledPromptV1,
  type ContentHash,
  type ContractHash,
  CouncilPromptContractV1,
  decodeStrictSync,
  ProviderFamilyV1,
  type ReviewArtifactDescriptorV1,
  type Sha256Digest,
} from "@council/schema";
import { Cause, Effect, Option } from "effect";
import {
  AceParseError,
  AceSemanticError,
  ArtifactDigestMismatch,
  ArtifactEncodingInvalid,
  ArtifactLimitExceeded,
  ArtifactLengthMismatch,
  ArtifactMissing,
  ArtifactReadError,
  BundleVerificationError,
  CanonicalSchemaInvalid,
  ContractDecodeError,
  DiffArtifactError,
  DigestError,
  type PromptCompileError,
  PromptLimitExceeded,
  PromptMaterializationError,
  SchemaLoweringError,
} from "./errors.js";
import {
  ArtifactReader,
  BundleVerifier,
  Digest,
  type PromptMaterializerInput,
  PromptMaterializer,
  ProviderSchemaLowerer,
  type SchemaLoweringReceipt,
  type UntrustedEvidenceItem,
} from "./ports.js";
import {
  canonicalJsonBytes,
  encodeUtf8,
  snapshotJsonValue,
  snapshotOrdinaryBytes,
  stringifyCanonicalJson,
  validateCanonicalSchema,
  verifyLoweringIndependently,
} from "./schema-lowering.js";

export type CompileReviewPromptInput = {
  readonly contract: unknown;
  readonly providerFamily: unknown;
};

export type CompiledReviewPrompt = {
  readonly descriptor: typeof CanonicalCompiledPromptV1.Type;
  readonly promptBytes: Uint8Array;
  readonly canonicalSchemaBytes: Uint8Array;
  readonly loweredSchemaBytes: Uint8Array;
  readonly contractHash: ContractHash;
  readonly promptHash: ContentHash;
  readonly canonicalSchemaHash: ContentHash;
  readonly schemaVariantHash: ContentHash;
  readonly loweringReceipt: SchemaLoweringReceipt;
};

const PROVIDER_FAMILIES = new Set(["anthropic", "xai", "google", "openai"]);

const isTextualMedia = (mediaType: string): boolean => {
  if (mediaType.startsWith("text/")) return true;
  if (mediaType === "application/json") return true;
  if (mediaType.endsWith("+json")) return true;
  return false;
};

const base64Encode = (bytes: Uint8Array): string => {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    const c1 = alphabet[(triple >> 18) & 63] ?? "";
    const c2 = alphabet[(triple >> 12) & 63] ?? "";
    const c3 = b === undefined ? "=" : (alphabet[(triple >> 6) & 63] ?? "=");
    const c4 = c === undefined ? "=" : (alphabet[triple & 63] ?? "=");
    output += c1 + c2 + c3 + c4;
  }
  return output;
};

const decodeUtf8 = (bytes: Uint8Array): string | null => {
  let result = "";
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index];
    if (byte === undefined) return null;
    if (byte <= 0x7f) {
      result += String.fromCharCode(byte);
      index += 1;
      continue;
    }
    if ((byte & 0xe0) === 0xc0) {
      const b2 = bytes[index + 1];
      if (b2 === undefined || (b2 & 0xc0) !== 0x80) return null;
      const code = ((byte & 0x1f) << 6) | (b2 & 0x3f);
      if (code < 0x80) return null;
      result += String.fromCharCode(code);
      index += 2;
      continue;
    }
    if ((byte & 0xf0) === 0xe0) {
      const b2 = bytes[index + 1];
      const b3 = bytes[index + 2];
      if (
        b2 === undefined ||
        b3 === undefined ||
        (b2 & 0xc0) !== 0x80 ||
        (b3 & 0xc0) !== 0x80
      ) {
        return null;
      }
      const code = ((byte & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      if (code < 0x800) return null;
      if (code >= 0xd800 && code <= 0xdfff) return null;
      result += String.fromCharCode(code);
      index += 3;
      continue;
    }
    if ((byte & 0xf8) === 0xf0) {
      const b2 = bytes[index + 1];
      const b3 = bytes[index + 2];
      const b4 = bytes[index + 3];
      if (
        b2 === undefined ||
        b3 === undefined ||
        b4 === undefined ||
        (b2 & 0xc0) !== 0x80 ||
        (b3 & 0xc0) !== 0x80 ||
        (b4 & 0xc0) !== 0x80
      ) {
        return null;
      }
      const code =
        ((byte & 0x07) << 18) |
        ((b2 & 0x3f) << 12) |
        ((b3 & 0x3f) << 6) |
        (b4 & 0x3f);
      if (code < 0x10000 || code > 0x10ffff) return null;
      const offset = code - 0x10000;
      result += String.fromCharCode(
        0xd800 + (offset >> 10),
        0xdc00 + (offset & 0x3ff),
      );
      index += 4;
      continue;
    }
    return null;
  }
  return result;
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

const assertSha256Digest = (
  value: unknown,
): Effect.Effect<Sha256Digest, DigestError> => {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    return Effect.fail(
      new DigestError({
        stage: "digest",
        reason: "digest must be 64 lowercase hexadecimal characters",
      }),
    );
  }
  return Effect.succeed(value as Sha256Digest);
};

const contentHashOf = (digest: Sha256Digest): ContentHash =>
  `sha256:${digest}` as ContentHash;

const contractHashOf = (digest: Sha256Digest): ContractHash =>
  `sha256:${digest}` as ContractHash;

const decodeProviderFamily = (
  value: unknown,
): Effect.Effect<
  "anthropic" | "xai" | "google" | "openai",
  ContractDecodeError
> => {
  if (typeof value !== "string" || !PROVIDER_FAMILIES.has(value)) {
    return Effect.fail(
      new ContractDecodeError({
        stage: "contract_decode",
        reason: "providerFamily must be one of anthropic|xai|google|openai",
      }),
    );
  }
  // Runtime-validated; brand via schema decode for extra safety.
  try {
    return Effect.succeed(decodeStrictSync(ProviderFamilyV1, value));
  } catch {
    return Effect.fail(
      new ContractDecodeError({
        stage: "contract_decode",
        reason: "providerFamily strict decode failed",
      }),
    );
  }
};

const runPort = <A, E>(
  invoke: () => Effect.Effect<A, unknown>,
  sanitize: (failure: unknown) => E,
): Effect.Effect<A, E> =>
  Effect.suspend(invoke).pipe(
    Effect.sandbox,
    Effect.catchAll((cause) => {
      const failure = Cause.failureOption(cause);
      return Effect.fail(
        sanitize(Option.isSome(failure) ? failure.value : undefined),
      );
    }),
  );

const sanitizeBundleFailure = (failure: unknown): BundleVerificationError => {
  let field: BundleVerificationError["field"] = "bundle";
  try {
    if (
      failure instanceof BundleVerificationError &&
      ["baseSha", "headSha", "diffSha256", "bundle"].includes(failure.field)
    ) {
      field = failure.field;
    }
  } catch {
    field = "bundle";
  }
  return new BundleVerificationError({
    stage: "bundle_verify",
    reason: "bundle verification failed",
    field,
  });
};

const sanitizeReaderFailure = (
  failure: unknown,
  descriptor: ReviewArtifactDescriptorV1,
  maxBytes: number,
): ArtifactMissing | ArtifactReadError | ArtifactLimitExceeded => {
  try {
    if (failure instanceof ArtifactMissing) {
      return new ArtifactMissing({
        stage: "artifact_read",
        reason: "artifact is unavailable",
        artifactId: descriptor.artifactId,
      });
    }
    if (failure instanceof ArtifactLimitExceeded) {
      return new ArtifactLimitExceeded({
        stage: "artifact_limit",
        reason: "artifact exceeds the configured maximum",
        artifactId: descriptor.artifactId,
        maxArtifactBytes: maxBytes,
        observedBytes: Math.max(descriptor.byteLength, maxBytes + 1),
      });
    }
  } catch {
    // Treat hostile error objects as generic read failures.
  }
  return new ArtifactReadError({
    stage: "artifact_read",
    reason: "artifact reader failed",
    artifactId: descriptor.artifactId,
    category: "unknown",
  });
};

const sanitizeDigestFailure = (): DigestError =>
  new DigestError({
    stage: "digest",
    reason: "digest service failed",
  });

const sanitizeLowererFailure = (): SchemaLoweringError =>
  new SchemaLoweringError({
    stage: "schema_lowering",
    reason: "provider schema lowerer failed",
    path: "",
  });

const sanitizeMaterializerFailure = (): PromptMaterializationError =>
  new PromptMaterializationError({
    stage: "prompt_materialize",
    reason: "prompt materializer failed",
  });

/**
 * Exact identity helper: require exactly one artifact matching the diff digest.
 * The strict contract already requires unique artifactIds, so multiple matches
 * are schema-unreachable under normal contracts; this helper still handles both
 * zero and multiple for direct unit coverage.
 */
export const findUniqueDiffArtifact = (
  artifacts: readonly ReviewArtifactDescriptorV1[],
  diffSha256: Sha256Digest,
): Effect.Effect<ReviewArtifactDescriptorV1, DiffArtifactError> => {
  const expectedId = `sha256:${diffSha256}`;
  const matches = artifacts.filter(
    (artifact) => artifact.artifactId === expectedId,
  );
  if (matches.length !== 1) {
    return Effect.fail(
      new DiffArtifactError({
        stage: "diff_artifact",
        reason:
          matches.length === 0
            ? `no artifact matches diff identity ${expectedId}`
            : `multiple artifacts match diff identity ${expectedId}`,
        matchCount: matches.length,
      }),
    );
  }
  const [only] = matches;
  if (only === undefined) {
    return Effect.fail(
      new DiffArtifactError({
        stage: "diff_artifact",
        reason: `no artifact matches diff identity ${expectedId}`,
        matchCount: 0,
      }),
    );
  }
  return Effect.succeed(only);
};

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

/**
 * Compile a review prompt through the ACE preflight pipeline.
 *
 * Sequence (stop at first error; never invokes a provider):
 * strict contract and provider-family decode → ACE parse → ACE canonicalize →
 * semantic lint → bundle verification → exact diff-artifact identity →
 * artifact limit checks → artifact reads → length/digest → canonical schema
 * validation → provider schema lowering → independent lowered verification →
 * prompt materialization → size check → digests → strict compiled-descriptor
 * decode.
 */
export const compileReviewPrompt = (
  input: CompileReviewPromptInput,
): Effect.Effect<
  CompiledReviewPrompt,
  PromptCompileError,
  | ArtifactReader
  | BundleVerifier
  | Digest
  | PromptMaterializer
  | ProviderSchemaLowerer
> =>
  Effect.gen(function* () {
    // 1. Strict contract and provider-family decode (before any port call)
    const providerFamily = yield* decodeProviderFamily(input.providerFamily);

    const contractInput = snapshotJsonValue(input.contract);
    if (
      contractInput === null ||
      typeof contractInput !== "object" ||
      Array.isArray(contractInput)
    ) {
      return yield* Effect.fail(
        new ContractDecodeError({
          stage: "contract_decode",
          reason: "contract must be a closed JSON object",
        }),
      );
    }

    let contract;
    try {
      contract = decodeStrictSync(CouncilPromptContractV1, contractInput);
    } catch {
      return yield* Effect.fail(
        new ContractDecodeError({
          stage: "contract_decode",
          reason: "strict contract decode failed",
        }),
      );
    }

    // 2. ACE parse
    const parseResult = parseCouncilAce(contract.aceSource, {
      nouns: [...contract.lexicon.nouns],
      verbs: contract.lexicon.verbs.map((verb) => ({
        base: verb.base,
        thirdPerson: verb.thirdPerson,
      })),
    });
    if (!parseResult.ok) {
      const diagnostic = parseResult.errors[0];
      return yield* Effect.fail(
        new AceParseError({
          stage: "ace_parse",
          reason: diagnostic.message,
          offset: diagnostic.offset,
          length: diagnostic.length,
        }),
      );
    }

    // 3. ACE canonicalization
    const canonicalAceText = canonicalizeCouncilAce(parseResult.document);

    // 4. Semantic lint
    const lintResult = validateReviewRules(parseResult.document);
    if (!lintResult.ok) {
      const diagnostic = lintResult.errors[0];
      return yield* Effect.fail(
        new AceSemanticError({
          stage: "semantic_lint",
          reason: diagnostic.message,
          offset: diagnostic.offset,
          length: diagnostic.length,
        }),
      );
    }

    // 5. Bundle verification (before diff identity)
    const bundleVerifier = yield* BundleVerifier;
    const bundleForPort = snapshotJsonValue(
      contract.bundle,
    ) as typeof contract.bundle;
    yield* runPort(
      () => bundleVerifier.verify(bundleForPort),
      sanitizeBundleFailure,
    );

    // 6. Exact diff-artifact identity check
    yield* findUniqueDiffArtifact(
      contract.artifacts,
      contract.bundle.diffSha256,
    );

    // 7. Enforce maxArtifactBytes before each reader call
    for (const descriptor of contract.artifacts) {
      if (descriptor.byteLength > contract.limits.maxArtifactBytes) {
        return yield* Effect.fail(
          new ArtifactLimitExceeded({
            stage: "artifact_limit",
            reason: `artifact ${descriptor.artifactId} declared byteLength exceeds maxArtifactBytes`,
            artifactId: descriptor.artifactId,
            maxArtifactBytes: contract.limits.maxArtifactBytes,
            observedBytes: descriptor.byteLength,
          }),
        );
      }
    }

    // 8–10. Concurrent artifact reads (order preserved from contract),
    // length + digest verification.
    const artifactReader = yield* ArtifactReader;
    const digestService = yield* Digest;
    const computeDigest = (bytes: Uint8Array) =>
      runPort(
        () => digestService.sha256(new Uint8Array(bytes)),
        sanitizeDigestFailure,
      );

    const readResults = yield* Effect.forEach(
      contract.artifacts,
      (descriptor) =>
        Effect.gen(function* () {
          const descriptorForPort = snapshotJsonValue(
            descriptor,
          ) as typeof descriptor;
          const returnedBytes = yield* runPort(
            () =>
              artifactReader.read({
                descriptor: descriptorForPort,
                maxBytes: contract.limits.maxArtifactBytes,
              }),
            (failure) =>
              sanitizeReaderFailure(
                failure,
                descriptor,
                contract.limits.maxArtifactBytes,
              ),
          );
          const bytes = snapshotOrdinaryBytes(returnedBytes);
          if (bytes === null) {
            return yield* Effect.fail(
              new ArtifactReadError({
                stage: "artifact_read",
                reason: "artifact reader returned a non-ordinary byte array",
                artifactId: descriptor.artifactId,
                category: "unknown",
              }),
            );
          }
          if (bytes.byteLength > contract.limits.maxArtifactBytes) {
            return yield* Effect.fail(
              new ArtifactLimitExceeded({
                stage: "artifact_limit",
                reason: `artifact ${descriptor.artifactId} actual bytes exceed maxArtifactBytes`,
                artifactId: descriptor.artifactId,
                maxArtifactBytes: contract.limits.maxArtifactBytes,
                observedBytes: bytes.byteLength,
              }),
            );
          }
          if (bytes.byteLength !== descriptor.byteLength) {
            return yield* Effect.fail(
              new ArtifactLengthMismatch({
                stage: "artifact_length",
                reason: `artifact byte length mismatch for ${descriptor.artifactId}`,
                artifactId: descriptor.artifactId,
                expected: descriptor.byteLength,
                actual: bytes.byteLength,
              }),
            );
          }
          const rawDigest = yield* computeDigest(bytes);
          const digest = yield* assertSha256Digest(rawDigest);
          if (digest !== descriptor.digest) {
            return yield* Effect.fail(
              new ArtifactDigestMismatch({
                stage: "artifact_digest",
                reason: `artifact digest mismatch for ${descriptor.artifactId}`,
                artifactId: descriptor.artifactId,
                expected: descriptor.digest,
                actual: digest,
              }),
            );
          }
          return { descriptor, bytes } as const;
        }),
      { concurrency: "unbounded" },
    ).pipe(
      Effect.sandbox,
      Effect.catchAll((cause) => {
        const failure = Cause.failureOption(cause);
        if (Option.isSome(failure)) return Effect.fail(failure.value);
        return Effect.fail(
          new ArtifactReadError({
            stage: "artifact_read",
            reason: "concurrent artifact processing failed",
            artifactId: contract.artifacts[0]?.artifactId ?? "unknown",
            category: "unknown",
          }),
        );
      }),
    );

    // 11. Canonical response-schema JSON decode + closed validation
    const schemaArtifact = readResults.find(
      (entry) =>
        entry.descriptor.artifactId === contract.responseSchemaArtifactId,
    );
    if (schemaArtifact === undefined) {
      return yield* Effect.fail(
        new CanonicalSchemaInvalid({
          stage: "canonical_schema",
          reason: "response schema artifact bytes were not loaded",
        }),
      );
    }

    const schemaText = decodeUtf8(schemaArtifact.bytes);
    if (schemaText === null) {
      return yield* Effect.fail(
        new CanonicalSchemaInvalid({
          stage: "canonical_schema",
          reason: "response schema artifact is not valid UTF-8",
        }),
      );
    }

    let canonicalSchema: unknown;
    try {
      canonicalSchema = JSON.parse(schemaText) as unknown;
    } catch (error) {
      return yield* Effect.fail(
        new CanonicalSchemaInvalid({
          stage: "canonical_schema",
          reason:
            error instanceof Error
              ? `response schema is not valid JSON: ${error.message}`
              : "response schema is not valid JSON",
        }),
      );
    }

    yield* validateCanonicalSchema(canonicalSchema, "", true);
    const canonicalSchemaBytes = canonicalJsonBytes(canonicalSchema);

    // 12. Provider schema lowering
    const lowerer = yield* ProviderSchemaLowerer;
    const schemaForPort = snapshotJsonValue(canonicalSchema);
    const lowered = yield* runPort(
      () =>
        lowerer.lower({
          providerFamily,
          canonicalSchema: schemaForPort,
          canonicalSchemaBytes: new Uint8Array(canonicalSchemaBytes),
        }),
      sanitizeLowererFailure,
    );

    // 13. Independent lowered-schema and combined-constraint verification
    const verifiedLowered = yield* verifyLoweringIndependently(
      providerFamily,
      canonicalSchema,
      lowered,
    );

    // 14. Prompt materialization (evidence in contract order; schema excluded)
    const evidence: UntrustedEvidenceItem[] = [];
    for (const entry of readResults) {
      if (entry.descriptor.artifactId === contract.responseSchemaArtifactId) {
        continue;
      }
      const textual = isTextualMedia(entry.descriptor.mediaType);
      if (textual) {
        const text = decodeUtf8(entry.bytes);
        if (text === null) {
          return yield* Effect.fail(
            new ArtifactEncodingInvalid({
              stage: "artifact_encoding",
              reason: `textual artifact ${entry.descriptor.artifactId} is not valid UTF-8`,
              artifactId: entry.descriptor.artifactId,
            }),
          );
        }
        evidence.push({
          alias: entry.descriptor.alias,
          artifactId: entry.descriptor.artifactId,
          mediaType: entry.descriptor.mediaType,
          byteLength: entry.descriptor.byteLength,
          sha256: entry.descriptor.digest,
          contentEncoding: "utf8",
          content: text,
        });
      } else {
        evidence.push({
          alias: entry.descriptor.alias,
          artifactId: entry.descriptor.artifactId,
          mediaType: entry.descriptor.mediaType,
          byteLength: entry.descriptor.byteLength,
          sha256: entry.descriptor.digest,
          contentEncoding: "base64",
          content: base64Encode(entry.bytes),
        });
      }
    }

    const materializerInput: PromptMaterializerInput = {
      format: "council-prompt-v1",
      trustedAuthority: {
        profile: "council-ace-1",
        aceText: canonicalAceText,
      },
      taskData: {
        candidateId: contract.candidateId,
        bundle: contract.bundle,
        limits: {
          maxPromptBytes: contract.limits.maxPromptBytes,
          maxArtifactBytes: contract.limits.maxArtifactBytes,
          maxTurns: contract.limits.maxTurns,
          maxWallTimeMs: contract.limits.maxWallTimeMs,
          maxRetries: contract.limits.maxRetries,
        },
      },
      untrustedEvidence: evidence,
      responseSchema: verifiedLowered.loweredSchema,
    };

    const materializer = yield* PromptMaterializer;
    const materializerInputForPort = snapshotJsonValue(
      materializerInput,
    ) as PromptMaterializerInput;
    const returnedPromptBytes = yield* runPort(
      () => materializer.materialize(materializerInputForPort),
      sanitizeMaterializerFailure,
    );
    const promptBytes = snapshotOrdinaryBytes(returnedPromptBytes);
    if (promptBytes === null) {
      return yield* Effect.fail(
        new PromptMaterializationError({
          stage: "prompt_materialize",
          reason: "prompt materializer returned a non-ordinary byte array",
        }),
      );
    }

    // Do not trust arbitrary prompt bytes: recompute expected envelope bytes.
    const expectedPromptBytes = canonicalJsonBytes({
      format: materializerInput.format,
      trustedAuthority: {
        aceText: materializerInput.trustedAuthority.aceText,
        profile: materializerInput.trustedAuthority.profile,
      },
      taskData: {
        bundle: materializerInput.taskData.bundle,
        candidateId: materializerInput.taskData.candidateId,
        limits: materializerInput.taskData.limits,
      },
      untrustedEvidence: materializerInput.untrustedEvidence.map((item) => ({
        alias: item.alias,
        artifactId: item.artifactId,
        byteLength: item.byteLength,
        content: item.content,
        contentEncoding: item.contentEncoding,
        mediaType: item.mediaType,
        sha256: item.sha256,
      })),
      responseSchema: materializerInput.responseSchema,
    });
    if (!bytesEqual(promptBytes, expectedPromptBytes)) {
      return yield* Effect.fail(
        new PromptMaterializationError({
          stage: "prompt_materialize",
          reason:
            "materializer output bytes do not match application recomputation of the canonical envelope",
        }),
      );
    }

    // 15. Prompt-size verification
    if (promptBytes.byteLength === 0) {
      return yield* Effect.fail(
        new PromptLimitExceeded({
          stage: "prompt_limit",
          reason: "promptByteLength must be positive",
          maxPromptBytes: contract.limits.maxPromptBytes,
          actualBytes: 0,
        }),
      );
    }
    if (promptBytes.byteLength > contract.limits.maxPromptBytes) {
      return yield* Effect.fail(
        new PromptLimitExceeded({
          stage: "prompt_limit",
          reason: `prompt exceeds maxPromptBytes (${String(contract.limits.maxPromptBytes)})`,
          maxPromptBytes: contract.limits.maxPromptBytes,
          actualBytes: promptBytes.byteLength,
        }),
      );
    }

    // 16. Digests: contract, prompt, canonical schema, variant
    const contractBytes = encodeUtf8(
      stringifyCanonicalJson({
        schemaVersion: contract.schemaVersion,
        profile: contract.profile,
        aceSource: contract.aceSource,
        lexicon: contract.lexicon,
        candidateId: contract.candidateId,
        bundle: contract.bundle,
        artifacts: contract.artifacts,
        responseSchemaArtifactId: contract.responseSchemaArtifactId,
        limits: contract.limits,
      }),
    );
    const contractDigest = yield* assertSha256Digest(
      yield* computeDigest(contractBytes),
    );
    const promptDigest = yield* assertSha256Digest(
      yield* computeDigest(promptBytes),
    );
    const canonicalSchemaDigest = yield* assertSha256Digest(
      yield* computeDigest(canonicalSchemaBytes),
    );
    const variantDigest = yield* assertSha256Digest(
      yield* computeDigest(verifiedLowered.loweredSchemaBytes),
    );

    const contractHash = contractHashOf(contractDigest);
    const promptHash = contentHashOf(promptDigest);
    const canonicalSchemaHash = contentHashOf(canonicalSchemaDigest);
    const schemaVariantHash = contentHashOf(variantDigest);

    const artifactIds = contract.artifacts.map(
      (artifact) => artifact.artifactId,
    ) as [
      (typeof contract.artifacts)[number]["artifactId"],
      ...(typeof contract.artifacts)[number]["artifactId"][],
    ];

    const descriptorCandidate = {
      schemaVersion: 1 as const,
      profile: "council-ace-1" as const,
      contractHash,
      promptHash,
      schemaVariantHash,
      canonicalAceText,
      promptByteLength: promptBytes.byteLength,
      candidateId: contract.candidateId,
      bundle: contract.bundle,
      artifactIds,
      responseSchemaArtifactId: contract.responseSchemaArtifactId,
    };

    // 17. Strict compiled-descriptor decode before return
    let descriptor: typeof CanonicalCompiledPromptV1.Type;
    try {
      descriptor = decodeStrictSync(
        CanonicalCompiledPromptV1,
        descriptorCandidate,
      );
    } catch (error) {
      return yield* Effect.fail(
        new ContractDecodeError({
          stage: "contract_decode",
          reason:
            error instanceof Error
              ? `compiled descriptor strict decode failed: ${error.message}`
              : "compiled descriptor strict decode failed",
        }),
      );
    }

    const loweringReceipt: SchemaLoweringReceipt = {
      providerFamily,
      transformations: verifiedLowered.transformations,
      constraintReceipts: verifiedLowered.constraintReceipts,
      canonicalSchemaBytes,
      loweredSchemaBytes: verifiedLowered.loweredSchemaBytes,
    };

    return {
      descriptor,
      promptBytes,
      canonicalSchemaBytes,
      loweredSchemaBytes: verifiedLowered.loweredSchemaBytes,
      contractHash,
      promptHash,
      canonicalSchemaHash,
      schemaVariantHash,
      loweringReceipt,
    };
  });
