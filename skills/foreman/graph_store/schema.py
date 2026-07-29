# @description Write-time schema for the GraphStore port (round-1 subset).
"""Write-time document schema used by every backend.

Round 1 freezes the **operation-facing** schema: types, business keys, enums
for LLM-populated fields, and the structural rules the lineage contract needs.
The full human-authored N2 freeze (CQ mapping, MENTIONS demotion measurement,
reviewer stamp) is a later task; this module is enough that both files-only and
a future adapter reject the same non-conforming writes.

Rules enforced here (from the store spec):
* every document has ``@type`` in the known set
* business-key fields present → deterministic id
* LLM-facing enums only (no free confidence floats on Claim)
* ``EVALUATES`` exactly one target (tagged-union fields)
* ``DERIVED_FROM`` / ``REVISES`` / ``SUPERSEDES`` mutually exclusive on a pair
* ``RESOLVED_TO`` functional (at most one target) when present
* no ``MENTIONS`` stored edge / no ``Mention`` document (derived index only)
"""

from __future__ import annotations

from typing import Any, Mapping

from .errors import SchemaValidationError
from .port import DOCUMENT_TYPES, document_id

# Business-key fields per type (order matters for multi-field lexical keys).
BUSINESS_KEYS: dict[str, tuple[str, ...]] = {
    "Task": ("task_key",),
    "Round": ("task_key", "index"),
    "Attempt": ("attempt_key",),
    "AgentRun": ("agent_run_id",),
    "Agent": ("agent_id",),
    "Artifact": ("path", "content_hash"),
    "Spec": ("spec_key",),
    "Commit": ("sha",),
    "Source": ("uri",),
    "Evaluation": ("evaluation_id",),
    "Claim": ("claim_key",),
    "Entity": ("canonical_name", "entity_type"),
    "Metric": ("name", "value"),
    "Measurement": ("measurement_id",),
    "Finding": ("finding_id",),
}

# Closed enums for LLM-populated (or gate-populated) fields.
ENUMS: dict[str, frozenset[str]] = {
    "RunStatus": frozenset(
        {"pending", "running", "succeeded", "failed", "cancelled", "timeout"}
    ),
    "VerdictKind": frozenset(
        {"approved", "rejected", "needs_changes", "inconclusive"}
    ),
    "ClaimStatus": frozenset(
        {"proposed", "supported", "contradicted", "retracted"}
    ),
    "SourceKind": frozenset(
        {"file", "url", "commit", "tool_output", "agent_message", "dataset"}
    ),
    # Discrete confidence — free floats are refused.
    "Confidence": frozenset({"low", "medium", "high", "certain"}),
}

# Enum field → enum name, per document type.
ENUM_FIELDS: dict[str, dict[str, str]] = {
    "AgentRun": {"status": "RunStatus"},
    "Evaluation": {"verdict": "VerdictKind"},
    "Claim": {"status": "ClaimStatus", "confidence": "Confidence"},
    "Source": {"kind": "SourceKind"},
}

# EVALUATES tagged-union: exactly one of these fields must be set on Evaluation.
EVALUATES_TARGETS: tuple[str, ...] = (
    "evaluates_attempt",
    "evaluates_artifact",
    "evaluates_claim",
)

# Lineage edge field names used by queries (link-valued).
LINK_FIELDS: frozenset[str] = frozenset(
    {
        "has_attempt",  # Round → Attempt (replaces PARENT_OF for this edge)
        "subtask_of",  # Task → Task
        "broader_than",  # Entity → Entity
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
        *EVALUATES_TARGETS,
    }
)

# Mutual exclusion on a document: at most one of these may point at the same target.
MUTUALLY_EXCLUSIVE_LINEAGE: tuple[str, ...] = ("derived_from", "revises", "supersedes")


