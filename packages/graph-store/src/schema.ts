/**
 * Write-time document schema for the GraphStore port (round-1 subset).
 * Pure and deterministic — no I/O.
 */

import { SchemaValidationError } from "./failures.js";
import {
  DOCUMENT_TYPES,
  documentId,
  type DocumentType,
  type JsonObject,
} from "./port.js";

/** Business-key fields per type (order matters for multi-field lexical keys). */
export const BUSINESS_KEYS: Readonly<Record<string, readonly string[]>> = {
  Task: ["task_key"],
  Round: ["task_key", "index"],
  Attempt: ["attempt_key"],
  AgentRun: ["agent_run_id"],
  Agent: ["agent_id"],
  Artifact: ["path", "content_hash"],
  Spec: ["spec_key"],
  Commit: ["sha"],
  Source: ["uri"],
  Evaluation: ["evaluation_id"],
  Claim: ["claim_key"],
  Entity: ["canonical_name", "entity_type"],
  Metric: ["name", "value"],
  Measurement: ["measurement_id"],
  Finding: ["finding_id"],
};

/** Closed enums for LLM-populated (or gate-populated) fields. */
export const ENUMS: Readonly<Record<string, ReadonlySet<string>>> = {
  RunStatus: new Set([
    "pending",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "timeout",
  ]),
  VerdictKind: new Set([
    "approved",
    "rejected",
    "needs_changes",
    "inconclusive",
  ]),
  ClaimStatus: new Set(["live", "superseded", "retracted"]),
  SourceKind: new Set([
    "file",
    "url",
    "commit",
    "tool_output",
    "agent_message",
    "dataset",
  ]),
  Confidence: new Set(["low", "medium", "high", "certain"]),
};

/** Enum field → enum name, per document type. */
export const ENUM_FIELDS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  AgentRun: { status: "RunStatus" },
  Evaluation: { verdict: "VerdictKind" },
  Claim: { status: "ClaimStatus", confidence: "Confidence" },
  Source: { kind: "SourceKind" },
};

/** EVALUATES tagged-union: exactly one of these must be set on Evaluation. */
export const EVALUATES_TARGETS = [
  "evaluates_attempt",
  "evaluates_artifact",
  "evaluates_claim",
] as const;

/** Lineage edge field names used by queries (link-valued). */
export const LINK_FIELDS: ReadonlySet<string> = new Set([
  "has_attempt",
  "subtask_of",
  "broader_than",
  "depends_on",
  "derived_from",
  "supersedes",
  "revises",
  "supports",
  "contradicts",
  "resolved_to",
  "about",
  "sourced_from",
  "produced",
  ...EVALUATES_TARGETS,
]);

/**
 * Relation fields closed by document kind. Misplaced relations are rejected.
 * Values must be reference-shaped when present.
 */
export const TYPE_LINK_FIELDS: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  Task: new Set(["subtask_of", "depends_on", "derived_from", "revises", "supersedes"]),
  Round: new Set(["has_attempt"]),
  Attempt: new Set([
    "derived_from",
    "revises",
    "supersedes",
    "depends_on",
    "produced",
  ]),
  AgentRun: new Set(["produced", "sourced_from"]),
  Agent: new Set(),
  Artifact: new Set(["derived_from", "sourced_from", "about"]),
  Spec: new Set(["revises", "supersedes", "derived_from"]),
  Commit: new Set(["sourced_from"]),
  Source: new Set(["about"]),
  Evaluation: new Set([...EVALUATES_TARGETS, "evaluates"]),
  Claim: new Set([
    "supports",
    "contradicts",
    "supersedes",
    "revises",
    "derived_from",
    "about",
    "sourced_from",
    "resolved_to",
  ]),
  Entity: new Set(["broader_than", "resolved_to", "about"]),
  Metric: new Set(),
  Measurement: new Set(["about", "sourced_from"]),
  Finding: new Set([
    "about",
    "sourced_from",
    "supports",
    "contradicts",
  ]),
};

export const MUTUALLY_EXCLUSIVE_LINEAGE = [
  "derived_from",
  "revises",
  "supersedes",
] as const;

/** Closed optional scalar/display fields accepted on any document. */
const COMMON_OPTIONAL = [
  "@id",
  "title",
  "text",
  "lane",
  "round",
  "parent_round",
  "supersedes_at",
  "supersedes_timestamp",
  "supersedes_reason",
  "resolved_to_reviewer",
  "resolved_to_provenance",
  "resolved_to_prov",
] as const;

