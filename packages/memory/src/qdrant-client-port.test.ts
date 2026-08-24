import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { QdrantClient } from "@qdrant/js-client-rest";

import {
  QdrantClientPort,
  type QdrantApplyV1,
} from "./index.js";

const PROJECT = "123e4567-e89b-42d3-a456-426614174000";
const STEM = "foreman_123e4567e89b42d3a456426614174000";
const ALIAS = `${STEM}_active`;
const COLLECTION = `${STEM}_epoch_epoch-live`;

class RecordingClient {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  aliases = {
    aliases: [{ alias_name: ALIAS, collection_name: COLLECTION }],
  };
  collection = {
    status: "green",
    optimizer_status: "ok",
    segments_count: 1,
    config: {
      params: {
        vectors: { size: 384, distance: "Cosine" },
        shard_number: 1,
        replication_factor: 1,
        write_consistency_factor: 1,
      },
      hnsw_config: {},
      optimizer_config: {},
      strict_mode_config: {
        enabled: true,
        unindexed_filtering_retrieve: false,
        unindexed_filtering_update: false,
      },
      metadata: {
        schema: "foreman.memory-epoch.v1",
        project_id: PROJECT,
        epoch_id: "epoch-live",
      },
    },
    payload_schema: {
      epoch_id: { data_type: "keyword", points: 0 },
      kind: { data_type: "keyword", points: 0 },
      live: { data_type: "bool", points: 0 },
      model_id: { data_type: "keyword", points: 0 },
      project_id: { data_type: "keyword", points: 0 },
      projection_version: { data_type: "integer", points: 0 },
    },
  };
  telemetry = {
    collections: {},
    cluster: { enabled: false, peers: {} },
  };
  updateStatus: "completed" | "acknowledged" = "completed";
  queryPoints: unknown[] = [];

  async getAliases() {
    this.calls.push({ method: "getAliases", args: [] });
    return this.aliases;
  }

  async getCollection(name: string) {
    this.calls.push({ method: "getCollection", args: [name] });
    return this.collection;
  }

  async clusterTelemetry(args: unknown) {
    this.calls.push({ method: "clusterTelemetry", args: [args] });
    return this.telemetry;
  }

  async upsert(name: string, input: unknown) {
    this.calls.push({ method: "upsert", args: [name, input] });
    return { operation_id: 1, status: this.updateStatus };
  }

  async query(name: string, input: unknown) {
    this.calls.push({ method: "query", args: [name, input] });
    return { points: this.queryPoints };
  }

  async createCollection(name: string, input: unknown) {
    this.calls.push({ method: "createCollection", args: [name, input] });
    return true;
  }

  async createPayloadIndex(name: string, input: unknown) {
    this.calls.push({ method: "createPayloadIndex", args: [name, input] });
    return { operation_id: 1, status: "completed" };
  }

  async updateCollectionAliases(input: unknown) {
    this.calls.push({ method: "updateCollectionAliases", args: [input] });
    return true;
  }
}

function port(client = new RecordingClient()): {
  readonly client: RecordingClient;
  readonly port: QdrantClientPort;
} {
  return {
    client,
    port: new QdrantClientPort({
      client: client as unknown as QdrantClient,
      projectId: PROJECT,
    }),
  };
}

function applyInput(): QdrantApplyV1 {
  return {
    collection: ALIAS,
    point: {
      id: "60e1bc02-8921-50e7-b139-706f9e4b07a8",
      vector: [1, 0],
      payload: {
        schema: "foreman.memory-point.v1",
        project_id: PROJECT,
        kind: "fact",
        entity_id: 4,
        epoch_id: "epoch-live",
        model_id: "model@revision",
        projection_version: 7,
        live: true,
      },
    },
    condition: { projectionVersionLessThan: 7 },
    options: { ordering: "strong", wait: true },
  };
}

