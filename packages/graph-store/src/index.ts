/**
 * @foreman/graph-store — GraphStore port and files-only materialisation.
 * Narrow public surface; no database or network dependency.
 */

export {
  MAX_FILE_BYTES,
  MAX_ROOT_FILES,
  MAX_JSON_DEPTH,
  MAX_JSON_NODES,
  MAX_QUERY_RESULTS,
  MAX_TRAVERSAL_STEPS,
  STORE_LOCK_BOUND_MS,
  MAX_LOCK_RETRIES,
  GENERATION_ID_WIDTH,
  GRAPH_STORE_SCHEMA_VERSION,
} from "./bounds.js";

export {
  GRAPH_STORE_FAILURE_BRAND,
  isGraphStoreFailure,
  graphStoreFailure,
  GraphStoreError,
  SchemaNotRegisteredError,
  SchemaValidationError,
  UnexpectedEmptyError,
  UnexpectedNonEmptyError,
  CapabilityUnavailableError,
  VersionReferenceError,
  DocumentNotFoundError,
  LimitExceededError,
  PublishConflictError,
  type GraphStoreFailure,
  type GraphStoreFailureReason,
} from "./failures.js";

export {
  CAP_TIME_TRAVEL,
  CAP_BRANCH_MERGE,
  CAP_CROSS_RUN_QUERY,
  OPTIONAL_CAPABILITIES,
  LINEAGE_QUERIES,
  DOCUMENT_TYPES,
  documentId,
  normaliseVersionRef,
  makeQueryResult,
  runPortQuery,
  type GraphStore,
  type QueryResult,
  type JsonObject,
  type OptionalCapability,
  type LineageQueryName,
  type DocumentType,
  type SchemaRegistration,
} from "./port.js";

export {
  BUSINESS_KEYS,
  ENUMS,
  ENUM_FIELDS,
  EVALUATES_TARGETS,
  LINK_FIELDS,
  TYPE_LINK_FIELDS,
  defaultSchemaPayload,
  computeId,
  validateDocument,
  validateDocumentMap,
  detectsCycle,
  allowedFieldsFor,
  asIdSet,
  asIdSetStrict,
  deepCloneJson,
  deepFreezeJson,
  isolateJson,
  deepEqualJson,
} from "./schema.js";

export {
  queryAttemptsFromRound,
  queryUnevaluatedLeaves,
  queryClaimsContradicting,
  runNamedQuery,
  indexFromDocuments,
} from "./queries.js";

export {
  FilesOnlyGraphStore,
  openFilesOnly,
  openFromEnv,
  openFilesOnlyEffect,
  GraphStoreService,
  liveGraphStoreService,
  type FilesOnlyOptions,
  type GenerationSnapshot,
} from "./files-only.js";

export {
  runSuite,
  formatReport,
  runContractMain,
  filesOnlyFactory,
  stubFactory,
  seedLineageFixture,
  ALL_CASES,
  StubEmptyBackend,
  CASE_CATEGORY,
  failedCategories,
  MIN_INDEPENDENT_STUB_CATEGORIES,
  type StoreFactory,
  type CaseResult,
  type SuiteReport,
} from "./contract-suite.js";

export { runGraphStoreCli, serializeCliFailure, type CliIo } from "./cli.js";
