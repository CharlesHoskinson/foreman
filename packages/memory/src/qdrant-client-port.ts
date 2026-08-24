import type { QdrantClient } from "@qdrant/js-client-rest";

import { isProjectIdV1 } from "@foreman/session-store";

import type {
  QdrantApplyV1,
  QdrantPort,
  QdrantQualificationV1,
  QdrantQueryMatchV1,
  QdrantQueryV1,
} from "./qdrant-memory-index.js";

const INDEXES = [
  ["projection_version", "integer"],
  ["live", "bool"],
  ["project_id", "keyword"],
  ["kind", "keyword"],
  ["epoch_id", "keyword"],
  ["model_id", "keyword"],
] as const;

type PlainObject = Record<string, unknown>;

export type QdrantClientPortOptions = {
  readonly client: QdrantClient;
  readonly projectId: string;
};

function object(value: unknown): PlainObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as PlainObject
    : null;
}

function collectionStem(projectId: string): string {
  return `foreman_${projectId.replaceAll("-", "")}`;
}

function aliasName(projectId: string): string {
  return `${collectionStem(projectId)}_active`;
}

function epochMetadata(
  info: unknown,
  projectId: string,
): { readonly epochId: string } | null {
  const root = object(info);
  const config = object(root?.["config"]);
  const metadata = object(config?.["metadata"]);
  if (
    metadata?.["schema"] !== "foreman.memory-epoch.v1" ||
    metadata["project_id"] !== projectId ||
    typeof metadata["epoch_id"] !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(metadata["epoch_id"])
  ) {
    return null;
  }
  return { epochId: metadata["epoch_id"] };
}

function nodeCount(telemetry: unknown): number {
  const root = object(telemetry);
  const cluster = object(root?.["cluster"]);
  if (cluster?.["enabled"] === false) return 1;
  if (
    cluster?.["enabled"] === true &&
    typeof cluster["number_of_peers"] === "number" &&
    Number.isSafeInteger(cluster["number_of_peers"])
  ) {
    return cluster["number_of_peers"];
  }
  return 0;
}

function qualification(
  info: unknown,
  nodes: number,
): QdrantQualificationV1 {
  const root = object(info);
  if (root?.["status"] !== "green") {
    throw new Error("Qdrant collection is not ready");
  }
  const config = object(root["config"]);
  const params = object(config?.["params"]);
  const vectors = object(params?.["vectors"]);
  const strict = object(config?.["strict_mode_config"]);
  const rawSchema = object(root["payload_schema"]);
  const payloadIndexes: Record<string, string> = {};
  if (rawSchema !== null) {
    for (const [name, raw] of Object.entries(rawSchema)) {
      const entry = object(raw);
      if (typeof entry?.["data_type"] === "string") {
        payloadIndexes[name] = entry["data_type"];
      }
    }
  }
  return {
    nodes,
    shards: typeof params?.["shard_number"] === "number"
      ? params["shard_number"]
      : 0,
    replicas: typeof params?.["replication_factor"] === "number"
      ? params["replication_factor"]
      : 0,
    writeConsistencyFactor:
      typeof params?.["write_consistency_factor"] === "number"
        ? params["write_consistency_factor"]
        : 0,
    dimensions: typeof vectors?.["size"] === "number" ? vectors["size"] : 0,
    distance: vectors?.["distance"] === "Cosine" ||
        vectors?.["distance"] === "Dot" ||
        vectors?.["distance"] === "Euclid" ||
        vectors?.["distance"] === "Manhattan"
      ? vectors["distance"]
      : "Euclid",
    strictMode: strict?.["enabled"] === true,
    unindexedFilteringRetrieve:
      strict?.["unindexed_filtering_retrieve"] === true,
    unindexedFilteringUpdate:
      strict?.["unindexed_filtering_update"] === true,
    payloadIndexes,
  };
}

function aliases(value: unknown): readonly {
  readonly alias_name: string;
  readonly collection_name: string;
}[] {
  const root = object(value);
  if (!Array.isArray(root?.["aliases"])) {
    throw new Error("Qdrant aliases response is invalid");
  }
  return root["aliases"].map((raw) => {
    const entry = object(raw);
    if (
      typeof entry?.["alias_name"] !== "string" ||
      typeof entry["collection_name"] !== "string"
    ) {
      throw new Error("Qdrant alias is invalid");
    }
    return {
      alias_name: entry["alias_name"],
      collection_name: entry["collection_name"],
    };
  });
}

export class QdrantClientPort implements QdrantPort {
  readonly #client: QdrantClient;
  readonly #projectId: string;

