import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProjectionRecord } from "@foreman/session-store";

import {
  ProjectionEpochCoordinator,
  QdrantMemoryIndex,
  type EmbeddingPort,
  type ProjectionLease,
  type QdrantApplyV1,
  type QdrantPort,
  type QdrantQualificationV1,
  type QdrantQueryV1,
} from "./index.js";

const PROJECT = "123e4567-e89b-42d3-a456-426614174000";
const ACTIVE = "foreman_123e4567e89b42d3a456426614174000_active";
const CANDIDATE = "foreman_123e4567e89b42d3a456426614174000_epoch_epoch-next";

const QUALIFICATION: QdrantQualificationV1 = {
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
};

function record(id: number, version: number): ProjectionRecord {
  return {
    project_id: PROJECT,
    key: `${PROJECT}:fact:${id}`,
    kind: "fact",
    id,
    projection_version: version,
    mutation: "upsert",
    text: `fact ${id}`,
  };
}

class Port implements QdrantPort {
  readonly applies: QdrantApplyV1[] = [];
  readonly activations: string[] = [];

  async qualify() { return QUALIFICATION; }
  async qualifyCollection(_collection: string) { return QUALIFICATION; }
  async activeCollection() {
    return { collection: ACTIVE, epochId: "epoch-live" };
  }
  async apply(input: QdrantApplyV1) {
    this.applies.push(input);
    return "completed" as const;
  }
  async query(_input: QdrantQueryV1) { return []; }
  async createEpoch() {}
  async activate(input: { projectId: string; collection: string }) {
    this.activations.push(input.collection);
  }
}

class Embedding implements EmbeddingPort {
  readonly modelId = "model@1";
  readonly dimensions = 384;
  async embed() {
    return Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0);
  }
}

function lease(current: () => boolean): {
  readonly port: { acquire(): Promise<ProjectionLease> };
  readonly releases: { count: number };
} {
  const releases = { count: 0 };
  return {
    releases,
    port: {
      async acquire() {
        return {
          fencingToken: 7,
          async isCurrent() { return current(); },
          async release() { releases.count += 1; },
        };
      },
    },
  };
}

function index(port: Port): QdrantMemoryIndex {
  return new QdrantMemoryIndex({
    projectId: PROJECT,
    port,
    embedding: new Embedding(),
    epochId: () => "epoch-next",
  });
}

describe("ProjectionEpochCoordinator", () => {
  it("keeps snapshot data isolated and catches changes up to both collections", async () => {
    const qdrant = new Port();
    const owned = lease(() => true);
    const coordinator = new ProjectionEpochCoordinator({
      projectId: PROJECT,
      index: index(qdrant),
      lease: owned.port,
      source: {
        snapshot: () => [record(1, 1)],
        async catchUp() {
          return { records: [record(2, 2)], cursor: "c1", caughtUp: true };
        },
      },
    });
    assert.equal(await coordinator.rebuild(), CANDIDATE);
    assert.deepEqual(
      qdrant.applies.map((apply) => [apply.collection, apply.point.payload.entity_id]),
      [
        [CANDIDATE, 1],
        [ACTIVE, 2],
        [CANDIDATE, 2],
      ],
    );
    assert.deepEqual(qdrant.activations, [CANDIDATE]);
    assert.equal(owned.releases.count, 1);
  });

  it("abandons the candidate when the lease is lost before activation", async () => {
    const qdrant = new Port();
    let checks = 0;
    const owned = lease(() => ++checks < 4);
    const coordinator = new ProjectionEpochCoordinator({
      projectId: PROJECT,
      index: index(qdrant),
      lease: owned.port,
      source: {
        snapshot: () => [record(1, 1)],
        async catchUp() {
          return { records: [], cursor: "c1", caughtUp: true };
        },
      },
    });
    await assert.rejects(coordinator.rebuild(), /lease was lost/);
    assert.deepEqual(qdrant.activations, []);
    assert.equal(owned.releases.count, 1);
  });
});
