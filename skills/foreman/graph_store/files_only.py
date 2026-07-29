# @description Files-only GraphStore: default backend, no database/network/container.
"""Files-only implementation of the GraphStore port.

Backed by a directory of JSON documents (or a pure in-memory map when
``root`` is None). No database, no container, no network.

Optional capabilities — all **unavailable**:
  * time_travel
  * branch_merge
  * cross_run_query

This is the default backend. Opening a store with no TerminusDB configuration
selects this implementation. CI runs the full port conformance suite against it
on every commit.

On-disk layout (when ``root`` is set)::

    <root>/
      SCHEMA.json          # registered schema payload
      META.json            # backend metadata
      documents/
        Task/
          T7.json
        Round/
          T7+1.json
        ...

Document files are the materialisation; they are regenerable from
``graph.json`` / ``worklog.jsonl`` / run-dir JSON (ingest is a later task —
round 1 writes through the port directly).
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Mapping, Sequence

from .errors import SchemaNotRegisteredError, SchemaValidationError
from .port import GraphStore, OPTIONAL_CAPABILITIES
from .schema import (
    BUSINESS_KEYS,
    default_schema_payload,
    detects_cycle,
    validate_document,
)


class FilesOnlyGraphStore(GraphStore):
    """Default GraphStore: pure files / memory, zero optional capabilities."""

    def __init__(self, root: str | os.PathLike[str] | None = None, *, auto_schema: bool = False):
        """Create a files-only store.

        Args:
            root: Directory for the materialisation. None → in-memory only
                  (still a real store; just not durable). Suitable for tests.
            auto_schema: When True, register the default port schema immediately.
                         Default False so the contract suite can test the
                         schema-must-precede-write rule.
        """
        self._root = Path(root) if root is not None else None
        self._memory: dict[str, dict[str, Any]] = {}
        self._schema: Any | None = None
        self._schema_registered = False

        if self._root is not None:
            self._root.mkdir(parents=True, exist_ok=True)
            (self._root / "documents").mkdir(exist_ok=True)
            self._load_existing()

        if auto_schema:
            self.register_schema(default_schema_payload(), author="foreman", message="auto")

    # -- capability protocol -------------------------------------------------

    def capabilities(self) -> frozenset[str]:
        # Files-only: none of the three optional capabilities.
        return frozenset()

    # -- schema --------------------------------------------------------------

    def register_schema(
        self,
        schema: Any,
        *,
        author: str = "foreman",
        message: str = "register schema",
    ) -> None:
        if schema is None:
            raise SchemaValidationError("schema payload must not be None", field=None)
        self._schema = schema
        self._schema_registered = True
        if self._root is not None:
            payload = {
                "schema": schema,
                "author": author,
                "message": message,
            }
            _atomic_write_json(self._root / "SCHEMA.json", payload)
            _atomic_write_json(
                self._root / "META.json",
                {
                    "backend": "files_only",
                    "optional_capabilities": [],
                    "declared_unavailable": sorted(OPTIONAL_CAPABILITIES),
                },
            )

    # -- documents -----------------------------------------------------------

    def upsert_document(self, doc: Mapping[str, Any]) -> str:
        if not self._schema_registered:
            raise SchemaNotRegisteredError(
                "register_schema must be called before upsert_document"
            )
        # Copy so callers cannot mutate store state through the input mapping.
        body = dict(doc)
        existing = set(self._memory.keys())
        if self._root is not None:
            existing |= set(self._iter_disk_ids())
        doc_id = validate_document(body, existing_ids=None)
        body["@id"] = doc_id

        # Acyclicity for DEPENDS_ON / SUBTASK_OF / BROADER_THAN / RESOLVED_TO
        self._check_acyclic_edges(body, doc_id, existing | {doc_id})

        # RESOLVED_TO already-resolved check (functional across store)
        if body.get("resolved_to") is not None:
            # If this entity already has a different resolution, reject.
            prior = self.get_document_by_id(doc_id)
            if prior and prior.get("resolved_to") and prior["resolved_to"] != body["resolved_to"]:
                raise SchemaValidationError(
                    f"RESOLVED_TO is functional: {doc_id} already resolves to "
                    f"{prior['resolved_to']!r}",
                    field="resolved_to",
                )

        self._memory[doc_id] = body
        if self._root is not None:
            self._write_doc(doc_id, body)
        return doc_id

    def get_document(
        self, doc_type: str, key: Mapping[str, Any] | str
    ) -> dict[str, Any] | None:
        if doc_type not in BUSINESS_KEYS:
            return None
        key_fields = BUSINESS_KEYS[doc_type]
        if isinstance(key, str):
            if len(key_fields) != 1:
                raise ValueError(
                    f"{doc_type} has multi-field key {key_fields}; pass a mapping"
                )
            parts = [key]
        else:
            parts = [str(key[f]) for f in key_fields]
        doc_id = f"{doc_type}/{'+'.join(parts)}"
        return self.get_document_by_id(doc_id)

    def get_document_by_id(self, doc_id: str) -> dict[str, Any] | None:
        if doc_id in self._memory:
            return dict(self._memory[doc_id])
        if self._root is not None:
            path = self._doc_path(doc_id)
            if path.is_file():
                with path.open(encoding="utf-8") as f:
                    data = json.load(f)
                self._memory[doc_id] = data
                return dict(data)
        return None

    def list_documents(self, doc_type: str | None = None) -> list[dict[str, Any]]:
        ids = set(self._memory.keys())
        if self._root is not None:
            ids |= set(self._iter_disk_ids())
        out: list[dict[str, Any]] = []
        for doc_id in sorted(ids):
            doc = self.get_document_by_id(doc_id)
            if doc is None:
                continue
            if doc_type is not None and doc.get("@type") != doc_type:
                continue
            out.append(doc)
        return out

    # -- lineage queries -----------------------------------------------------

    def _run_query(self, name: str, params: dict[str, Any]) -> Sequence[Any]:
        if name == "attempts_from_round":
            return self._q_attempts_from_round(params)
        if name == "unevaluated_leaves":
            return self._q_unevaluated_leaves(params)
        if name == "claims_contradicting":
            return self._q_claims_contradicting(params)
        raise ValueError(f"unhandled query {name!r}")

    def _q_attempts_from_round(self, params: dict[str, Any]) -> list[str]:
        """All Attempt documents transitively descending from a Round.

        Traversal edges: has_attempt, derived_from (forward and inverse).
        Round may be identified by id (``Round/T7+1``) or by
        ``task_key``+``index``.
        """
        round_id = params.get("round_id") or params.get("round")
        if not round_id:
            task_key = params.get("task_key")
            index = params.get("index")
            if task_key is None or index is None:
                raise ValueError("attempts_from_round requires round_id or task_key+index")
            round_id = f"Round/{task_key}+{index}"

        # Collect attempt seeds: direct has_attempt from the round, plus any
        # Attempt whose parent_round / round field points here (tolerant).
        seeds: set[str] = set()
        rnd = self.get_document_by_id(str(round_id))
        if rnd:
            for a in _as_list(rnd.get("has_attempt")):
                seeds.add(_id_of(a))
        for att in self.list_documents("Attempt"):
            if att.get("round") == round_id or att.get("parent_round") == round_id:
                seeds.add(att["@id"])
            # Also: if Round lists them — already handled.

        # Transitive closure over derived_from (forward: child derived_from parent
        # means child is a descendant) and inverse.
        by_id = {d["@id"]: d for d in self.list_documents()}
        # Build adjacency: parent → children (via derived_from edges pointing parent)
        children: dict[str, set[str]] = {}
        for d in by_id.values():
            for parent in _as_list(d.get("derived_from")):
                pid = _id_of(parent)
                children.setdefault(pid, set()).add(d["@id"])

        found: set[str] = set()
        stack = list(seeds)
        while stack:
            cur = stack.pop()
            doc = by_id.get(cur)
            if doc and doc.get("@type") == "Attempt":
                found.add(cur)
            for ch in children.get(cur, ()):
                if ch not in found:
                    stack.append(ch)
            # seeds themselves
            if cur not in found and doc and doc.get("@type") == "Attempt":
                found.add(cur)

        # Ensure seeds that are attempts are included even with no derived_from.
        for s in seeds:
            doc = by_id.get(s)
            if doc and doc.get("@type") == "Attempt":
                found.add(s)

        return sorted(found)

    def _q_unevaluated_leaves(self, params: dict[str, Any]) -> list[str]:
        """Attempts with no derived_from-child and no Evaluation targeting them."""
        by_id = {d["@id"]: d for d in self.list_documents()}
        attempts = [d for d in by_id.values() if d.get("@type") == "Attempt"]

        has_child: set[str] = set()
        for d in by_id.values():
            for parent in _as_list(d.get("derived_from")):
                has_child.add(_id_of(parent))

        evaluated: set[str] = set()
        for ev in by_id.values():
            if ev.get("@type") != "Evaluation":
                continue
            for field in (
                "evaluates_attempt",
                "evaluates",
                "evaluates_artifact",
                "evaluates_claim",
            ):
                for t in _as_list(ev.get(field)):
                    evaluated.add(_id_of(t))

        leaves = []
        for a in attempts:
            aid = a["@id"]
            if aid in has_child:
                continue
            if aid in evaluated:
                continue
            leaves.append(aid)
        return sorted(leaves)

    def _q_claims_contradicting(self, params: dict[str, Any]) -> list[str]:
        """Claims that CONTRADICT the given claim, either direction."""
        claim_id = params.get("claim_id") or params.get("claim")
        if not claim_id:
            key = params.get("claim_key")
            if not key:
                raise ValueError("claims_contradicting requires claim_id or claim_key")
            claim_id = f"Claim/{key}"
        claim_id = str(claim_id)

        out: set[str] = set()
        for c in self.list_documents("Claim"):
            cid = c["@id"]
            if cid == claim_id:
                for other in _as_list(c.get("contradicts")):
                    out.add(_id_of(other))
                continue
            for other in _as_list(c.get("contradicts")):
                if _id_of(other) == claim_id:
                    out.add(cid)
        return sorted(out)

    # -- internals -----------------------------------------------------------

    def _check_acyclic_edges(
        self, body: dict[str, Any], doc_id: str, known_ids: set[str]
    ) -> None:
        """Reject DEPENDS_ON / SUBTASK_OF / BROADER_THAN / RESOLVED_TO cycles."""
        for edge_field in ("depends_on", "subtask_of", "broader_than", "resolved_to"):
            if body.get(edge_field) is None:
                continue
            # Build edge map from existing docs of relevant types + this write.
            edges: dict[str, set[str]] = {}
            for d in self.list_documents():
                targets = {_id_of(t) for t in _as_list(d.get(edge_field))}
                if targets:
                    edges[d["@id"]] = targets
            edges[doc_id] = {_id_of(t) for t in _as_list(body.get(edge_field))}
            if detects_cycle(edges, doc_id):
                raise SchemaValidationError(
                    f"{edge_field} would introduce a cycle at {doc_id}",
                    field=edge_field,
                    detail="acyclicity checked, not assumed",
                )

    def _doc_path(self, doc_id: str) -> Path:
        assert self._root is not None
        # doc_id is Type/key — key may contain '+' but not '/'
        if "/" not in doc_id:
            raise ValueError(f"malformed document id {doc_id!r}")
        typ, key = doc_id.split("/", 1)
        # Sanitise key for filesystem (business keys are already lexical-safe).
        safe = re.sub(r"[^\w.+=@-]", "_", key)
        return self._root / "documents" / typ / f"{safe}.json"

    def _write_doc(self, doc_id: str, body: dict[str, Any]) -> None:
        path = self._doc_path(doc_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write_json(path, body)

    def _iter_disk_ids(self):
        if self._root is None:
            return
        docs = self._root / "documents"
        if not docs.is_dir():
            return
        for typ_dir in docs.iterdir():
            if not typ_dir.is_dir():
                continue
            for f in typ_dir.glob("*.json"):
                with f.open(encoding="utf-8") as fh:
                    try:
                        data = json.load(fh)
                    except json.JSONDecodeError:
                        continue
                if "@id" in data:
                    yield data["@id"]

    def _load_existing(self) -> None:
        if self._root is None:
            return
        schema_path = self._root / "SCHEMA.json"
        if schema_path.is_file():
            with schema_path.open(encoding="utf-8") as f:
                payload = json.load(f)
            self._schema = payload.get("schema", payload)
            self._schema_registered = True
        for doc_id in self._iter_disk_ids():
            # populate memory lazily via get; just warm ids
            self.get_document_by_id(doc_id)


def open_files_only(
    root: str | os.PathLike[str] | None = None, **kwargs: Any
) -> FilesOnlyGraphStore:
    """Public factory: files-only backend with no store configured."""
    return FilesOnlyGraphStore(root=root, **kwargs)


def open_from_env() -> GraphStore:
    """Select a backend from the environment.

    * If ``FOREMAN_GRAPH_STORE`` is unset, empty, or ``files``/``files_only``:
      files-only (default).
    * If set to ``terminusdb``: refuse with a clear error — adapter is deferred.
    * ``FOREMAN_GRAPH_STORE_ROOT`` sets the files-only materialisation directory.
    """
    kind = (os.environ.get("FOREMAN_GRAPH_STORE") or "files_only").strip().lower()
    root = os.environ.get("FOREMAN_GRAPH_STORE_ROOT") or None
    if kind in {"", "files", "files_only", "file", "default"}:
        return FilesOnlyGraphStore(root=root, auto_schema=True)
    if kind in {"terminusdb", "tdb", "terminus"}:
        raise RuntimeError(
            "TerminusDB adapter is deferred (round 1 ships files-only only). "
            "Unset FOREMAN_GRAPH_STORE or set it to 'files_only'."
        )
    raise RuntimeError(
        f"unknown FOREMAN_GRAPH_STORE={kind!r}; "
        f"accepted: files_only (default). terminusdb adapter is deferred."
    )


# -- small helpers -----------------------------------------------------------


def _atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, sort_keys=True)
            f.write("\n")
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _as_list(raw: Any) -> list[Any]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    if isinstance(raw, tuple):
        return list(raw)
    return [raw]


def _id_of(raw: Any) -> str:
    if isinstance(raw, str):
        return raw
    if isinstance(raw, Mapping) and "@id" in raw:
        return str(raw["@id"])
    return str(raw)
