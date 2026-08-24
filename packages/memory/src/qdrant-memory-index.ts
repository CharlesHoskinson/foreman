import { createHash } from "node:crypto";

import {
  isProjectIdV1,
  projectionKey,
  type CountedKind,
  type EntityRef,
  type MemoryIndex,
  type ProjectionRecord,
} from "@foreman/session-store";

const POINT_NAMESPACE = "89ad5b45-7f87-5ee2-b9c1-8b20a673bb61";
const QUALIFICATION_INDEXES = {
  epoch_id: "keyword",
  kind: "keyword",
  live: "bool",
  model_id: "keyword",
  project_id: "keyword",
  projection_version: "integer",
} as const;
const KINDS = new Set<CountedKind>(["fact", "measurement", "obligation"]);

export type QdrantQualificationV1 = {
  readonly nodes: number;
  readonly shards: number;
  readonly replicas: number;
  readonly writeConsistencyFactor: number;
  readonly dimensions: number;
  readonly distance: "Cosine" | "Dot" | "Euclid" | "Manhattan";
  readonly strictMode: boolean;
  readonly unindexedFilteringRetrieve: boolean;
  readonly unindexedFilteringUpdate: boolean;
  readonly payloadIndexes: Readonly<Record<string, string>>;
};

export type QdrantPointPayloadV1 = {
  readonly schema: "foreman.memory-point.v1";
  readonly project_id: string;
  readonly kind: CountedKind;
  readonly entity_id: number;
  readonly epoch_id: string;
  readonly model_id: string;
  readonly projection_version: number;
  readonly live: boolean;
};

export type QdrantApplyV1 = {
  readonly collection: string;
  readonly point: {
    readonly id: string;
    readonly vector: readonly number[];
    readonly payload: QdrantPointPayloadV1;
  };
  readonly condition: {
    readonly projectionVersionLessThan: number;
  };
  readonly options: {
    readonly ordering: "strong";
    readonly wait: true;
  };
};

export type QdrantQueryV1 = {
  readonly collection: string;
  readonly vector: readonly number[];
  readonly filter: {
    readonly project_id: string;
    readonly epoch_id: string;
    readonly model_id: string;
    readonly live: true;
  };
  readonly limit: number;
  readonly consistency: "all";
};

export type QdrantQueryMatchV1 = {
  readonly project_id: unknown;
  readonly kind: unknown;
  readonly entity_id: unknown;
  readonly score: unknown;
};

export interface QdrantPort {
  qualify(): Promise<QdrantQualificationV1>;
  qualifyCollection(collection: string): Promise<QdrantQualificationV1>;
  activeCollection(projectId: string): Promise<{
    readonly collection: string;
    readonly epochId: string;
  }>;
  apply(input: QdrantApplyV1): Promise<"completed" | "acknowledged">;
  query(input: QdrantQueryV1): Promise<readonly QdrantQueryMatchV1[]>;
  createEpoch(input: {
    readonly projectId: string;
    readonly epochId: string;
    readonly collection: string;
  }): Promise<void>;
  activate(input: {
    readonly projectId: string;
    readonly collection: string;
  }): Promise<void>;
}

export interface EmbeddingPort {
  readonly modelId: string;
  readonly dimensions: number;
  embed(text: string): Promise<readonly number[]>;
}

export type QdrantMemoryIndexOptions = {
  readonly projectId: string;
  readonly port: QdrantPort;
  readonly embedding: EmbeddingPort;
  readonly epochId: () => string;
};

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

function renderUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** RFC 9562 UUIDv5 over one fixed Foreman namespace. */
export function qdrantPointIdV1(
  projectId: string,
  kind: CountedKind,
  entityId: number,
): string {
  if (!isProjectIdV1(projectId)) throw new Error("invalid project id");
  if (!KINDS.has(kind)) throw new Error("invalid entity kind");
  if (!Number.isSafeInteger(entityId) || entityId < 1) {
    throw new Error("invalid entity id");
  }
  const digest = createHash("sha1")
    .update(uuidBytes(POINT_NAMESPACE))
    .update(`${projectId}:${kind}:${entityId}`)
    .digest()
    .subarray(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  return renderUuid(digest);
}

function qualificationIsExact(value: QdrantQualificationV1): boolean {
  if (
    value.nodes !== 1 ||
    value.shards !== 1 ||
    value.replicas !== 1 ||
    value.writeConsistencyFactor !== 1 ||
    value.dimensions !== 384 ||
    value.distance !== "Cosine" ||
    value.strictMode !== true ||
    value.unindexedFilteringRetrieve !== false ||
    value.unindexedFilteringUpdate !== false
  ) {
    return false;
  }
  const actual = Object.keys(value.payloadIndexes).sort();
  const expected = Object.keys(QUALIFICATION_INDEXES).sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    return false;
  }
  return expected.every(
    (key) => value.payloadIndexes[key] === QUALIFICATION_INDEXES[key as keyof typeof QUALIFICATION_INDEXES],
  );
}

function validateVector(
  vector: readonly number[],
  dimensions: number,
): readonly number[] {
  if (
    vector.length !== dimensions ||
    vector.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("embedding vector is invalid");
  }
  return [...vector];
}

function validateRecord(record: ProjectionRecord, projectId: string): void {
  if (
    record.project_id !== projectId ||
    record.key !== projectionKey(record.kind, record.id, projectId) ||
    !Number.isSafeInteger(record.projection_version) ||
    record.projection_version < 1
  ) {
    throw new Error("projection record is invalid");
  }
}

