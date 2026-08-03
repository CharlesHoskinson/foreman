import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Layer } from "effect";
import type { Sha256Digest } from "@council/schema";
import {
  ArtifactReadError,
  ArtifactReader,
  BundleVerificationError,
  BundleVerifier,
  compileReviewPrompt,
  ContractDecodeError,
  Digest,
  DigestError,
  lowerProviderSchema,
  PromptMaterializationError,
  PromptMaterializer,
  ProviderSchemaLowerer,
  SchemaLoweringError,
} from "../src/index.js";
import {
  bytesById,
  extractFail,
  makeContract,
  materializePromptBytesLocal,
  sha256Hex,
  makeArtifact,
  defaultArtifacts,
  encodeUtf8Text,
} from "./test-helpers.js";

const secretSegment = "sk-SUPER-SECRET-LEAK-TOKEN-99";
const secretPath = `/home/charl/.secrets/${secretSegment}`;

const artifactAt = (index: number) => {
  const artifact = defaultArtifacts[index];
  if (artifact === undefined) throw new Error("artifact fixture is missing");
  return artifact;
};

const serializePublic = (value: unknown): string => {
  try {
    return JSON.stringify(value, (_key: string, v: unknown): unknown => {
      if (typeof v === "bigint") return `bigint:${String(v)}`;
      if (typeof v === "symbol") return `symbol:${v.description ?? ""}`;
      if (typeof v === "function") return "function";
      return v;
    });
  } catch {
    return String(value);
  }
};

const assertNoSecret = (value: unknown): void => {
  const serialized = serializePublic(value);
  const asText = String(value);
  expect(serialized).not.toContain(secretSegment);
  expect(serialized).not.toContain(secretPath);
  expect(asText).not.toContain(secretSegment);
  expect(asText).not.toContain(secretPath);
  // Walk Effect Exit/Cause representations without unrestricted cause dump.
  if (value !== null && typeof value === "object" && "_tag" in value) {
    const exit = value as Exit.Exit<unknown, unknown>;
    if (Exit.isFailure(exit)) {
      const pretty = Cause.pretty(exit.cause);
      expect(pretty).not.toContain(secretSegment);
      expect(pretty).not.toContain(secretPath);
    }
  }
};

type AnyReader = {
  read: (request: {
    descriptor: { artifactId: string };
    maxBytes: number;
  }) => Effect.Effect<Uint8Array, unknown>;
};
type AnyBundle = { verify: (bundle: unknown) => Effect.Effect<void, unknown> };
type AnyDigest = {
  sha256: (bytes: Uint8Array) => Effect.Effect<Sha256Digest, unknown>;
};
type AnyMaterializer = {
  materialize: (input: unknown) => Effect.Effect<Uint8Array, unknown>;
};
type AnyLowerer = {
  lower: (input: {
    providerFamily: unknown;
    canonicalSchema: unknown;
    canonicalSchemaBytes: Uint8Array;
  }) => Effect.Effect<unknown, unknown>;
};

const basePorts = (overrides: {
  reader?: AnyReader;
  bundle?: AnyBundle;
  digest?: AnyDigest;
  materializer?: AnyMaterializer;
  lowerer?: AnyLowerer;
}) =>
  Layer.mergeAll(
    Layer.succeed(
      ArtifactReader,
      (overrides.reader ?? {
        read: (request: { descriptor: { artifactId: string } }) =>
          Effect.succeed(
            (
              bytesById().get(request.descriptor.artifactId) ?? new Uint8Array()
            ).slice(),
          ),
      }) as never,
    ),
    Layer.succeed(
      BundleVerifier,
      (overrides.bundle ?? { verify: () => Effect.void }) as never,
    ),
    Layer.succeed(
      Digest,
      (overrides.digest ?? {
        sha256: (bytes: Uint8Array) =>
          Effect.succeed(sha256Hex(bytes) as Sha256Digest),
      }) as never,
    ),
    Layer.succeed(
      PromptMaterializer,
      (overrides.materializer ?? {
        materialize: (
          input: Parameters<typeof materializePromptBytesLocal>[0],
        ) => Effect.succeed(materializePromptBytesLocal(input)),
      }) as never,
    ),
    Layer.succeed(
      ProviderSchemaLowerer,
      (overrides.lowerer ?? {
        lower: (input: {
          providerFamily: "openai" | "anthropic" | "xai" | "google";
          canonicalSchema: unknown;
        }) => lowerProviderSchema(input.providerFamily, input.canonicalSchema),
      }) as never,
    ),
  );

