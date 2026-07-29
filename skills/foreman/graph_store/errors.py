# @description Named errors for the GraphStore port.
#   Every failure path raises a typed error so callers never mistake an empty
#   result, a schema rejection, or a missing capability for success.
"""GraphStore port error vocabulary.

These names are part of the port contract. Implementations and callers MUST
raise / catch these (or subclasses), not raw ValueError / KeyError, for the
conditions they cover.
"""

from __future__ import annotations


class GraphStoreError(Exception):
    """Base class for every GraphStore port error."""


class SchemaNotRegisteredError(GraphStoreError):
    """Raised when a write is attempted before schema registration."""


class SchemaValidationError(GraphStoreError):
    """Raised when a document fails write-time schema validation.

    ``field`` names the offending field when known; ``detail`` carries the
    human-readable reason (enum name, missing key, etc.).
    """

    def __init__(self, message: str, *, field: str | None = None, detail: str | None = None):
        super().__init__(message)
        self.field = field
        self.detail = detail


class DocumentNotFoundError(GraphStoreError):
    """Raised when a typed lookup that was required to succeed finds nothing."""


class UnexpectedEmptyError(GraphStoreError):
    """Raised when a query declared expected-non-empty returned no rows.

    The dominant TerminusDB failure mode is a silent empty result that looks
    like a true negative. The port forbids that path: callers declare
    expectation, and the wrapper raises this named error instead of returning
    empty.
    """

    def __init__(self, query_name: str, message: str | None = None):
        self.query_name = query_name
        super().__init__(message or f"query {query_name!r} returned empty but expected results")


class UnexpectedNonEmptyError(GraphStoreError):
    """Raised when a query declared expected-empty returned one or more rows."""

    def __init__(self, query_name: str, count: int, message: str | None = None):
        self.query_name = query_name
        self.count = count
        super().__init__(
            message
            or f"query {query_name!r} returned {count} row(s) but expected empty"
        )


class CapabilityUnavailableError(GraphStoreError):
    """Raised only when a caller *requires* an optional capability that is absent.

    Preferred path: query capabilities and degrade. This error is for the
    hard-require case only.
    """

    def __init__(self, capability: str, message: str | None = None):
        self.capability = capability
        super().__init__(
            message or f"optional capability {capability!r} is unavailable on this backend"
        )


class UngroundedWriteError(GraphStoreError):
    """Raised when a write carries fields that cannot be derived from source artifacts.

    Round-1 files-only does not enforce full regenerability provenance yet;
    adapters that do will raise this for store-only facts.
    """

    def __init__(self, fields: list[str], message: str | None = None):
        self.fields = fields
        super().__init__(
            message or f"write refused: ungrounded fields {fields!r}"
        )


class VersionReferenceError(GraphStoreError):
    """Raised when a version reference is malformed or uses a banned form.

    The response-header prefix form (``branch:<id>``) returns a silent empty
    diff on TerminusDB. The port rejects it at the wrapper boundary.
    """

    def __init__(self, ref: str, message: str | None = None):
        self.ref = ref
        super().__init__(
            message
            or (
                f"invalid version reference {ref!r}: accepted forms are "
                f"'main', a bare branch name, or 'commit:<id>'; "
                f"the response-header prefix form 'branch:<id>' is rejected"
            )
        )


class BackendMisconfigurationError(GraphStoreError):
    """Raised when a backend cannot start from the given configuration."""
