# @description GraphStore port package: port + files-only backend + contract suite.
"""GraphStore port — regenerable materialisation, files-only default.

Public surface
--------------
* ``GraphStore`` — abstract port
* ``FilesOnlyGraphStore`` / ``open_files_only`` / ``open_from_env`` — default backend
* ``run_suite`` / ``files_only_factory`` / ``stub_factory`` — conformance suite
* error types from ``graph_store.errors``
* ``OPTIONAL_CAPABILITIES``, ``LINEAGE_QUERIES``

Import::

    # From repo root, with skills/foreman on PYTHONPATH:
    from graph_store import GraphStore, open_from_env
    store = open_from_env()  # files-only when no store configured
"""

from .errors import (
    CapabilityUnavailableError,
    DocumentNotFoundError,
    GraphStoreError,
    SchemaNotRegisteredError,
    SchemaValidationError,
    UnexpectedEmptyError,
    UnexpectedNonEmptyError,
    VersionReferenceError,
)
from .files_only import FilesOnlyGraphStore, open_files_only, open_from_env
from .port import (
    CAP_BRANCH_MERGE,
    CAP_CROSS_RUN_QUERY,
    CAP_TIME_TRAVEL,
    DOCUMENT_TYPES,
    LINEAGE_QUERIES,
    OPTIONAL_CAPABILITIES,
    GraphStore,
    QueryResult,
    document_id,
    normalise_version_ref,
)

__all__ = [
    "GraphStore",
    "FilesOnlyGraphStore",
    "QueryResult",
    "open_files_only",
    "open_from_env",
    "document_id",
    "normalise_version_ref",
    "OPTIONAL_CAPABILITIES",
    "LINEAGE_QUERIES",
    "DOCUMENT_TYPES",
    "CAP_TIME_TRAVEL",
    "CAP_BRANCH_MERGE",
    "CAP_CROSS_RUN_QUERY",
    "GraphStoreError",
    "SchemaNotRegisteredError",
    "SchemaValidationError",
    "DocumentNotFoundError",
    "UnexpectedEmptyError",
    "UnexpectedNonEmptyError",
    "CapabilityUnavailableError",
    "VersionReferenceError",
]
