import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { QdrantClient } from "@qdrant/js-client-rest";
import type { ProjectionRecord } from "@foreman/session-store";

import {
  QdrantClientPort,
  QdrantMemoryIndex,
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
  },
);
