import { mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { isProjectIdV1 } from "@foreman/session-store";

import type {
  ProjectionLease,
  ProjectionLeasePort,
} from "./projection-epoch.js";

const DEFAULT_TTL_MS = 30_000;
const MIN_TTL_MS = 100;
const MAX_TTL_MS = 3_600_000;
const IDENTIFIER = /^[^\u0000-\u001f\u007f]{1,128}$/u;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projection_leases (
  project_id    TEXT PRIMARY KEY,
  fencing_token INTEGER NOT NULL,
  owner_id      TEXT,
  expires_at_ms INTEGER NOT NULL
);
`;

type LeaseRow = {
  readonly fencing_token: number;
  readonly owner_id: string | null;
  readonly expires_at_ms: number;
};

export type SqliteProjectionLeasePortOptions = {
  readonly databasePath: string;
  readonly ownerId: string;
  readonly ttlMs?: number;
  readonly now?: () => number;
};

function requireNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("projection lease clock is invalid");
  }
  return value;
}

/** Durable, single-host projection lease with never-reused fencing tokens. */
export class SqliteProjectionLeasePort implements ProjectionLeasePort {
  readonly #db: DatabaseSync;
  readonly #ownerId: string;
  readonly #ttlMs: number;
  readonly #now: () => number;
  #closed = false;

  constructor(options: SqliteProjectionLeasePortOptions) {
    if (!isAbsolute(options.databasePath)) {
      throw new Error("projection lease database path must be absolute");
    }
    if (!IDENTIFIER.test(options.ownerId)) {
      throw new Error("projection lease owner is invalid");
    }
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    if (
      !Number.isSafeInteger(ttlMs) ||
      ttlMs < MIN_TTL_MS ||
      ttlMs > MAX_TTL_MS
    ) {
      throw new Error("projection lease TTL is invalid");
    }
    mkdirSync(dirname(options.databasePath), { recursive: true });
    this.#db = new DatabaseSync(options.databasePath);
    this.#db.exec("PRAGMA busy_timeout = 5000");
    this.#db.exec(SCHEMA);
    this.#ownerId = options.ownerId;
    this.#ttlMs = ttlMs;
    this.#now = options.now ?? Date.now;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("projection lease database is closed");
  }

  #transaction<T>(operation: () => T): T {
    this.#assertOpen();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.#db.exec("COMMIT");
      return value;
    } catch (error) {
      try {
        this.#db.exec("ROLLBACK");
      } catch {
        // Preserve the operation failure; SQLite already ended the transaction.
      }
      throw error;
    }
  }

  #renew(projectId: string, fencingToken: number): boolean {
    return this.#transaction(() => {
      const now = requireNow(this.#now);
      const expiresAt = now + this.#ttlMs;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new Error("projection lease expiry overflow");
      }
      const result = this.#db
        .prepare(
          `UPDATE projection_leases
             SET expires_at_ms = ?
           WHERE project_id = ?
             AND fencing_token = ?
             AND owner_id = ?
             AND expires_at_ms > ?`,
        )
        .run(expiresAt, projectId, fencingToken, this.#ownerId, now);
      return result.changes === 1;
    });
  }

  #release(projectId: string, fencingToken: number): void {
    this.#transaction(() => {
      this.#db
        .prepare(
          `UPDATE projection_leases
             SET owner_id = NULL, expires_at_ms = 0
           WHERE project_id = ? AND fencing_token = ? AND owner_id = ?`,
        )
        .run(projectId, fencingToken, this.#ownerId);
    });
  }

  async acquire(projectId: string): Promise<ProjectionLease> {
    if (!isProjectIdV1(projectId)) {
      throw new Error("projection lease project is invalid");
    }
    const fencingToken = this.#transaction(() => {
      const now = requireNow(this.#now);
      const current = this.#db
        .prepare(
          `SELECT fencing_token, owner_id, expires_at_ms
             FROM projection_leases WHERE project_id = ?`,
        )
        .get(projectId) as LeaseRow | undefined;
      if (
        current !== undefined &&
        current.owner_id !== null &&
        current.expires_at_ms > now
      ) {
        throw new Error("projection lease is already held");
      }
      const next = (current?.fencing_token ?? 0) + 1;
      const expiresAt = now + this.#ttlMs;
      if (
        !Number.isSafeInteger(next) ||
        next < 1 ||
        !Number.isSafeInteger(expiresAt)
      ) {
        throw new Error("projection lease counter overflow");
      }
      this.#db
        .prepare(
          `INSERT INTO projection_leases
             (project_id, fencing_token, owner_id, expires_at_ms)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(project_id) DO UPDATE SET
             fencing_token = excluded.fencing_token,
             owner_id = excluded.owner_id,
             expires_at_ms = excluded.expires_at_ms`,
        )
        .run(projectId, next, this.#ownerId, expiresAt);
      return next;
    });
    return {
      fencingToken,
      isCurrent: async () => this.#renew(projectId, fencingToken),
      release: async () => this.#release(projectId, fencingToken),
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#db.close();
    this.#closed = true;
  }
}
