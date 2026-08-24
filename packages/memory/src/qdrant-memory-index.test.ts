import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProjectionRecord } from "@foreman/session-store";

import {
  QdrantMemoryIndex,
  qdrantPointIdV1,
  type EmbeddingPort,
  type QdrantApplyV1,
  type QdrantPort,
  type QdrantQueryV1,
  type QdrantQualificationV1,
} from "./index.js";

const PROJECT = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_PROJECT = "123e4567-e89b-42d3-a456-426614174001";
const MODEL = "all-MiniLM-L6-v2@aff7a1dc";

function qualification(
  overrides: Partial<QdrantQualificationV1> = {},
): QdrantQualificationV1 {
  return {
    nodes: 1,
    shards: 1,
    replicas: 1,
    writeConsistencyFactor: 1,
    dimensions: 384,
    distance: "Cosine",
    strictMode: true,
    unindexedFilteringRetrieve: false,
    unindexedFilteringUpdate: false,
    payloadIndexes: {
      epoch_id: "keyword",
      kind: "keyword",
      live: "bool",
      model_id: "keyword",
      project_id: "keyword",
      projection_version: "integer",
    },
    ...overrides,
  };
}

class RecordingPort implements QdrantPort {
  readonly applies: QdrantApplyV1[] = [];
  readonly queries: QdrantQueryV1[] = [];
  readonly created: { projectId: string; epochId: string; collection: string }[] = [];
  readonly activated: { projectId: string; collection: string }[] = [];
  currentQualification = qualification();
  applyStatus: "completed" | "acknowledged" = "completed";
  matches: Awaited<ReturnType<QdrantPort["query"]>> = [];

  async qualify(): Promise<QdrantQualificationV1> {
    return this.currentQualification;
  }

  async qualifyCollection(_collection: string): Promise<QdrantQualificationV1> {
    return this.currentQualification;
  }

  async activeCollection(projectId: string): Promise<{
    readonly collection: string;
    readonly epochId: string;
  }> {
    return {
      collection: `foreman_${projectId.replaceAll("-", "")}_active`,
      epochId: "epoch-live",
    };
  }

  async apply(input: QdrantApplyV1): Promise<"completed" | "acknowledged"> {
    this.applies.push(input);
    return this.applyStatus;
  }

  async query(input: QdrantQueryV1) {
    this.queries.push(input);
    return this.matches;
  }

  async createEpoch(input: {
    readonly projectId: string;
    readonly epochId: string;
    readonly collection: string;
  }): Promise<void> {
    this.created.push(input);
  }

  async activate(input: {
    readonly projectId: string;
    readonly collection: string;
  }): Promise<void> {
    this.activated.push(input);
  }
}

class FixedEmbedding implements EmbeddingPort {
  readonly modelId = MODEL;
  readonly dimensions = 384;
  readonly texts: string[] = [];

  async embed(text: string): Promise<readonly number[]> {
    this.texts.push(text);
    return Array.from({ length: this.dimensions }, (_, index) =>
      index === 0 ? 1 : 0,
    );
  }
}

function upsert(version = 7): ProjectionRecord {
  return {
    project_id: PROJECT,
    key: `${PROJECT}:fact:4`,
    kind: "fact",
    id: 4,
    projection_version: version,
    mutation: "upsert",
    text: "sanitized text",
  };
}

function retract(version = 8): ProjectionRecord {
  return {
    project_id: PROJECT,
    key: `${PROJECT}:fact:4`,
    kind: "fact",
    id: 4,
    projection_version: version,
    mutation: "retract",
  };
}