/**
 * Allowed fields per document type (closed). Unknown fields are rejected.
 */
export function allowedFieldsFor(docType: string): ReadonlySet<string> {
  const keys = BUSINESS_KEYS[docType] ?? [];
  const enumFields = Object.keys(ENUM_FIELDS[docType] ?? {});
  const out = new Set<string>([
    "@type",
    ...keys,
    ...enumFields,
    ...COMMON_OPTIONAL,
  ]);
  for (const lf of TYPE_LINK_FIELDS[docType] ?? []) out.add(lf);
  return out;
}

export function defaultSchemaPayload(): JsonObject {
  return {
    version: 1,
    classes: [...DOCUMENT_TYPES].sort(),
    business_keys: Object.fromEntries(
      Object.entries(BUSINESS_KEYS).map(([k, v]) => [k, [...v]]),
    ),
    enums: Object.fromEntries(
      Object.entries(ENUMS).map(([k, v]) => [k, [...v].sort()]),
    ),
    enum_fields: ENUM_FIELDS,
    evaluates_targets: [...EVALUATES_TARGETS],
    notes:
      "Round-1 port schema. Full N2 freeze (CQ mapping, MENTIONS measurement, human freeze stamp) is deferred.",
  };
}

export function computeId(doc: JsonObject): string {
  const docType = doc["@type"];
  if (!docType || typeof docType !== "string") {
    throw new SchemaValidationError("document missing @type", {
      field: "@type",
      detail: "required string",
    });
  }
  if (!(docType in BUSINESS_KEYS)) {
    throw new SchemaValidationError(`unknown @type ${JSON.stringify(docType)}`, {
      field: "@type",
      detail: `known types: ${Object.keys(BUSINESS_KEYS).sort().join(", ")}`,
    });
  }
  const keys = BUSINESS_KEYS[docType]!;
  const parts: string[] = [];
  for (const k of keys) {
    if (!(k in doc)) {
      throw new SchemaValidationError(
        `${docType} missing business key ${JSON.stringify(k)}`,
        { field: k, detail: "required for lexical id" },
      );
    }
    parts.push(String(doc[k]));
  }
  return documentId(docType, ...parts);
}

/**
 * Deep-clone JSON-compatible values (objects/arrays/scalars).
 * Rejects non-JSON types by coercing via structuredClone for plain data.
 */
export function deepCloneJson<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  return structuredClone(value);
}

/** Deep-freeze a JSON-compatible value in place; returns the same reference. */
export function deepFreezeJson<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeJson(item);
    return Object.freeze(value);
  }
  const obj = value as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    deepFreezeJson(obj[k]);
  }
  return Object.freeze(value);
}

/** Deep-clone then deep-freeze (safe to return to callers). */
export function isolateJson<T>(value: T): T {
  return deepFreezeJson(deepCloneJson(value));
}

/** Structural deep equality for JSON-compatible values. */
export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualJson(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).sort();
  const bk = Object.keys(bo).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    if (!deepEqualJson(ao[ak[i]!], bo[bk[i]!])) return false;
  }
  return true;
}

function isDocumentIdString(value: string): boolean {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return false;
  const prefix = value.slice(0, slash);
  return DOCUMENT_TYPES.has(prefix as DocumentType);
}

/**
 * True when `value` is a single reference (id string or {@id} object).
 */
export function isSingleReference(value: unknown): boolean {
  if (typeof value === "string") {
    return isDocumentIdString(value) || value.startsWith("_pending:");
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const m = value as JsonObject;
    if (typeof m["@id"] === "string" && m["@id"]) {
      return (
        isDocumentIdString(m["@id"]) ||
        String(m["@id"]).startsWith("_pending:")
      );
    }
  }
  return false;
}

function isSingleEvaluatesRef(value: unknown): boolean {
  if (typeof value === "string") {
    const prefix = value.split("/", 1)[0];
    return (
      prefix === "Attempt" || prefix === "Artifact" || prefix === "Claim"
    );
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const m = value as JsonObject;
    const t = m["@type"] ?? m["type"];
    if (!(t === "Attempt" || t === "Artifact" || t === "Claim")) return false;
    if ("@id" in m && typeof m["@id"] === "string" && m["@id"]) return true;
    // typed object without @id still names a class but is not a store ref
    return false;
  }
  return false;
}

/**
 * Extract id strings from a reference value. Throws if shape is invalid.
 */