function safeEpoch(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

function collectionStem(projectId: string): string {
  return `foreman_${projectId.replaceAll("-", "")}`;
}

export class QdrantMemoryIndex implements MemoryIndex {
  readonly name = "qdrant";
  readonly #projectId: string;
  readonly #port: QdrantPort;
  readonly #embedding: EmbeddingPort;
  readonly #epochId: () => string;

  constructor(options: QdrantMemoryIndexOptions) {
    if (!isProjectIdV1(options.projectId)) throw new Error("invalid project id");
    if (
      options.embedding.dimensions !== 384 ||
      options.embedding.modelId.length === 0
    ) {
      throw new Error("embedding contract is invalid");
    }
    this.#projectId = options.projectId;
    this.#port = options.port;
    this.#embedding = options.embedding;
    this.#epochId = options.epochId;
  }

  async #qualify(): Promise<void> {
    if (!qualificationIsExact(await this.#port.qualify())) {
      throw new Error("Qdrant qualification failed");
    }
  }

  async #qualifyCollection(collection: string): Promise<void> {
    if (!qualificationIsExact(await this.#port.qualifyCollection(collection))) {
      throw new Error("Qdrant qualification failed");
    }
  }

  async #projectCollection(
    collection: string,
    epochId: string,
    records: readonly ProjectionRecord[],
  ): Promise<void> {
    for (const record of records) {
      validateRecord(record, this.#projectId);
      const vector = record.mutation === "upsert"
        ? validateVector(
            await this.#embedding.embed(record.text),
            this.#embedding.dimensions,
          )
        : Array.from({ length: this.#embedding.dimensions }, () => 0);
      const status = await this.#port.apply({
        collection,
        point: {
          id: qdrantPointIdV1(this.#projectId, record.kind, record.id),
          vector,
          payload: {
            schema: "foreman.memory-point.v1",
            project_id: this.#projectId,
            kind: record.kind,
            entity_id: record.id,
            epoch_id: epochId,
            model_id: this.#embedding.modelId,
            projection_version: record.projection_version,
            live: record.mutation === "upsert",
          },
        },
        condition: {
          projectionVersionLessThan: record.projection_version,
        },
        options: { ordering: "strong", wait: true },
      });
      if (status !== "completed") {
        throw new Error("Qdrant mutation was not completed");
      }
    }
  }

  async project(records: readonly ProjectionRecord[]): Promise<void> {
    await this.#qualify();
    const active = await this.#port.activeCollection(this.#projectId);
    if (!safeEpoch(active.epochId) || active.collection.length === 0) {
      throw new Error("active epoch is invalid");
    }
    await this.#projectCollection(active.collection, active.epochId, records);
  }

  /** Project a rebuild snapshot or catch-up batch into one inactive epoch. */
  async projectEpoch(
    collection: string,
    records: readonly ProjectionRecord[],
  ): Promise<void> {
    const prefix = `${collectionStem(this.#projectId)}_epoch_`;
    const epochId = collection.startsWith(prefix)
      ? collection.slice(prefix.length)
      : "";
    if (!safeEpoch(epochId)) throw new Error("epoch collection is invalid");
    await this.#qualifyCollection(collection);
    await this.#projectCollection(collection, epochId, records);
  }

  async recall(query: string, limit: number): Promise<readonly EntityRef[]> {
    if (typeof query !== "string" || query.length === 0) {
      throw new Error("query is invalid");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("limit is invalid");
    }
    await this.#qualify();
    const active = await this.#port.activeCollection(this.#projectId);
    if (!safeEpoch(active.epochId) || active.collection.length === 0) {
      throw new Error("active epoch is invalid");
    }
    const vector = validateVector(
      await this.#embedding.embed(query),
      this.#embedding.dimensions,
    );
    const matches = await this.#port.query({
      collection: active.collection,
      vector,
      filter: {
        project_id: this.#projectId,
        epoch_id: active.epochId,
        model_id: this.#embedding.modelId,
        live: true,
      },
      limit,
      consistency: "all",
    });
    const out: EntityRef[] = [];
    for (const match of matches.slice(0, limit)) {
      if (
        match.project_id !== this.#projectId ||
        !KINDS.has(match.kind as CountedKind) ||
        typeof match.entity_id !== "number" ||
        !Number.isSafeInteger(match.entity_id) ||
        match.entity_id < 1 ||
        typeof match.score !== "number" ||
        !Number.isFinite(match.score)
      ) {
        continue;
      }
      out.push({
        project_id: this.#projectId,
        kind: match.kind as CountedKind,
        id: match.entity_id,
        score: match.score,
      });
    }
    return out;
  }

  async beginEpoch(): Promise<string> {
    const epochId = this.#epochId();
    if (!safeEpoch(epochId)) throw new Error("epoch id is invalid");
    const collection = `${collectionStem(this.#projectId)}_epoch_${epochId}`;
    await this.#port.createEpoch({
      projectId: this.#projectId,
      epochId,
      collection,
    });
    return collection;
  }

  async activateEpoch(collection: string): Promise<void> {
    const prefix = `${collectionStem(this.#projectId)}_epoch_`;
    if (!collection.startsWith(prefix) || !safeEpoch(collection.slice(prefix.length))) {
      throw new Error("epoch collection is invalid");
    }
    await this.#qualifyCollection(collection);
    await this.#port.activate({ projectId: this.#projectId, collection });
  }
}