def default_schema_payload() -> dict[str, Any]:
    """Compact schema document the files-only backend registers by default."""
    return {
        "version": 1,
        "classes": sorted(DOCUMENT_TYPES),
        "business_keys": {k: list(v) for k, v in BUSINESS_KEYS.items()},
        "enums": {k: sorted(v) for k, v in ENUMS.items()},
        "enum_fields": ENUM_FIELDS,
        "evaluates_targets": list(EVALUATES_TARGETS),
        "notes": (
            "Round-1 port schema. Full N2 freeze (CQ mapping, MENTIONS "
            "measurement, human freeze stamp) is deferred."
        ),
    }


def compute_id(doc: Mapping[str, Any]) -> str:
    """Compute the deterministic lexical id for a document mapping."""
    doc_type = doc.get("@type")
    if not doc_type or not isinstance(doc_type, str):
        raise SchemaValidationError(
            "document missing @type", field="@type", detail="required string"
        )
    if doc_type not in BUSINESS_KEYS:
        raise SchemaValidationError(
            f"unknown @type {doc_type!r}",
            field="@type",
            detail=f"known types: {sorted(BUSINESS_KEYS)}",
        )
    keys = BUSINESS_KEYS[doc_type]
    parts: list[str] = []
    for k in keys:
        if k not in doc:
            raise SchemaValidationError(
                f"{doc_type} missing business key {k!r}",
                field=k,
                detail=f"required for lexical id",
            )
        parts.append(str(doc[k]))
    return document_id(doc_type, *parts)


