/**
 * @foreman/session-store — the two storage ports for session state.
 *
 *   SessionStore  system of record.   Synchronous, transactional, exact.
 *   MemoryIndex   derived projection. Asynchronous, semantic, optional.
 *
 * The canonical entity model lives in entities.ts and is declared, not derived
 * from any backend. See port.ts for the governing invariant.
 */

export {
  SESSION_MODEL_VERSION,
  ENTITY_KINDS,
  ENTITY_ORDER,
  ENTITY_SPECS,
  COUNTED_KINDS,
  OBLIGATION_STATUSES,
  SUPERSESSION_FIELD_NAMES,
  SESSION_SPEC,
  FACT_SPEC,
  MEASUREMENT_SPEC,
  OBLIGATION_SPEC,
  countRows,
  emptySnapshot,
  initialNextIds,
  isCountedKind,
  rowsOfKind,
  snapshotsEqual,
  specFor,
  type CountedKind,
  type EntityKind,
  type EntitySpec,
  type FactRow,
  type FieldSpec,
  type FieldType,
  type MeasurementRow,
  type NextIds,
  type ObligationRow,
  type ObligationStatus,
  type SessionRow,
  type SessionSnapshot,
} from "./entities.js";

export {
  SESSION_STORE_FAILURE_BRAND,
  SessionStoreError,
  isSessionStoreFailure,
  raise,
  reasonOf,
  sessionStoreFailure,
  type SessionStoreFailure,
  type SessionStoreFailureReason,
} from "./failures.js";

export {
  assertIntegrity,
  findViolations,
  formatViolations,
  type Violation,
} from "./integrity.js";

export {
  additiveImportProjectionUpserts,
  planAdditiveRemapImport,
  resolveIdCollisionPolicy,
  snapshotIsOccupied,
  type CountedIdMaps,
  type ImportRemapPlan,
  type RemappedDonorRows,
} from "./import-remap.js";

export {
  PROJECTABLE_FIELDS,
  type EntityRef,
  type IdCollisionPolicy,
  type ImportOptions,
  type MemoryIndex,
  type NewFact,
  type NewMeasurement,
  type NewObligation,
  type OutboxEntry,
  type ProjectionMutation,
  type ProjectionRecord,
  type SessionStore,
  type SupersedeResult,
} from "./port.js";

export {
  buildProjection,
  liveProjectionMap,
  projectableText,
  projectionKey,
  retractRecord,
  upsertRecord,
} from "./projection.js";

export {
  drainOutbox,
  outboxDrainFailure,
  type DrainOptions,
  type DrainResult,
  type OutboxDrainFailure,
  type OutboxDrainFailureReason,
} from "./outbox.js";

export {
  SIDECAR_FORMAT,
  SIDECAR_FORMAT_VERSION,
  UPGRADES,
  applyVersionPolicy,
  decodeSnapshot,
  emptySidecar,
  encodeSnapshot,
  type Upgrade,
} from "./sidecar.js";

export { decodeSnapshotV1, V1_FORMAT_VERSION } from "./sidecar-v1.js";

export {
  HangingMemoryIndex,
  NullMemoryIndex,
  PoisonMemoryIndex,
  ThrowingMemoryIndex,
  faultInjectionIndexes,
} from "./memory-index.js";

export {
  SqliteSessionStore,
  openMemoryStore,
  type SqliteStoreOptions,
} from "./sqlite-store.js";

export {
  FilesOnlySessionStore,
  openFilesOnlyStore,
  type FilesOnlyOptions,
} from "./files-only.js";

export {
  openSessionStore,
  openSqliteSessionStore,
  type OpenSessionStoreOptions,
  type OpenSqliteStoreOptions,
  type SessionStoreOpenAccess,
  type SessionStoreSelection,
} from "./open.js";

export {
  classifySqliteStore,
  dumpLegacySqliteAsV1,
  sqliteStoreIsEmpty,
  type DumpLegacySqliteAsV1Result,
  type SqliteStoreShape,
} from "./sqlite-migration.js";

export {
  rebuildSqliteFromSidecar,
  type SqliteRebuildOptions,
  type SqliteRebuildResult,
} from "./sqlite-rebuild.js";

export {
  ALL_CASES,
  CASES,
  HOSTILE_CASES,
  MIN_INDEPENDENT_STUB_CATEGORIES,
  STORE_CASES,
  StubEmptyBackend,
  categoryOf,
  failedCategories,
  formatReport,
  runSuite,
  seedFixture,
  stubFactory,
  type CaseResult,
  type StoreFactory,
  type SuiteReport,
} from "./contract-suite.js";
