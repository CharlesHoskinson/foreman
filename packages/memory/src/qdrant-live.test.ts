import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { QdrantClient } from "@qdrant/js-client-rest";
import type { ProjectionRecord } from "@foreman/session-store";

import {
  QdrantClientPort,
  QdrantMemoryIndex,
  qdrantPointIdV1,
  type EmbeddingPort,
} from "./index.js";

const LIVE_URL = process.env["FOREMAN_QDRANT_URL"];

class LiveEmbedding implements EmbeddingPort {
  readonly modelId = "foreman-live-fixture@1";
  readonly dimensions = 384;

  async embed(text: string): Promise<readonly number[]> {
    const first = text === "alpha" ? 1 : 0.5;
    return Array.from({ length: this.dimensions }, (_, index) =>
      index === 0 ? first : 0,
    );
  }
}

describe(
  "Qdrant 1.19 live adapter",
  { skip: LIVE_URL === undefined ? "set FOREMAN_QDRANT_URL to opt in" : false },
  () => {
    it("creates, activates, versions, recalls, and tombstones one epoch", async () => {
      assert.ok(LIVE_URL);
      const projectId = randomUUID();
      const apiKey = process.env["FOREMAN_QDRANT_API_KEY"];
      const client = new QdrantClient({
        url: LIVE_URL,
        ...(apiKey === undefined ? {} : { apiKey }),
        checkCompatibility: true,
      });
      const port = new QdrantClientPort({ client, projectId });
      const index = new QdrantMemoryIndex({
        projectId,
        port,
        embedding: new LiveEmbedding(),
        epochId: () => "live-test",
      });
      const collection = await index.beginEpoch();
      try {
        await index.activateEpoch(collection);
        const upsert: ProjectionRecord = {
          project_id: projectId,
          key: `${projectId}:fact:1`,
          kind: "fact",
          id: 1,
          projection_version: 1,
          mutation: "upsert",
          text: "alpha",
        };
        await index.project([upsert, upsert]);
        assert.deepEqual(await index.recall("alpha", 5), [
          { project_id: projectId, kind: "fact", id: 1, score: 1 },
        ]);
        await index.project([{
          project_id: projectId,
          key: `${projectId}:fact:1`,
          kind: "fact",
          id: 1,
          projection_version: 2,
          mutation: "retract",
        }]);
        assert.deepEqual(await index.recall("alpha", 5), []);
      } finally {
        await client.deleteCollection(collection);
      }
    });

    it("fences stale upserts and retracts after newer desired state", async () => {
      assert.ok(LIVE_URL);
      const projectId = randomUUID();
      const client = new QdrantClient({ url: LIVE_URL, checkCompatibility: true });
      const port = new QdrantClientPort({ client, projectId });
      const index = new QdrantMemoryIndex({
        projectId,
        port,
        embedding: new LiveEmbedding(),
        epochId: () => "version-fence",
      });
      const collection = await index.beginEpoch();
      try {
        await index.activateEpoch(collection);
        const upsert = (version: number): ProjectionRecord => ({
          project_id: projectId,
          key: `${projectId}:fact:1`,
          kind: "fact",
          id: 1,
          projection_version: version,
          mutation: "upsert",
          text: "alpha",
        });
        const retract = (version: number): ProjectionRecord => ({
          project_id: projectId,
          key: `${projectId}:fact:1`,
          kind: "fact",
          id: 1,
          projection_version: version,
          mutation: "retract",
        });

        await index.project([upsert(1), retract(2), upsert(1)]);
        assert.deepEqual(await index.recall("alpha", 5), []);

        await index.project([upsert(3), retract(2), upsert(3)]);
        assert.deepEqual(await index.recall("alpha", 5), [
          { project_id: projectId, kind: "fact", id: 1, score: 1 },
        ]);
        const stored = await client.retrieve(collection, {
          ids: [qdrantPointIdV1(projectId, "fact", 1)],
          with_payload: true,
          with_vector: false,
          consistency: "all",
        });
        assert.equal(stored[0]?.payload?.["projection_version"], 3);
        assert.equal(stored[0]?.payload?.["live"], true);

        await index.project([{
          project_id: projectId,
          key: `${projectId}:fact:99`,
          kind: "fact",
          id: 99,
          projection_version: 1,
          mutation: "retract",
        }]);
        assert.deepEqual(await index.recall("alpha", 5), [
          { project_id: projectId, kind: "fact", id: 1, score: 1 },
        ]);
      } finally {
        await client.deleteCollection(collection);
      }
    });

    it("keeps a candidate invisible and changes epochs atomically", async () => {
      assert.ok(LIVE_URL);
      const projectId = randomUUID();
      const client = new QdrantClient({ url: LIVE_URL, checkCompatibility: true });
      const port = new QdrantClientPort({ client, projectId });
      let epoch = "active";
      const index = new QdrantMemoryIndex({
        projectId,
        port,
        embedding: new LiveEmbedding(),
        epochId: () => epoch,
      });
      const active = await index.beginEpoch();
      let candidate: string | null = null;
      try {
        await index.activateEpoch(active);
        await index.project([{
          project_id: projectId,
          key: `${projectId}:fact:1`,
          kind: "fact",
          id: 1,
          projection_version: 1,
          mutation: "upsert",
          text: "alpha",
        }]);

        epoch = "candidate";
        candidate = await index.beginEpoch();
        await index.projectEpoch(candidate, [{
          project_id: projectId,
          key: `${projectId}:fact:2`,
          kind: "fact",
          id: 2,
          projection_version: 2,
          mutation: "upsert",
          text: "alpha",
        }]);
        assert.deepEqual(await index.recall("alpha", 5), [
          { project_id: projectId, kind: "fact", id: 1, score: 1 },
        ]);

        const racing = Array.from({ length: 12 }, () => index.recall("alpha", 5));
        await index.activateEpoch(candidate);
        const results = await Promise.all(racing);
        for (const result of results) {
          assert.equal(result.length, 1);
          assert.equal(result[0]?.project_id, projectId);
          assert.equal(result[0]?.kind, "fact");
          assert.equal(result[0]?.id === 1 || result[0]?.id === 2, true);
        }
        assert.deepEqual(await index.recall("alpha", 5), [
          { project_id: projectId, kind: "fact", id: 2, score: 1 },
        ]);
      } finally {
        await Promise.allSettled([
          client.deleteCollection(active),
          ...(candidate === null ? [] : [client.deleteCollection(candidate)]),
        ]);
      }
    });
  },
);