describe("QdrantClientPort", () => {
  it("qualifies the physical active collection exactly", async () => {
    const fixture = port();
    assert.deepEqual(await fixture.port.activeCollection(PROJECT), {
      collection: ALIAS,
      epochId: "epoch-live",
    });
    assert.deepEqual(await fixture.port.qualify(), {
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
    });
    assert.equal(
      fixture.client.calls.some(
        (call) => call.method === "getCollection" && call.args[0] === COLLECTION,
      ),
      true,
    );
  });

  it("maps conditional writes and consistency-all reads without widening payload", async () => {
    const fixture = port();
    assert.equal(await fixture.port.apply(applyInput()), "completed");
    assert.deepEqual(fixture.client.calls.at(-1), {
      method: "upsert",
      args: [
        ALIAS,
        {
          wait: true,
          ordering: "strong",
          points: [applyInput().point],
          update_filter: {
            must: [
              { key: "projection_version", range: { lt: 7 } },
            ],
          },
        },
      ],
    });

    fixture.client.queryPoints = [
      {
        id: applyInput().point.id,
        score: 0.8,
        payload: {
          project_id: PROJECT,
          kind: "fact",
          entity_id: 4,
          ignored: "not returned",
        },
      },
    ];
    assert.deepEqual(
      await fixture.port.query({
        collection: ALIAS,
        vector: [1, 0],
        filter: {
          project_id: PROJECT,
          epoch_id: "epoch-live",
          model_id: "model@revision",
          live: true,
        },
        limit: 5,
        consistency: "all",
      }),
      [{ project_id: PROJECT, kind: "fact", entity_id: 4, score: 0.8 }],
    );
    assert.deepEqual(fixture.client.calls.at(-1), {
      method: "query",
      args: [
        ALIAS,
        {
          consistency: "all",
          query: [1, 0],
          filter: {
            must: [
              { key: "project_id", match: { value: PROJECT } },
              { key: "epoch_id", match: { value: "epoch-live" } },
              { key: "model_id", match: { value: "model@revision" } },
              { key: "live", match: { value: true } },
            ],
          },
          limit: 5,
          with_payload: ["project_id", "kind", "entity_id"],
          with_vector: false,
        },
      ],
    });
  });

  it("creates one strict indexed epoch and requires every completed index", async () => {
    const fixture = port();
    await fixture.port.createEpoch({
      projectId: PROJECT,
      epochId: "epoch-next",
      collection: `${STEM}_epoch_epoch-next`,
    });
    const create = fixture.client.calls.find(
      (call) => call.method === "createCollection",
    );
    assert.deepEqual(create, {
      method: "createCollection",
      args: [
        `${STEM}_epoch_epoch-next`,
        {
          vectors: { size: 384, distance: "Cosine" },
          shard_number: 1,
          replication_factor: 1,
          write_consistency_factor: 1,
          strict_mode_config: {
            enabled: true,
            unindexed_filtering_retrieve: false,
            unindexed_filtering_update: false,
          },
          metadata: {
            schema: "foreman.memory-epoch.v1",
            project_id: PROJECT,
            epoch_id: "epoch-next",
          },
        },
      ],
    });
    const indexes = fixture.client.calls.filter(
      (call) => call.method === "createPayloadIndex",
    );
    assert.deepEqual(
      indexes.map((call) => call.args),
      [
        ["projection_version", "integer"],
        ["live", "bool"],
        ["project_id", "keyword"],
        ["kind", "keyword"],
        ["epoch_id", "keyword"],
        ["model_id", "keyword"],
      ].map(([field_name, field_schema]) => [
        `${STEM}_epoch_epoch-next`,
        { field_name, field_schema, wait: true, ordering: "strong" },
      ]),
    );
  });

  it("activates an epoch with one atomic alias request", async () => {
    const fixture = port();
    await fixture.port.activate({
      projectId: PROJECT,
      collection: `${STEM}_epoch_epoch-next`,
    });
    assert.deepEqual(fixture.client.calls.at(-1), {
      method: "updateCollectionAliases",
      args: [{
        actions: [
          { delete_alias: { alias_name: ALIAS } },
          {
            create_alias: {
              alias_name: ALIAS,
              collection_name: `${STEM}_epoch_epoch-next`,
            },
          },
        ],
      }],
    });
  });
});