export function asIdSetStrict(raw: unknown, field: string): Set<string> {
  if (raw == null) return new Set();
  if (typeof raw === "string") {
    if (!isSingleReference(raw)) {
      throw new SchemaValidationError(
        `link ${field} must be a document id reference`,
        { field, detail: "expected Type/key string" },
      );
    }
    return new Set([raw]);
  }
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const m = raw as JsonObject;
    if (typeof m["@id"] === "string" && m["@id"]) {
      if (!isSingleReference(m)) {
        throw new SchemaValidationError(
          `link ${field} object must carry a document @id`,
          { field },
        );
      }
      return new Set([String(m["@id"])]);
    }
    throw new SchemaValidationError(
      `link ${field} object must carry a document @id`,
      { field },
    );
  }
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      throw new SchemaValidationError(
        `link ${field} must not be an empty array`,
        { field },
      );
    }
    const out = new Set<string>();
    for (const item of raw) {
      for (const id of asIdSetStrict(item, field)) out.add(id);
    }
    return out;
  }
  throw new SchemaValidationError(
    `link ${field} has non-reference value ${JSON.stringify(raw)}`,
    { field, detail: "expected string id, {@id}, or array of those" },
  );
}

/** Lenient id extraction for pure query traversal (does not throw). */
export function asIdSet(raw: unknown): Set<string> {
  if (raw == null) return new Set();
  if (typeof raw === "string") return new Set([raw]);
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const m = raw as JsonObject;
    if ("@id" in m) return new Set([String(m["@id"])]);
    return new Set();
  }
  if (Array.isArray(raw)) {
    const out = new Set<string>();
    for (const item of raw) {
      for (const id of asIdSet(item)) out.add(id);
    }
    return out;
  }
  return new Set();
}

/**
 * Return true if following `edges` from `start` finds a cycle involving start.
 * Bounded walk; oversized graphs report as cycle for fail-closed safety.
 */
export function detectsCycle(
  edges: ReadonlyMap<string, ReadonlySet<string>>,
  start: string,
  maxSteps = 10_000,
): boolean {
  const stack = [start];
  const seen = new Set<string>();
  let steps = 0;
  while (stack.length > 0) {
    const node = stack.pop()!;
    const nxts = edges.get(node);
    if (!nxts) continue;
    for (const nxt of nxts) {
      steps += 1;
      if (steps > maxSteps) return true;
      if (nxt === start) return true;
      if (!seen.has(nxt)) {
        seen.add(nxt);
        stack.push(nxt);
      }
    }
  }
  return false;
}

function fieldIsPresent(body: JsonObject, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, field) && body[field] != null;
}

/**
 * Validate `doc` against the write-time schema; return its id.
 * Does not mutate `doc`. Throws SchemaValidationError on any violation.
 */