def validate_document(doc: Mapping[str, Any], *, existing_ids: set[str] | None = None) -> str:
    """Validate ``doc`` against the write-time schema; return its id.

    Raises ``SchemaValidationError`` on any violation. Does not mutate ``doc``.
    ``existing_ids`` is optional; when provided, link targets that look like
    document ids are checked for existence (two-pass ingest can pass None on
    pass 1 and the set on pass 2).
    """
    if not isinstance(doc, Mapping):
        raise SchemaValidationError("document must be a mapping", field=None)

    doc_type = doc.get("@type")
    if doc_type == "Mention":
        raise SchemaValidationError(
            "Mention documents are forbidden: MENTIONS is a derived index, "
            "not a stored edge or reified document in the store",
            field="@type",
            detail="MENTIONS excluded from store",
        )
    if "mentions" in doc or "MENTIONS" in doc:
        raise SchemaValidationError(
            "MENTIONS must not be stored; it is a derived index",
            field="mentions",
        )

    doc_id = compute_id(doc)

    # Enum fields
    for field_name, enum_name in ENUM_FIELDS.get(str(doc_type), {}).items():
        if field_name not in doc:
            continue
        value = doc[field_name]
        allowed = ENUMS[enum_name]
        if value not in allowed:
            # Special case: free float on confidence
            if field_name == "confidence" and isinstance(value, (int, float)):
                raise SchemaValidationError(
                    f"Claim.confidence must be a Confidence enum value, not a free float "
                    f"(got {value!r})",
                    field="confidence",
                    detail=f"enum Confidence = {sorted(allowed)}",
                )
            raise SchemaValidationError(
                f"{doc_type}.{field_name}={value!r} not in enum {enum_name}",
                field=field_name,
                detail=f"allowed: {sorted(allowed)}",
            )

    # Evaluation: exactly one EVALUATES target
    if doc_type == "Evaluation":
        present = [f for f in EVALUATES_TARGETS if doc.get(f)]
        # Also accept legacy single field "evaluates" only if it is a typed ref
        # with an explicit target class — still counts as one target.
        legacy = doc.get("evaluates")
        if legacy and not present:
            # Require shape {"@type": "Attempt"|"Artifact"|"Claim", "@id": "..."}
            # or a string id starting with one of those types.
            if not _is_single_evaluates_ref(legacy):
                raise SchemaValidationError(
                    "Evaluation.evaluates must name exactly one Attempt, Artifact, or Claim",
                    field="evaluates",
                )
            present = ["evaluates"]
        if len(present) == 0:
            raise SchemaValidationError(
                "Evaluation must declare exactly one EVALUATES target "
                f"(one of {list(EVALUATES_TARGETS)} or a single typed evaluates ref)",
                field="evaluates",
            )
        if len(present) > 1:
            raise SchemaValidationError(
                f"EVALUATES takes exactly one target; got fields {present}",
                field="evaluates",
                detail="exactly one target required",
            )

    # Mutual exclusion of DERIVED_FROM / REVISES / SUPERSEDES on the same target
    targets_by_edge: dict[str, set[str]] = {}
    for edge in MUTUALLY_EXCLUSIVE_LINEAGE:
        raw = doc.get(edge)
        if raw is None:
            continue
        targets_by_edge[edge] = _as_id_set(raw)
    # If any pair of edges share a target, reject.
    edges = list(targets_by_edge)
    for i, e1 in enumerate(edges):
        for e2 in edges[i + 1 :]:
            overlap = targets_by_edge[e1] & targets_by_edge[e2]
            if overlap:
                raise SchemaValidationError(
                    f"{e1} and {e2} are mutually exclusive on a pair; "
                    f"shared target(s): {sorted(overlap)}",
                    field=e1,
                )

    # SUPERSEDES carries timestamp + reason when present
    if doc.get("supersedes") is not None:
        if not doc.get("supersedes_at") and not doc.get("supersedes_timestamp"):
            raise SchemaValidationError(
                "SUPERSEDES requires supersedes_at (timestamp)",
                field="supersedes_at",
            )
        if not doc.get("supersedes_reason"):
            raise SchemaValidationError(
                "SUPERSEDES requires supersedes_reason",
                field="supersedes_reason",
            )

    # RESOLVED_TO functional: at most one target; optional reviewer/provenance
    if "resolved_to" in doc and doc["resolved_to"] is not None:
        rt = doc["resolved_to"]
        if isinstance(rt, (list, tuple, set)) and len(rt) > 1:
            raise SchemaValidationError(
                "RESOLVED_TO is functional: at most one target",
                field="resolved_to",
            )
        if not doc.get("resolved_to_reviewer"):
            raise SchemaValidationError(
                "RESOLVED_TO requires resolved_to_reviewer",
                field="resolved_to_reviewer",
            )
        if not doc.get("resolved_to_provenance") and not doc.get("resolved_to_prov"):
            raise SchemaValidationError(
                "RESOLVED_TO requires resolved_to_provenance",
                field="resolved_to_provenance",
            )

    # Optional link-target existence check
    if existing_ids is not None:
        for lf in LINK_FIELDS:
            if lf not in doc or doc[lf] is None:
                continue
            for target in _as_id_set(doc[lf]):
                if target not in existing_ids and not target.startswith("_pending:"):
                    # Soft: only check if it looks like Type/key
                    if "/" in target and target.split("/", 1)[0] in DOCUMENT_TYPES:
                        raise SchemaValidationError(
                            f"link {lf} → {target!r} has no document",
                            field=lf,
                            detail="register the target document first (two-pass)",
                        )

    return doc_id


def _is_single_evaluates_ref(value: Any) -> bool:
    if isinstance(value, str):
        prefix = value.split("/", 1)[0]
        return prefix in {"Attempt", "Artifact", "Claim"}
    if isinstance(value, Mapping):
        t = value.get("@type") or value.get("type")
        return t in {"Attempt", "Artifact", "Claim"}
    return False


def _as_id_set(raw: Any) -> set[str]:
    if raw is None:
        return set()
    if isinstance(raw, str):
        return {raw}
    if isinstance(raw, Mapping):
        if "@id" in raw:
            return {str(raw["@id"])}
        return set()
    if isinstance(raw, (list, tuple, set)):
        out: set[str] = set()
        for item in raw:
            out |= _as_id_set(item)
        return out
    return {str(raw)}


def detects_cycle(edges: Mapping[str, set[str]], start: str) -> bool:
    """Return True if following ``edges`` from ``start`` finds a cycle involving start."""
    stack = [start]
    seen: set[str] = set()
    while stack:
        node = stack.pop()
        for nxt in edges.get(node, ()):
            if nxt == start:
                return True
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return False