  constructor(options: QdrantClientPortOptions) {
    if (!isProjectIdV1(options.projectId)) {
      throw new Error("invalid project id");
    }
    this.#client = options.client;
    this.#projectId = options.projectId;
  }

  async #activePhysicalCollection(): Promise<{
    readonly alias: string;
    readonly collection: string;
    readonly epochId: string;
  }> {
    const alias = aliasName(this.#projectId);
    const matches = aliases(await this.#client.getAliases()).filter(
      (entry) => entry.alias_name === alias,
    );
    if (matches.length !== 1) {
      throw new Error("Qdrant active alias is missing or ambiguous");
    }
    const collection = matches[0]!.collection_name;
    const info = await this.#client.getCollection(collection);
    const metadata = epochMetadata(info, this.#projectId);
    if (metadata === null) {
      throw new Error("Qdrant active epoch metadata is invalid");
    }
    return { alias, collection, epochId: metadata.epochId };
  }

  async qualify(): Promise<QdrantQualificationV1> {
    const active = await this.#activePhysicalCollection();
    const [telemetry, info] = await Promise.all([
      this.#client.clusterTelemetry({ details_level: 1, per_collection: false }),
      this.#client.getCollection(active.collection),
    ]);
    return qualification(info, nodeCount(telemetry));
  }

  async activeCollection(projectId: string): Promise<{
    readonly collection: string;
    readonly epochId: string;
  }> {
    if (projectId !== this.#projectId) throw new Error("wrong project");
    const active = await this.#activePhysicalCollection();
    return { collection: active.alias, epochId: active.epochId };
  }

  async apply(input: QdrantApplyV1): Promise<"completed" | "acknowledged"> {
    const result = await this.#client.upsert(input.collection, {
      wait: input.options.wait,
      ordering: input.options.ordering,
      points: [{
        id: input.point.id,
        vector: [...input.point.vector],
        payload: { ...input.point.payload },
      }],
      update_filter: {
        must: [{
          key: "projection_version",
          range: { lt: input.condition.projectionVersionLessThan },
        }],
      },
    });
    return result.status === "completed" ? "completed" : "acknowledged";
  }

  async query(input: QdrantQueryV1): Promise<readonly QdrantQueryMatchV1[]> {
    const response = await this.#client.query(input.collection, {
      consistency: input.consistency,
      query: [...input.vector],
      filter: {
        must: [
          { key: "project_id", match: { value: input.filter.project_id } },
          { key: "epoch_id", match: { value: input.filter.epoch_id } },
          { key: "model_id", match: { value: input.filter.model_id } },
          { key: "live", match: { value: input.filter.live } },
        ],
      },
      limit: input.limit,
      with_payload: ["project_id", "kind", "entity_id"],
      with_vector: false,
    });
    return response.points.map((point) => {
      const payload = object(point.payload);
      return {
        project_id: payload?.["project_id"],
        kind: payload?.["kind"],
        entity_id: payload?.["entity_id"],
        score: point.score,
      };
    });
  }

  async createEpoch(input: {
    readonly projectId: string;
    readonly epochId: string;
    readonly collection: string;
  }): Promise<void> {
    if (input.projectId !== this.#projectId) throw new Error("wrong project");
    const telemetry = await this.#client.clusterTelemetry({
      details_level: 1,
      per_collection: false,
    });
    if (nodeCount(telemetry) !== 1) {
      throw new Error("Qdrant topology is unsupported");
    }
    const created = await this.#client.createCollection(input.collection, {
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
        project_id: input.projectId,
        epoch_id: input.epochId,
      },
    });
    if (!created) throw new Error("Qdrant epoch creation failed");
    for (const [field_name, field_schema] of INDEXES) {
      const indexed = await this.#client.createPayloadIndex(input.collection, {
        field_name,
        field_schema,
        wait: true,
        ordering: "strong",
      });
      if (indexed.status !== "completed") {
        throw new Error("Qdrant payload index was not completed");
      }
    }
  }

  async activate(input: {
    readonly projectId: string;
    readonly collection: string;
  }): Promise<void> {
    if (input.projectId !== this.#projectId) throw new Error("wrong project");
    const alias = aliasName(this.#projectId);
    const current = aliases(await this.#client.getAliases()).filter(
      (entry) => entry.alias_name === alias,
    );
    if (current.length > 1) {
      throw new Error("Qdrant active alias is ambiguous");
    }
    const actions = [
      ...(current.length === 0
        ? []
        : [{ delete_alias: { alias_name: alias } }]),
      {
        create_alias: {
          alias_name: alias,
          collection_name: input.collection,
        },
      },
    ];
    const changed = await this.#client.updateCollectionAliases({ actions });
    if (!changed) throw new Error("Qdrant alias activation failed");
  }
}