export function validateDocument(
  doc: unknown,
  opts?: { readonly existingIds?: ReadonlySet<string> | null },
): string {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new SchemaValidationError("document must be a mapping");
  }
  const body = doc as JsonObject;
  const docType = body["@type"];

  if (docType === "Mention") {
    throw new SchemaValidationError(
      "Mention documents are forbidden: MENTIONS is a derived index, not a stored edge or reified document in the store",
      { field: "@type", detail: "MENTIONS excluded from store" },
    );
  }
  if ("mentions" in body || "MENTIONS" in body) {
    throw new SchemaValidationError(
      "MENTIONS must not be stored; it is a derived index",
      { field: "mentions" },
    );
  }

  if (typeof docType !== "string" || !(docType in BUSINESS_KEYS)) {
    throw new SchemaValidationError(
      `unknown @type ${JSON.stringify(docType)}`,
      {
        field: "@type",
        detail: `known types: ${Object.keys(BUSINESS_KEYS).sort().join(", ")}`,
      },
    );
  }

  // Closed field set by kind
  const allowed = allowedFieldsFor(docType);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new SchemaValidationError(
        `unknown field ${JSON.stringify(key)} on ${docType}`,
        { field: key, detail: "closed schema rejects undeclared fields" },
      );
    }
  }

  const docId = computeId(body);

  // Enum fields
  const enumMap = ENUM_FIELDS[docType] ?? {};
  for (const [fieldName, enumName] of Object.entries(enumMap)) {
    if (!(fieldName in body)) continue;
    const value = body[fieldName];
    const allowedEnum = ENUMS[enumName]!;
    if (!allowedEnum.has(value as string)) {
      if (
        fieldName === "confidence" &&
        (typeof value === "number" || typeof value === "bigint")
      ) {
        throw new SchemaValidationError(
          `Claim.confidence must be a Confidence enum value, not a free float (got ${JSON.stringify(value)})`,
          {
            field: "confidence",
            detail: `enum Confidence = ${[...allowedEnum].sort().join(", ")}`,
          },
        );
      }
      throw new SchemaValidationError(
        `${docType}.${fieldName}=${JSON.stringify(value)} not in enum ${enumName}`,
        {
          field: fieldName,
          detail: `allowed: ${[...allowedEnum].sort().join(", ")}`,
        },
      );
    }
  }

  // Evaluation: exactly one EVALUATES target with exactly one reference
  if (docType === "Evaluation") {
    const presentTagged = EVALUATES_TARGETS.filter((f) => fieldIsPresent(body, f));
    const legacyPresent = fieldIsPresent(body, "evaluates");
    let activeFields: string[] = [...presentTagged];
    if (legacyPresent && presentTagged.length === 0) {
      const legacy = body["evaluates"];
      if (!isSingleEvaluatesRef(legacy)) {
        throw new SchemaValidationError(
          "Evaluation.evaluates must name exactly one Attempt, Artifact, or Claim",
          { field: "evaluates" },
        );
      }
      activeFields = ["evaluates"];
    }
    if (activeFields.length === 0) {
      throw new SchemaValidationError(
        `Evaluation must declare exactly one EVALUATES target (one of ${EVALUATES_TARGETS.join(", ")} or a single typed evaluates ref)`,
        { field: "evaluates" },
      );
    }
    if (activeFields.length > 1) {
      throw new SchemaValidationError(
        `EVALUATES takes exactly one target; got fields ${activeFields.join(", ")}`,
        { field: "evaluates", detail: "exactly one target required" },
      );
    }
    // Cardinality: each active field must resolve to exactly one reference
    for (const f of activeFields) {
      const val = body[f];
      if (Array.isArray(val)) {
        if (val.length !== 1) {
          throw new SchemaValidationError(
            `EVALUATES field ${f} must name exactly one target`,
            { field: f, detail: "exactly one target required" },
          );
        }
      }
      const ids = asIdSetStrict(val, f);
      if (ids.size !== 1) {
        throw new SchemaValidationError(
          `EVALUATES field ${f} must name exactly one target`,
          { field: f, detail: "exactly one target required" },
        );
      }
    }
  }

  // Strict reference shapes for every declared link field on this kind
  const kindLinks = TYPE_LINK_FIELDS[docType] ?? new Set<string>();
  for (const lf of kindLinks) {
    if (!fieldIsPresent(body, lf)) continue;
    if (docType === "Evaluation" && (EVALUATES_TARGETS as readonly string[]).includes(lf)) {
      // already validated above
      continue;
    }
    if (docType === "Evaluation" && lf === "evaluates") {
      continue;
    }
    if (lf === "resolved_to") {
      // handled below with functional rules
      continue;
    }
    asIdSetStrict(body[lf], lf);
  }

  // Mutual exclusion of DERIVED_FROM / REVISES / SUPERSEDES on the same target
  const targetsByEdge = new Map<string, Set<string>>();
  for (const edge of MUTUALLY_EXCLUSIVE_LINEAGE) {
    if (!fieldIsPresent(body, edge)) continue;
    targetsByEdge.set(edge, asIdSetStrict(body[edge], edge));
  }
  const edges = [...targetsByEdge.keys()];
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const e1 = edges[i]!;
      const e2 = edges[j]!;
      const overlap = [...targetsByEdge.get(e1)!].filter((t) =>
        targetsByEdge.get(e2)!.has(t),
      );
      if (overlap.length > 0) {
        throw new SchemaValidationError(
          `${e1} and ${e2} are mutually exclusive on a pair; shared target(s): ${overlap.sort().join(", ")}`,
          { field: e1 },
        );
      }
    }
  }

  // SUPERSEDES carries timestamp + reason when present
  if (fieldIsPresent(body, "supersedes")) {
    if (!body["supersedes_at"] && !body["supersedes_timestamp"]) {
      throw new SchemaValidationError(
        "SUPERSEDES requires supersedes_at (timestamp)",
        { field: "supersedes_at" },
      );
    }
    if (!body["supersedes_reason"]) {
      throw new SchemaValidationError("SUPERSEDES requires supersedes_reason", {
        field: "supersedes_reason",
      });
    }
  }

  // RESOLVED_TO functional: exactly one reference target; reviewer + provenance
  if (fieldIsPresent(body, "resolved_to")) {
    const rt = body["resolved_to"];
    if (Array.isArray(rt)) {
      if (rt.length === 0) {
        throw new SchemaValidationError(
          "RESOLVED_TO must name exactly one target",
          { field: "resolved_to" },
        );
      }
      if (rt.length > 1) {
        throw new SchemaValidationError(
          "RESOLVED_TO is functional: at most one target",
          { field: "resolved_to" },
        );
      }
    }
    const ids = asIdSetStrict(rt, "resolved_to");
    if (ids.size !== 1) {
      throw new SchemaValidationError(
        "RESOLVED_TO must name exactly one target",
        { field: "resolved_to" },
      );
    }
    if (!body["resolved_to_reviewer"]) {
      throw new SchemaValidationError(
        "RESOLVED_TO requires resolved_to_reviewer",
        { field: "resolved_to_reviewer" },
      );
    }
    if (!body["resolved_to_provenance"] && !body["resolved_to_prov"]) {
      throw new SchemaValidationError(
        "RESOLVED_TO requires resolved_to_provenance",
        { field: "resolved_to_provenance" },
      );
    }
  }

  // Optional link-target existence check against complete candidate id set
  const existingIds = opts?.existingIds;
  if (existingIds != null) {
    for (const lf of kindLinks) {
      if (!fieldIsPresent(body, lf)) continue;
      for (const target of asIdSetStrict(body[lf], lf)) {
        if (!existingIds.has(target) && !target.startsWith("_pending:")) {
          if (
            target.includes("/") &&
            DOCUMENT_TYPES.has(target.split("/", 1)[0] as DocumentType)
          ) {
            throw new SchemaValidationError(
              `link ${lf} → ${JSON.stringify(target)} has no document`,
              {
                field: lf,
                detail: "register the target document first (two-pass)",
              },
            );
          }
        }
      }
    }
  }

  return docId;
}