describe("Qdrant point identity", () => {
  it("is stable, project-bound, kind-bound, and a UUIDv5", () => {
    const first = qdrantPointIdV1(PROJECT, "fact", 4);
    assert.match(
      first,
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.equal(qdrantPointIdV1(PROJECT, "fact", 4), first);
    assert.notEqual(qdrantPointIdV1(OTHER_PROJECT, "fact", 4), first);
    assert.notEqual(qdrantPointIdV1(PROJECT, "measurement", 4), first);
    assert.notEqual(qdrantPointIdV1(PROJECT, "fact", 5), first);
  });
});

describe("QdrantMemoryIndex", () => {
  it("emits closed version-fenced upserts and tombstones", async () => {
    const port = new RecordingPort();
    const embedding = new FixedEmbedding();
    const index = new QdrantMemoryIndex({
      projectId: PROJECT,
      port,
      embedding,
      epochId: () => "epoch-1",
    });

    await index.project([upsert(), retract()]);
    assert.deepEqual(embedding.texts, ["sanitized text"]);
    assert.equal(port.applies.length, 2);
    assert.deepEqual(port.applies.map((item) => item.options), [
      { ordering: "strong", wait: true },
      { ordering: "strong", wait: true },
    ]);
    assert.deepEqual(port.applies[0]!.point.payload, {
      epoch_id: "epoch-live",
      entity_id: 4,
      kind: "fact",
      live: true,
      model_id: MODEL,
      project_id: PROJECT,
      projection_version: 7,
      schema: "foreman.memory-point.v1",
    });
    assert.deepEqual(port.applies[0]!.condition, {
      projectionVersionLessThan: 7,
    });
    assert.deepEqual(port.applies[1]!.point.payload, {
      epoch_id: "epoch-live",
      entity_id: 4,
      kind: "fact",
      live: false,
      model_id: MODEL,
      project_id: PROJECT,
      projection_version: 8,
      schema: "foreman.memory-point.v1",
    });
    assert.equal(port.applies[1]!.point.vector.every((value) => value === 0), true);
    assert.equal("text" in port.applies[0]!.point.payload, false);
    assert.equal("path" in port.applies[0]!.point.payload, false);
  });

  it("refuses an acknowledged but incomplete mutation", async () => {
    const port = new RecordingPort();
    port.applyStatus = "acknowledged";
    const index = new QdrantMemoryIndex({
      projectId: PROJECT,
      port,
      embedding: new FixedEmbedding(),
      epochId: () => "epoch-1",
    });
    await assert.rejects(index.project([upsert()]), /completed/);
  });

  it("qualifies before mutation and refuses unsupported topology", async () => {
    const port = new RecordingPort();
    port.currentQualification = qualification({ replicas: 2 });
    const index = new QdrantMemoryIndex({
      projectId: PROJECT,
      port,
      embedding: new FixedEmbedding(),
      epochId: () => "epoch-1",
    });
    await assert.rejects(index.project([upsert()]), /qualification/);
    assert.equal(port.applies.length, 0);
  });

  it("recalls only closed project-bound references with consistency all", async () => {
    const port = new RecordingPort();
    port.matches = [
      { project_id: PROJECT, kind: "fact", entity_id: 4, score: 0.75 },
      { project_id: OTHER_PROJECT, kind: "fact", entity_id: 4, score: 1 },
      { project_id: PROJECT, kind: "unknown", entity_id: 5, score: 0.5 },
    ];
    const index = new QdrantMemoryIndex({
      projectId: PROJECT,
      port,
      embedding: new FixedEmbedding(),
      epochId: () => "epoch-1",
    });
    assert.deepEqual(await index.recall("query", 5), [
      { project_id: PROJECT, kind: "fact", id: 4, score: 0.75 },
    ]);
    assert.deepEqual(port.queries[0], {
      collection: `foreman_${PROJECT.replaceAll("-", "")}_active`,
      consistency: "all",
      filter: {
        epoch_id: "epoch-live",
        live: true,
        model_id: MODEL,
        project_id: PROJECT,
      },
      limit: 5,
      vector: Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0),
    });
  });

  it("creates isolated epochs and activates by one port call", async () => {
    const port = new RecordingPort();
    const index = new QdrantMemoryIndex({
      projectId: PROJECT,
      port,
      embedding: new FixedEmbedding(),
      epochId: () => "epoch-42",
    });
    const collection = await index.beginEpoch();
    assert.equal(collection, `foreman_${PROJECT.replaceAll("-", "")}_epoch_epoch-42`);
    assert.deepEqual(port.created, [
      { projectId: PROJECT, epochId: "epoch-42", collection },
    ]);
    await index.activateEpoch(collection);
    assert.deepEqual(port.activated, [{ projectId: PROJECT, collection }]);
  });
});
