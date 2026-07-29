# @description GraphStore port: operation set and contracts every backend must satisfy.
"""GraphStore port — the only surface Foreman uses for persistent graph store I/O.

Module path
-----------
``skills/foreman/graph_store/`` (import as ``graph_store`` when the package
parent is on ``PYTHONPATH``, or via ``python -m`` from this directory's parent).

Architectural rule (load-bearing)
---------------------------------
TerminusDB is a regenerable materialisation behind this port with a files-only
fallback — never the system of record. GP-1 through GP-5 carry **no** store
dependency: they keep reading ``graph.json``, ``worklog.jsonl``, and run-dir
JSON directly. This port covers **persistent, cross-run, versioned query
capability only** (RECONCILE R7). Callers of the port are future store
consumers (census, cross-run analytics), not the merge gate or context builder.

Operation set (required of every backend)
-----------------------------------------
1. ``register_schema``     — write-time schema registration (before first write)
2. ``upsert_document``     — create-or-replace by deterministic lexical id
3. ``get_document``        — typed lookup by ``@type`` + business key fields
4. ``get_document_by_id``  — lookup by full document id (``Type/key`` form)
5. ``query``               — named lineage queries with expected-emptiness
6. ``capabilities``        — report optional capabilities present on this backend
7. ``has_capability``      — predicate form of (6)

Optional capabilities (queried before use; degrade, do not raise)
-----------------------------------------------------------------
* ``time_travel``      — query / diff against a prior store state
* ``branch_merge``     — graph branch and merge
* ``cross_run_query``  — efficient ergonomics across many historical runs

Files-only reports all three as **unavailable**. A future TerminusDB adapter
may report any subset as available. Store-specific concepts (branches, commits,
data-version tokens) MUST NOT appear as **required** arguments on the port.

Expected-emptiness contract
---------------------------
Every ``query`` call takes ``expect_empty: bool``.
* ``expect_empty=False`` and zero rows → ``UnexpectedEmptyError`` (never return [])
* ``expect_empty=True``  and one+ rows → ``UnexpectedNonEmptyError``
* ``expect_empty=True``  and zero rows → success, empty ``QueryResult`` marked
  as an expected true negative

Lineage query names (required)
------------------------------
* ``attempts_from_round``     — all Attempt docs transitively under a Round
* ``unevaluated_leaves``      — Attempt docs with no child via DERIVED_FROM and
  no Evaluation targeting them
* ``claims_contradicting``    — Claim docs that CONTRADICT the given claim,
  either direction

Version references (when a backend offers time_travel)
------------------------------------------------------
Accepted: bare branch name (e.g. ``main``), or ``commit:<id>``.
Rejected: response-header prefix form ``branch:<id>`` → ``VersionReferenceError``.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

from .errors import (
    CapabilityUnavailableError,
    UnexpectedEmptyError,
    UnexpectedNonEmptyError,
    VersionReferenceError,
)

# ---------------------------------------------------------------------------
# Optional capability names — the closed set
# ---------------------------------------------------------------------------

CAP_TIME_TRAVEL = "time_travel"
CAP_BRANCH_MERGE = "branch_merge"
CAP_CROSS_RUN_QUERY = "cross_run_query"

OPTIONAL_CAPABILITIES: frozenset[str] = frozenset(
    {CAP_TIME_TRAVEL, CAP_BRANCH_MERGE, CAP_CROSS_RUN_QUERY}
)

# Closed set of required lineage query names.
LINEAGE_QUERIES: frozenset[str] = frozenset(
    {
        "attempts_from_round",
        "unevaluated_leaves",
        "claims_contradicting",
    }
)

# Document types the round-1 port validates. Full N2 freeze is a later task;
# these are the types the lineage contract and write-time checks exercise.
DOCUMENT_TYPES: frozenset[str] = frozenset(
    {
        "Task",
        "Round",
        "Attempt",
        "AgentRun",
        "Agent",
        "Artifact",
        "Spec",
        "Commit",
        "Source",
        "Evaluation",
        "Claim",
        "Entity",
        "Metric",
        "Measurement",
        "Finding",
    }
)


@dataclass(frozen=True)
class QueryResult:
    """Result of a port query.

    ``rows`` is a list of document-id strings (or small dicts when a query
    returns more than an id). ``expected_empty`` records the caller's
    declaration so consumers can distinguish a true negative from a bug.
    ``capability_degraded`` lists optional capabilities the caller wanted but
    the backend lacks — filled by helpers that soft-degrade rather than raise.
    """

    rows: tuple[Any, ...]
    query_name: str
    expected_empty: bool
    capability_degraded: tuple[str, ...] = ()

    @property
    def is_empty(self) -> bool:
        return len(self.rows) == 0

    def __len__(self) -> int:
        return len(self.rows)


@dataclass
class SchemaRegistration:
    """Payload accepted by ``register_schema``.

    Round 1 accepts either the TerminusDB-style list-of-class-dicts used in R8,
    or a compact dict ``{"classes": [...], "enums": {...}}``. Implementations
    normalise to an internal form; the port does not require store-specific
    context objects.
    """

    payload: Any
    author: str = "foreman"
    message: str = "register schema"


def document_id(doc_type: str, *key_parts: str) -> str:
    """Build a deterministic lexical document id: ``Type/part1+part2+...``."""
    if not doc_type:
        raise ValueError("doc_type is required")
    if not key_parts or any(p is None or p == "" for p in key_parts):
        raise ValueError("key_parts must be non-empty strings")
    return f"{doc_type}/{'+'.join(str(p) for p in key_parts)}"


def normalise_version_ref(ref: str) -> str:
    """Normalise a version reference; reject the silent-empty prefix form.

    Accepted:
      * bare branch name (e.g. ``main``, ``lane-b``)
      * ``commit:<id>``
    Rejected:
      * ``branch:<id>``  — TerminusDB response-header form; returns [] silently
      * empty / whitespace
      * full path form ``admin/.../branch/...`` (errors loudly upstream; we
        reject it here for a uniform port error)
    """
    if ref is None or not str(ref).strip():
        raise VersionReferenceError(str(ref), "version reference must be non-empty")
    s = str(ref).strip()
    if s.startswith("branch:"):
        raise VersionReferenceError(s)
    if s.startswith("admin/") and "/branch/" in s:
        raise VersionReferenceError(
            s,
            f"invalid version reference {s!r}: full path form is rejected; "
            f"use a bare branch name or commit:<id>",
        )
    if s.startswith("commit:"):
        if len(s) <= len("commit:") or not s[len("commit:") :].strip():
            raise VersionReferenceError(s, f"commit reference {s!r} has empty id")
        return s
    # bare branch name
    if ":" in s:
        raise VersionReferenceError(
            s,
            f"invalid version reference {s!r}: unknown prefix; "
            f"accepted forms are bare branch name or commit:<id>",
        )
    return s


class GraphStore(ABC):
    """Abstract GraphStore port.

    Implementations: ``FilesOnlyGraphStore`` (default, this package);
    ``TerminusDBGraphStore`` (deferred — separate package).
    """

    # -- capability protocol -------------------------------------------------

    @abstractmethod
    def capabilities(self) -> frozenset[str]:
        """Return the set of optional capabilities this backend provides.

        Subset of ``OPTIONAL_CAPABILITIES``. Files-only returns empty.
        """

    def has_capability(self, name: str) -> bool:
        """Return True iff this backend provides the named optional capability."""
        if name not in OPTIONAL_CAPABILITIES:
            raise ValueError(
                f"unknown capability {name!r}; known: {sorted(OPTIONAL_CAPABILITIES)}"
            )
        return name in self.capabilities()

    def require_capability(self, name: str) -> None:
        """Raise CapabilityUnavailableError if the capability is absent."""
        if not self.has_capability(name):
            raise CapabilityUnavailableError(name)

    # -- schema --------------------------------------------------------------

    @abstractmethod
    def register_schema(self, schema: Any, *, author: str = "foreman", message: str = "register schema") -> None:
        """Register (or replace) the write-time schema.

        MUST be called before the first ``upsert_document``. Store-specific
        full-replace semantics are an adapter concern; the port only requires
        that after this call, conforming documents are accepted and
        non-conforming ones are rejected with ``SchemaValidationError``.
        """

    # -- documents -----------------------------------------------------------

    @abstractmethod
    def upsert_document(self, doc: Mapping[str, Any]) -> str:
        """Create-or-replace a document.

        ``doc`` MUST contain ``@type`` and the type's business-key fields.
        Returns the deterministic document id.
        Raises ``SchemaNotRegisteredError`` / ``SchemaValidationError``.
        """

    @abstractmethod
    def get_document(self, doc_type: str, key: Mapping[str, Any] | str) -> dict[str, Any] | None:
        """Typed lookup. ``key`` is the business-key field value(s).

        For single-field keys a bare string is accepted; for multi-field keys
        pass a mapping of field→value. Returns None if absent (lookup is
        not a query and has no expected-emptiness contract).
        """

    @abstractmethod
    def get_document_by_id(self, doc_id: str) -> dict[str, Any] | None:
        """Lookup by full document id (``Type/key`` form). Returns None if absent."""

    @abstractmethod
    def list_documents(self, doc_type: str | None = None) -> list[dict[str, Any]]:
        """List documents, optionally filtered by ``@type``. Deterministic order."""

    # -- lineage queries with expected-emptiness ----------------------------

    def query(
        self,
        name: str,
        *,
        expect_empty: bool,
        params: Mapping[str, Any] | None = None,
    ) -> QueryResult:
        """Run a named lineage query under the expected-emptiness contract.

        Implementations override ``_run_query``; this wrapper enforces the
        emptiness declaration so no backend can silently return the wrong
        shape of empty.
        """
        if name not in LINEAGE_QUERIES:
            raise ValueError(
                f"unknown query {name!r}; known: {sorted(LINEAGE_QUERIES)}"
            )
        raw = self._run_query(name, dict(params or {}))
        # Deduplicate while preserving order — path queries can yield one row
        # per path; the port contracts one row per answer.
        seen: set[str] = set()
        rows: list[Any] = []
        for r in raw:
            key = r if isinstance(r, str) else repr(r)
            if key in seen:
                continue
            seen.add(key)
            rows.append(r)

        if expect_empty and rows:
            raise UnexpectedNonEmptyError(name, len(rows))
        if not expect_empty and not rows:
            raise UnexpectedEmptyError(name)
        return QueryResult(
            rows=tuple(rows),
            query_name=name,
            expected_empty=expect_empty,
        )

    @abstractmethod
    def _run_query(self, name: str, params: dict[str, Any]) -> Sequence[Any]:
        """Backend-specific query body. Return a sequence of answer rows.

        MUST NOT apply expected-emptiness (the wrapper does). MUST tolerate
        multi-path duplicates; the wrapper deduplicates.
        """

    # -- optional: time travel (default unavailable) ------------------------

    def as_of(self, version_ref: str) -> GraphStore:
        """Return a store view at ``version_ref``.

        Default: normalise the ref (so bad forms fail closed even when the
        capability is absent), then raise ``CapabilityUnavailableError``.
        Backends that support time_travel override this.
        """
        normalise_version_ref(version_ref)
        raise CapabilityUnavailableError(CAP_TIME_TRAVEL)

    # -- factory helper ------------------------------------------------------

    @staticmethod
    def open_default(root: str | None = None, **kwargs: Any) -> GraphStore:
        """Open the default backend: files-only.

        No store URL, no container, no network. ``root`` is the directory that
        holds the files-only materialisation (schema + documents). When
        ``root`` is None a transient in-memory store is used (tests).
        """
        # Local import keeps the port module free of backend deps at import time
        # for type-checkers and for the adapter boundary scan.
        from .files_only import FilesOnlyGraphStore

        return FilesOnlyGraphStore(root=root, **kwargs)