/**
 * Validate a complete document map (snapshot / graph-wide).
 * Ensures every document is schema-valid, map key equals @id, and
 * functional/acyclic graph constraints hold.
 */
export function validateDocumentMap(
  documents: Readonly<Record<string, JsonObject>>,
  opts?: { readonly maxTraversalSteps?: number },
): void {
  const maxSteps = opts?.maxTraversalSteps ?? 10_000;
  // Schema shape/cardinality per document. Link-target existence is optional
  // here so two-pass ingest (Round before Attempt) remains valid; callers that
  // need a closed candidate set pass existingIds to validateDocument directly.
  for (const [key, doc] of Object.entries(documents)) {
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
      throw new SchemaValidationError(
        `document map entry ${JSON.stringify(key)} is not an object`,
      );
    }
    const docId = validateDocument(doc);
    if (docId !== key) {
      throw new SchemaValidationError(
        `document map key ${JSON.stringify(key)} does not equal computed @id ${JSON.stringify(docId)}`,
        { field: "@id" },
      );
    }
    if (doc["@id"] != null && String(doc["@id"]) !== key) {
      throw new SchemaValidationError(
        `document @id ${JSON.stringify(doc["@id"])} does not equal map key ${JSON.stringify(key)}`,
        { field: "@id" },
      );
    }
  }

  // Graph-wide functional RESOLVED_TO and cycles
  for (const edgeField of [
    "depends_on",
    "subtask_of",
    "broader_than",
    "resolved_to",
  ] as const) {
    const edges = new Map<string, Set<string>>();
    for (const [id, doc] of Object.entries(documents)) {
      if (!fieldIsPresent(doc, edgeField)) continue;
      const targets = asIdSetStrict(doc[edgeField], edgeField);
      if (edgeField === "resolved_to" && targets.size > 1) {
        throw new SchemaValidationError(
          `RESOLVED_TO is functional: ${id} has multiple targets`,
          { field: "resolved_to" },
        );
      }
      edges.set(id, targets);
      if (detectsCycle(edges, id, maxSteps)) {
        throw new SchemaValidationError(
          `${edgeField} cycle involving ${id}`,
          { field: edgeField, detail: "graph-wide acyclicity" },
        );
      }
    }
    // full pass for cycles from every node
    for (const id of edges.keys()) {
      if (detectsCycle(edges, id, maxSteps)) {
        throw new SchemaValidationError(
          `${edgeField} cycle involving ${id}`,
          { field: edgeField, detail: "graph-wide acyclicity" },
        );
      }
    }
  }
}

export function isDocumentType(v: string): v is DocumentType {
  return DOCUMENT_TYPES.has(v as DocumentType);
}
