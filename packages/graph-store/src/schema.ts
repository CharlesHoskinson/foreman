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
  "evaluates",
] as const;

/**
 * Allowed fields per document type (closed). Unknown fields are rejected.
 */
export function allowedFieldsFor(docType: string): ReadonlySet<string> {
  const keys = BUSINESS_KEYS[docType] ?? [];
  const enumFields = Object.keys(ENUM_FIELDS[docType] ?? {});
  const out = new Set<string>(["@type", ...keys, ...enumFields, ...COMMON_OPTIONAL]);
  for (const lf of LINK_FIELDS) out.add(lf);
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
    return t === "Attempt" || t === "Artifact" || t === "Claim";
  }
  return false;
}

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
  return new Set([String(raw)]);
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

  // Closed field set
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

  // Evaluation: exactly one EVALUATES target
  if (docType === "Evaluation") {
    let present = EVALUATES_TARGETS.filter((f) => body[f]);
    const legacy = body["evaluates"];
    if (legacy && present.length === 0) {
      if (!isSingleEvaluatesRef(legacy)) {
        throw new SchemaValidationError(
          "Evaluation.evaluates must name exactly one Attempt, Artifact, or Claim",
          { field: "evaluates" },
        );
      }
      present = ["evaluates" as (typeof EVALUATES_TARGETS)[number]];
    }
    if (present.length === 0) {
      throw new SchemaValidationError(
        `Evaluation must declare exactly one EVALUATES target (one of ${EVALUATES_TARGETS.join(", ")} or a single typed evaluates ref)`,
        { field: "evaluates" },
      );
    }
    if (present.length > 1) {
      throw new SchemaValidationError(
        `EVALUATES takes exactly one target; got fields ${present.join(", ")}`,
        { field: "evaluates", detail: "exactly one target required" },
      );
    }
  }

  // Mutual exclusion of DERIVED_FROM / REVISES / SUPERSEDES on the same target
  const targetsByEdge = new Map<string, Set<string>>();
  for (const edge of MUTUALLY_EXCLUSIVE_LINEAGE) {
    const raw = body[edge];
    if (raw == null) continue;
    targetsByEdge.set(edge, asIdSet(raw));
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
  if (body["supersedes"] != null) {
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

  // RESOLVED_TO functional: at most one target; optional reviewer/provenance
  if ("resolved_to" in body && body["resolved_to"] != null) {
    const rt = body["resolved_to"];
    if (Array.isArray(rt) && rt.length > 1) {
      throw new SchemaValidationError(
        "RESOLVED_TO is functional: at most one target",
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

  // Optional link-target existence check
  const existingIds = opts?.existingIds;
  if (existingIds != null) {
    for (const lf of LINK_FIELDS) {
      if (!(lf in body) || body[lf] == null) continue;
      for (const target of asIdSet(body[lf])) {
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

export function isDocumentType(v: string): v is DocumentType {
  return DOCUMENT_TYPES.has(v as DocumentType);
}
