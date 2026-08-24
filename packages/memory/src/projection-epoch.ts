import type {
  ProjectionLease,
  ProjectionLeasePort,
  ProjectionRecord,
} from "@foreman/session-store";

import { QdrantMemoryIndex } from "./qdrant-memory-index.js";

export type { ProjectionLease, ProjectionLeasePort } from "@foreman/session-store";

export type ProjectionCatchUpBatchV1 = {
  readonly records: readonly ProjectionRecord[];
  readonly cursor: string;
  readonly caughtUp: boolean;
};

export interface ProjectionEpochSource {
  snapshot(): readonly ProjectionRecord[];
  catchUp(cursor: string | null): Promise<ProjectionCatchUpBatchV1>;
}

export type ProjectionEpochCoordinatorOptions = {
  readonly projectId: string;
  readonly index: QdrantMemoryIndex;
  readonly lease: ProjectionLeasePort;
  readonly source: ProjectionEpochSource;
  readonly maxCatchUpBatches?: number;
};

export class ProjectionEpochCoordinator {
  readonly #projectId: string;
  readonly #index: QdrantMemoryIndex;
  readonly #leasePort: ProjectionLeasePort;
  readonly #source: ProjectionEpochSource;
  readonly #maxCatchUpBatches: number;

  constructor(options: ProjectionEpochCoordinatorOptions) {
    const max = options.maxCatchUpBatches ?? 1000;
    if (!Number.isSafeInteger(max) || max < 1 || max > 1000) {
      throw new Error("invalid catch-up batch bound");
    }
    this.#projectId = options.projectId;
    this.#index = options.index;
    this.#leasePort = options.lease;
    this.#source = options.source;
    this.#maxCatchUpBatches = max;
  }

  async #requireCurrent(lease: ProjectionLease): Promise<void> {
    if (!(await lease.isCurrent())) {
      throw new Error("projection lease was lost");
    }
  }

  async rebuild(): Promise<string> {
    const lease = await this.#leasePort.acquire(this.#projectId);
    if (
      !Number.isSafeInteger(lease.fencingToken) ||
      lease.fencingToken < 1
    ) {
      throw new Error("projection lease token is invalid");
    }
    try {
      await this.#requireCurrent(lease);
      const collection = await this.#index.beginEpoch();
      await this.#requireCurrent(lease);
      await this.#index.projectEpoch(collection, this.#source.snapshot());

      let cursor: string | null = null;
      for (let batchNumber = 0; batchNumber < this.#maxCatchUpBatches; batchNumber += 1) {
        await this.#requireCurrent(lease);
        const batch = await this.#source.catchUp(cursor);
        if (batch.cursor.length === 0 || (cursor !== null && batch.cursor === cursor)) {
          throw new Error("projection catch-up cursor did not advance");
        }
        if (batch.records.length > 0) {
          // The active collection stays current while the candidate catches up.
          await this.#index.project(batch.records);
          await this.#requireCurrent(lease);
          await this.#index.projectEpoch(collection, batch.records);
        }
        cursor = batch.cursor;
        if (batch.caughtUp) {
          await this.#requireCurrent(lease);
          await this.#index.activateEpoch(collection);
          return collection;
        }
      }
      throw new Error("projection catch-up bound exceeded");
    } finally {
      await lease.release();
    }
  }
}
