import { createHash } from "node:crypto";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { EmbeddingPort } from "./qdrant-memory-index.js";

const MODEL_REPOSITORY = "onnx-community/all-MiniLM-L6-v2-ONNX";
const MODEL_REVISION = "aff7a1dc4e8a1ea593e6ea21e95c22ef0a25966f";
const GRAPH_SHA256 =
  "2f019cf6217537cc4bfc7f5192f21dea1e18445177edaab0bc6163a813e5c7a1";
const DATA_SHA256 =
  "60c758432aa596c30a122942dfe594c457d4d713f890926f1c5f920bd496c8de";
const DIMENSIONS = 384;
const NORMALIZATION_TOLERANCE = 0.0001;

export const PINNED_TRANSFORMERS_MODEL_V1 = Object.freeze({
  repository: MODEL_REPOSITORY,
  revision: MODEL_REVISION,
  graphPath: "onnx/model.onnx",
  graphSha256: GRAPH_SHA256,
  dataPath: "onnx/model.onnx_data",
  dataSha256: DATA_SHA256,
  dimensions: DIMENSIONS,
  modelId: `${MODEL_REPOSITORY}@${MODEL_REVISION}:mean-normalized-384`,
} as const);

export type PinnedTransformersPipelinePlanV1 = {
  readonly task: "feature-extraction";
  readonly model: string;
  readonly options: {
    readonly local_files_only: true;
    readonly model_file_name: "model";
    readonly revision: typeof MODEL_REVISION;
  };
  readonly embeddingOptions: {
    readonly pooling: "mean";
    readonly normalize: true;
  };
};

export function pinnedTransformersPipelinePlanV1(
  modelRoot: string,
): PinnedTransformersPipelinePlanV1 {
  if (!isAbsolute(modelRoot)) {
    throw new Error("model root must be absolute");
  }
  return {
    task: "feature-extraction",
    model: modelRoot,
    options: {
      local_files_only: true,
      model_file_name: "model",
      revision: MODEL_REVISION,
    },
    embeddingOptions: { pooling: "mean", normalize: true },
  };
}

function isContained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel.length > 0 &&
    !isAbsolute(rel) &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`)
  );
}

function sameIdentity(
  left: { readonly dev: number; readonly ino: number; readonly size: number; readonly mtimeMs: number },
  right: { readonly dev: number; readonly ino: number; readonly size: number; readonly mtimeMs: number },
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

async function sha256RegularFile(path: string): Promise<string> {
  const beforePath = await lstat(path);
  if (!beforePath.isFile() || beforePath.isSymbolicLink()) {
    throw new Error("pinned model file is not regular");
  }
  const handle = await open(path, "r");
  try {
    const beforeOpen = await handle.stat();
    if (!beforeOpen.isFile() || !sameIdentity(beforePath, beforeOpen)) {
      throw new Error("pinned model file identity changed");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const [afterOpen, afterPath] = await Promise.all([handle.stat(), lstat(path)]);
    if (
      afterPath.isSymbolicLink() ||
      !sameIdentity(beforeOpen, afterOpen) ||
      !sameIdentity(beforeOpen, afterPath)
    ) {
      throw new Error("pinned model file identity changed");
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

async function verifyPinnedFile(
  physicalRoot: string,
  relativePath: string,
  expectedSha256: string,
): Promise<void> {
  const lexicalPath = resolve(physicalRoot, ...relativePath.split("/"));
  let physicalPath: string;
  try {
    physicalPath = await realpath(lexicalPath);
  } catch {
    throw new Error("pinned model file is unavailable");
  }
  if (!isContained(physicalRoot, physicalPath)) {
    throw new Error("pinned model file escapes its root");
  }
  let digest: string;
  try {
    digest = await sha256RegularFile(physicalPath);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("pinned model file")) {
      throw error;
    }
    throw new Error("pinned model file is unreadable");
  }
  if (digest !== expectedSha256) {
    throw new Error("pinned model file digest mismatch");
  }
}

/** Verify the two large model objects without retaining them in memory. */
export async function verifyPinnedTransformersModelV1(
  modelRoot: string,
): Promise<string> {
  if (!isAbsolute(modelRoot)) throw new Error("model root must be absolute");
  let physicalRoot: string;
  try {
    physicalRoot = await realpath(modelRoot);
    if (!(await stat(physicalRoot)).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw new Error("pinned model root is unavailable");
  }
  await verifyPinnedFile(
    physicalRoot,
    PINNED_TRANSFORMERS_MODEL_V1.graphPath,
    PINNED_TRANSFORMERS_MODEL_V1.graphSha256,
  );
  await verifyPinnedFile(
    physicalRoot,
    PINNED_TRANSFORMERS_MODEL_V1.dataPath,
    PINNED_TRANSFORMERS_MODEL_V1.dataSha256,
  );
  return physicalRoot;
}

export function normalizeTransformersEmbeddingOutputV1(
  value: unknown,
): readonly number[] {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error("embedding output is invalid");
  }
  const row: unknown = value[0];
  if (
    !Array.isArray(row) ||
    row.length !== DIMENSIONS ||
    row.some((item) => typeof item !== "number" || !Number.isFinite(item))
  ) {
    throw new Error("embedding output is invalid");
  }
  const vector = row as number[];
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  if (Math.abs(norm - 1) > NORMALIZATION_TOLERANCE) {
    throw new Error("embedding output is invalid");
  }
  return [...vector];
}

export async function createTransformersEmbeddingV1(
  modelRoot: string,
): Promise<EmbeddingPort> {
  const physicalRoot = await verifyPinnedTransformersModelV1(modelRoot);
  const plan = pinnedTransformersPipelinePlanV1(physicalRoot);
  const { pipeline } = await import("@huggingface/transformers");
  const extractor = await pipeline(plan.task, plan.model, plan.options);
  return {
    modelId: PINNED_TRANSFORMERS_MODEL_V1.modelId,
    dimensions: DIMENSIONS,
    async embed(text: string): Promise<readonly number[]> {
      if (typeof text !== "string" || text.length === 0) {
        throw new Error("embedding text is invalid");
      }
      const output = await extractor(text, plan.embeddingOptions);
      return normalizeTransformersEmbeddingOutputV1(output.tolist());
    },
  };
}
