import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  PINNED_TRANSFORMERS_MODEL_V1,
  createTransformersEmbeddingV1,
  normalizeTransformersEmbeddingOutputV1,
  pinnedTransformersPipelinePlanV1,
  verifyPinnedTransformersModelV1,
} from "./index.js";

const LIVE_MODEL_ROOT = process.env.FOREMAN_EMBEDDING_MODEL_ROOT;

describe("pinned Transformers embedding", () => {
  it("uses the exact local model identity and disables model downloads", () => {
    const root = join(tmpdir(), "foreman-model-root");
    assert.deepEqual(pinnedTransformersPipelinePlanV1(root), {
      task: "feature-extraction",
      model: root,
      options: {
        local_files_only: true,
        model_file_name: "model",
        revision: "aff7a1dc4e8a1ea593e6ea21e95c22ef0a25966f",
      },
      embeddingOptions: { pooling: "mean", normalize: true },
    });
    assert.deepEqual(PINNED_TRANSFORMERS_MODEL_V1, {
      dataPath: "onnx/model.onnx_data",
      dataSha256:
        "60c758432aa596c30a122942dfe594c457d4d713f890926f1c5f920bd496c8de",
      dimensions: 384,
      graphPath: "onnx/model.onnx",
      graphSha256:
        "2f019cf6217537cc4bfc7f5192f21dea1e18445177edaab0bc6163a813e5c7a1",
      modelId:
        "onnx-community/all-MiniLM-L6-v2-ONNX@aff7a1dc4e8a1ea593e6ea21e95c22ef0a25966f:mean-normalized-384",
      repository: "onnx-community/all-MiniLM-L6-v2-ONNX",
      revision: "aff7a1dc4e8a1ea593e6ea21e95c22ef0a25966f",
    });
  });

  it("requires an absolute model root", () => {
    assert.throws(
      () => pinnedTransformersPipelinePlanV1("relative/model"),
      /absolute/,
    );
  });

  it("accepts exactly one finite normalized 384-dimensional vector", () => {
    const vector: number[] = Array.from({ length: 384 }, (_, index) =>
      index === 0 ? 1 : 0,
    );
    assert.deepEqual(
      normalizeTransformersEmbeddingOutputV1([vector]),
      vector,
    );
  });

  it("refuses malformed, non-finite, wrong-sized, and non-normalized output", () => {
    const valid: number[] = Array.from({ length: 384 }, (_, index) =>
      index === 0 ? 1 : 0,
    );
    const nonFinite = [...valid];
    nonFinite[7] = Number.NaN;
    const notNormalized = [...valid];
    notNormalized[0] = 2;
    for (const value of [
      valid,
      [valid, valid],
      [valid.slice(1)],
      [nonFinite],
      [notNormalized],
      null,
    ]) {
      assert.throws(
        () => normalizeTransformersEmbeddingOutputV1(value),
        /embedding output/,
      );
    }
  });

  it("refuses absent and digest-mismatched pinned model files", async () => {
    const root = mkdtempSync(join(tmpdir(), "foreman-embedding-"));
    try {
      await assert.rejects(
        verifyPinnedTransformersModelV1(root),
        /pinned model file/,
      );
      mkdirSync(join(root, "onnx"));
      writeFileSync(join(root, "onnx", "model.onnx"), "wrong graph");
      writeFileSync(join(root, "onnx", "model.onnx_data"), "wrong data");
      await assert.rejects(
        verifyPinnedTransformersModelV1(root),
        /digest mismatch/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it(
    "loads the pinned model and embeds without network access",
    { skip: LIVE_MODEL_ROOT === undefined },
    async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        throw new Error("network access is disabled in the embedding test");
      };
      try {
        const embedding = await createTransformersEmbeddingV1(LIVE_MODEL_ROOT!);
        const first = await embedding.embed("stable semantic memory");
        const second = await embedding.embed("stable semantic memory");
        assert.deepEqual(first, second);
        assert.equal(first.length, 384);
        assert.equal(
          Math.abs(Math.sqrt(first.reduce((sum, item) => sum + item * item, 0)) - 1) <
            0.0001,
          true,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});