const runCompile = (
  layer: ReturnType<typeof basePorts>,
  family: unknown = "openai",
  contract: unknown = makeContract(),
) =>
  Effect.runPromiseExit(
    compileReviewPrompt({
      contract,
      providerFamily: family,
    }).pipe(Effect.provide(layer)),
  );

describe("provider-family, digest, and public error safety", () => {
  it("rejects bigint provider family as ContractDecodeError without defect", async () => {
    const exit = await runCompile(basePorts({}), 10n);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause._tag).toBe("Fail");
      const error = extractFail(exit);
      expect(error).toBeInstanceOf(ContractDecodeError);
      assertNoSecret(error);
      assertNoSecret(exit);
    }
  });

  it("rejects cyclic object provider family as ContractDecodeError without defect", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const exit = await runCompile(basePorts({}), cyclic);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause._tag).toBe("Fail");
      expect(extractFail(exit)).toBeInstanceOf(ContractDecodeError);
      assertNoSecret(extractFail(exit));
    }
  });

  it("rejects symbol and function provider family as ContractDecodeError", async () => {
    for (const value of [Symbol("x"), () => "openai"] as const) {
      const exit = await runCompile(basePorts({}), value);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        expect(extractFail(exit)).toBeInstanceOf(ContractDecodeError);
      }
    }
  });

  it("rejects non-string digest results as DigestError without raw value", async () => {
    const cases: unknown[] = [
      10n,
      { toString: () => "ab".repeat(32) },
      Symbol("digest"),
      () => "ab".repeat(32),
    ];
    for (const bad of cases) {
      const exit = await runCompile(
        basePorts({
          digest: {
            sha256: () => Effect.succeed(bad as Sha256Digest),
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        const error = extractFail(exit);
        expect(error).toBeInstanceOf(DigestError);
        assertNoSecret(error);
        const serialized = serializePublic(error);
        expect(serialized).not.toContain("toString");
        if (typeof bad === "bigint") {
          expect(serialized).not.toMatch(/10n|bigint:10/);
        }
      }
    }
  });

  it("rejects cyclic digest result as DigestError without raw serialization", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const exit = await runCompile(
      basePorts({
        digest: {
          sha256: () => Effect.succeed(cyclic as never),
        },
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause._tag).toBe("Fail");
      const error = extractFail(exit);
      expect(error).toBeInstanceOf(DigestError);
      assertNoSecret(error);
    }
  });

  it("secret-looking invalid digest string does not embed raw value beyond allowlist", async () => {
    const evil = `not-hex-${secretSegment}`;
    const exit = await runCompile(
      basePorts({
        digest: {
          sha256: () => Effect.succeed(evil as Sha256Digest),
        },
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const error = extractFail(exit);
    expect(error).toBeInstanceOf(DigestError);
    assertNoSecret(error);
    const serialized = serializePublic(error);
    expect(serialized).not.toContain(evil);
  });

  // --- Per-port: failure-channel, synchronous throw, Effect defect ----------

  describe("bundle verifier public errors", () => {
    it("failure-channel secret is excluded from public error", async () => {
      const exit = await runCompile(
        basePorts({
          bundle: {
            verify: () =>
              Effect.fail(
                new BundleVerificationError({
                  stage: "bundle_verify",
                  reason: `mismatch ${secretSegment} at ${secretPath}`,
                  field: "diffSha256",
                }),
              ),
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        assertNoSecret(extractFail(exit));
        assertNoSecret(exit);
      }
    });

    it("synchronous method throw is converted to tagged Fail without secret", async () => {
      const exit = await runCompile(
        basePorts({
          bundle: {
            // Invoke inside Effect so a sync throw is a real boundary input.
            verify: () =>
              Effect.sync(() => {
                throw new Error(`sync boom ${secretSegment} ${secretPath}`);
              }),
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        assertNoSecret(extractFail(exit));
        assertNoSecret(exit);
      }
    });

    it("Effect defect is converted to tagged Fail without secret", async () => {
      const exit = await runCompile(
        basePorts({
          bundle: {
            verify: () =>
              Effect.die(new Error(`die ${secretSegment} ${secretPath}`)),
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        assertNoSecret(extractFail(exit));
        assertNoSecret(exit);
      }
    });
  });

  describe("artifact reader public errors", () => {
    it("failure-channel secret is excluded from public error", async () => {
      const exit = await runCompile(
        basePorts({
          reader: {
            read: () =>
              Effect.fail(
                new ArtifactReadError({
                  stage: "artifact_read",
                  reason: `io ${secretSegment} ${secretPath}`,
                  artifactId: "sha256:" + "ab".repeat(32),
                  category: "io",
                }),
              ),
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        assertNoSecret(extractFail(exit));
        assertNoSecret(exit);
      }
    });

    it("synchronous method throw is converted to tagged Fail without secret", async () => {
      const exit = await runCompile(
        basePorts({
          reader: {
            read: () =>
              Effect.sync(() => {
                throw new Error(`fs open ${secretSegment} ${secretPath}`);
              }),
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        assertNoSecret(extractFail(exit));
        assertNoSecret(exit);
      }
    });

    it("Effect defect is converted to tagged Fail without secret", async () => {
      const exit = await runCompile(
        basePorts({
          reader: {
            read: () =>
              Effect.die(`reader defect ${secretSegment} ${secretPath}`),
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        assertNoSecret(extractFail(exit));
        assertNoSecret(exit);
      }
    });
  });

  describe("digest public errors", () => {
    it("failure-channel secret is excluded from public error", async () => {
      const exit = await runCompile(
        basePorts({
          digest: {
            sha256: () =>
              Effect.fail(
                new DigestError({
                  stage: "digest",
                  reason: `hash fail ${secretSegment} ${secretPath}`,
                }),
              ),
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        const error = extractFail(exit);
        expect(error).toBeInstanceOf(DigestError);
        assertNoSecret(error);
        assertNoSecret(exit);
      }
    });

    it("synchronous method throw is converted to tagged Fail without secret", async () => {
      const exit = await runCompile(
        basePorts({
          digest: {
            sha256: () =>
              Effect.sync(() => {
                throw new Error(`digest sync ${secretSegment} ${secretPath}`);
              }),
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        assertNoSecret(extractFail(exit));
        assertNoSecret(exit);
      }
    });

    it("Effect defect is converted to tagged Fail without secret", async () => {
      const exit = await runCompile(
        basePorts({
          digest: {
            sha256: () =>
              Effect.die(
                new Error(`digest die ${secretSegment} ${secretPath}`),
              ),
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        assertNoSecret(extractFail(exit));
        assertNoSecret(exit);
      }
    });
  });

  describe("provider schema lowerer public errors", () => {
    it("failure-channel secret is excluded from public error", async () => {
      const exit = await runCompile(
        basePorts({
          lowerer: {
            lower: () =>
              Effect.fail(
                new SchemaLoweringError({
                  stage: "schema_lowering",
                  reason: `lower fail ${secretSegment} ${secretPath}`,
                  path: secretPath,
                }),
              ),
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        assertNoSecret(extractFail(exit));
        assertNoSecret(exit);
      }
    });

    it("synchronous method throw is converted to tagged Fail without secret", async () => {
      const exit = await runCompile(
        basePorts({
          lowerer: {
            lower: () =>
              Effect.sync(() => {
                throw new Error(`lower sync ${secretSegment} ${secretPath}`);
              }),
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        assertNoSecret(extractFail(exit));
        assertNoSecret(exit);
      }
    });

    it("Effect defect is converted to tagged Fail without secret", async () => {
      const exit = await runCompile(
        basePorts({
          lowerer: {
            lower: () => Effect.die(`lower die ${secretSegment} ${secretPath}`),
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        assertNoSecret(extractFail(exit));
        assertNoSecret(exit);
      }
    });
  });

  describe("prompt materializer public errors", () => {
    it("failure-channel secret is excluded from public error", async () => {
      const exit = await runCompile(
        basePorts({
          materializer: {
            materialize: () =>
              Effect.fail(
                new PromptMaterializationError({
                  stage: "prompt_materialize",
                  reason: `mat fail ${secretSegment} ${secretPath}`,
                }),
              ),
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        assertNoSecret(extractFail(exit));
        assertNoSecret(exit);
      }
    });

    it("synchronous method throw is converted to tagged Fail without secret", async () => {
      const exit = await runCompile(
        basePorts({
          materializer: {
            materialize: () =>
              Effect.sync(() => {
                throw new Error(`mat sync ${secretSegment} ${secretPath}`);
              }),
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        assertNoSecret(extractFail(exit));
        assertNoSecret(exit);
      }
    });

    it("Effect defect is converted to tagged Fail without secret", async () => {
      const exit = await runCompile(
        basePorts({
          materializer: {
            materialize: () =>
              Effect.die(`mat die ${secretSegment} ${secretPath}`),
          },
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        assertNoSecret(extractFail(exit));
        assertNoSecret(exit);
      }
    });
  });

  describe("strict contract decoding", () => {
    it("rejects malformed contract value as ContractDecodeError without secret", async () => {
      const exit = await runCompile(basePorts({}), "openai", {
        not: "a contract",
        leak: secretSegment,
        path: secretPath,
      });
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        const error = extractFail(exit);
        expect(error).toBeInstanceOf(ContractDecodeError);
        assertNoSecret(error);
        assertNoSecret(exit);
      }
    });

    it("rejects throwing-getter contract as ContractDecodeError without secret", async () => {
      const contract: Record<string, unknown> = {
        schemaVersion: 1,
        profile: "council-ace-1",
      };
      Object.defineProperty(contract, "candidateId", {
        enumerable: true,
        get: () => {
          throw new Error(`getter ${secretSegment} ${secretPath}`);
        },
      });
      const exit = await runCompile(basePorts({}), "openai", contract);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        const error = extractFail(exit);
        expect(error).toBeInstanceOf(ContractDecodeError);
        assertNoSecret(error);
        assertNoSecret(exit);
      }
    });

    it("rejects throwing-proxy contract as ContractDecodeError without secret", async () => {
      const base = makeContract();
      const proxy = new Proxy(base, {
        get(target, prop, receiver) {
          if (prop === "artifacts") {
            throw new Error(`proxy ${secretSegment} ${secretPath}`);
          }
          return Reflect.get(target, prop, receiver) as unknown;
        },
        ownKeys() {
          throw new Error(`ownKeys ${secretSegment}`);
        },
      });
      const exit = await runCompile(basePorts({}), "openai", proxy);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        const error = extractFail(exit);
        expect(error).toBeInstanceOf(ContractDecodeError);
        assertNoSecret(error);
        assertNoSecret(exit);
      }
    });
  });

  describe("diff and response-schema identity", () => {
    it("rejects when selected diff artifact is also the response-schema artifact", async () => {
      // Use the same artifact id for response schema as the selected diff.
      const diffArtifact = artifactAt(0);
      const sharedId = diffArtifact.artifactId;
      const contract = makeContract({
        responseSchemaArtifactId: sharedId,
        // Diff selection uses bundle.diffSha256 matching the diff artifact digest.
        // Force response schema to point at the same artifact identity.
        artifacts: [
          artifactAt(0),
          artifactAt(1),
          // Rename response-schema entry to the shared diff id (identity collision).
          makeArtifact(
            "response-schema",
            "application/json",
            encodeUtf8Text("{}"),
            String(diffArtifact.digest),
            sharedId,
          ),
          artifactAt(3),
        ],
      });
      const exit = await runCompile(basePorts({}), "openai", contract);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        // Must fail as typed contract/diff-identity before artifact reading.
        const error = extractFail(exit);
        const tag = (error as { _tag?: string })._tag;
        expect(
          tag === "ContractDecodeError" ||
            tag === "DiffArtifactError" ||
            error instanceof ContractDecodeError,
        ).toBe(true);
      }
    });

    it("successful control keeps distinct identities and includes selected diff once", async () => {
      const logReader: string[] = [];
      const layer = basePorts({
        reader: {
          read: (request) => {
            logReader.push(request.descriptor.artifactId);
            return Effect.succeed(
              (
                bytesById().get(request.descriptor.artifactId) ??
                new Uint8Array()
              ).slice(),
            );
          },
        },
      });
      const exit = await runCompile(layer, "openai", makeContract());
      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const bytes = exit.value.promptBytes;
        let text = "";
        for (let i = 0; i < bytes.byteLength; i += 1) {
          text += String.fromCharCode(bytes[i] ?? 0);
        }
        const parsed = JSON.parse(text) as {
          untrustedEvidence: Array<{ artifactId: string; alias: string }>;
        };
        const diffEntries = parsed.untrustedEvidence.filter(
          (e) => e.artifactId === artifactAt(0).artifactId,
        );
        expect(diffEntries.length).toBe(1);
        // Response-schema artifact is excluded from evidence list.
        const schemaInEvidence = parsed.untrustedEvidence.some(
          (e) => e.artifactId === artifactAt(2).artifactId,
        );
        expect(schemaInEvidence).toBe(false);
      }
    });
  });
});
