# @description Backend-agnostic GraphStore port conformance suite.
"""Port conformance suite — identical assertions against every backend.

This module MUST remain free of files-only specifics. It talks only to the
``GraphStore`` port. A future TerminusDB adapter is graded by the same cases.

Harness contract
----------------
* Every case returns ``CaseResult(name, passed, detail)``.
* ``run_suite(store_factory)`` exits process code 1 if any case fails when
  invoked as ``python -m graph_store.contract_suite``.
* A deliberately broken stub backend is shipped so the suite is proven to
  fail for real contract reasons (not because it greps for files-only paths).

Factory signature
-----------------
``store_factory() -> GraphStore`` — called once per case (or once per suite
when ``shared=True``) so backends start clean. The factory MUST return a store
with **no** schema registered yet (the suite tests that rule).
"""

from __future__ import annotations

import sys
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping

from .errors import (
    CapabilityUnavailableError,
    SchemaNotRegisteredError,
    SchemaValidationError,
    UnexpectedEmptyError,
    UnexpectedNonEmptyError,
    VersionReferenceError,
)
from .port import (
    CAP_BRANCH_MERGE,
    CAP_CROSS_RUN_QUERY,
    CAP_TIME_TRAVEL,
    LINEAGE_QUERIES,
    OPTIONAL_CAPABILITIES,
    GraphStore,
)
from .schema import default_schema_payload

StoreFactory = Callable[[], GraphStore]


@dataclass
class CaseResult:
    name: str
    passed: bool
    detail: str = ""

    def line(self) -> str:
        flag = "PASS" if self.passed else "FAIL"
        extra = f" — {self.detail}" if self.detail else ""
        return f"[{flag}] {self.name}{extra}"


@dataclass
class SuiteReport:
    results: list[CaseResult] = field(default_factory=list)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.passed)

    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if not r.passed)

    @property
    def ok(self) -> bool:
        return self.failed == 0 and len(self.results) > 0

    def extend(self, other: "SuiteReport") -> None:
        self.results.extend(other.results)


# ---------------------------------------------------------------------------
# Fixture builders (port-level documents — no filesystem paths)
# ---------------------------------------------------------------------------


def _seed_lineage_fixture(store: GraphStore) -> None:
    """R8 §6.1 fixture, expressed through the port.

    Task/T7 → Round/T7+1 → {A1, A2}, Task/T7 → Round/T7+2 → {A3, A4},
    A4 derived_from A3; E1 evaluates A1, E2 evaluates A3;
    C2 contradicts C1, C3 supports C1.
    """
    store.register_schema(default_schema_payload(), author="contract", message="fixture")
    store.upsert_document({"@type": "Task", "task_key": "T7", "title": "lineage fixture"})
    store.upsert_document(
        {
            "@type": "Round",
            "task_key": "T7",
            "index": 1,
            "has_attempt": ["Attempt/A1", "Attempt/A2"],
        }
    )
    store.upsert_document(
        {
            "@type": "Round",
            "task_key": "T7",
            "index": 2,
            "has_attempt": ["Attempt/A3", "Attempt/A4"],
        }
    )
    for key, rnd in (("A1", "Round/T7+1"), ("A2", "Round/T7+1"), ("A3", "Round/T7+2"), ("A4", "Round/T7+2")):
        doc: dict[str, Any] = {
            "@type": "Attempt",
            "attempt_key": key,
            "lane": f"lane-{key}",
            "round": rnd,
        }
        if key == "A4":
            doc["derived_from"] = ["Attempt/A3"]
        store.upsert_document(doc)
    store.upsert_document(
        {
            "@type": "Evaluation",
            "evaluation_id": "E1",
            "verdict": "approved",
            "evaluates_attempt": "Attempt/A1",
        }
    )
    store.upsert_document(
        {
            "@type": "Evaluation",
            "evaluation_id": "E2",
            "verdict": "needs_changes",
            "evaluates_attempt": "Attempt/A3",
        }
    )
    store.upsert_document(
        {
            "@type": "Claim",
            "claim_key": "C1",
            "text": "TerminusDB is maintained",
            "status": "proposed",
            "confidence": "medium",
        }
    )
    store.upsert_document(
        {
            "@type": "Claim",
            "claim_key": "C2",
            "text": "TerminusDB is abandoned",
            "status": "proposed",
            "confidence": "low",
            "contradicts": ["Claim/C1"],
        }
    )
    store.upsert_document(
        {
            "@type": "Claim",
            "claim_key": "C3",
            "text": "TerminusDB ships releases",
            "status": "supported",
            "confidence": "high",
            "supports": ["Claim/C1"],
        }
    )


def _case(name: str, fn: Callable[[], None]) -> CaseResult:
    try:
        fn()
        return CaseResult(name, True)
    except AssertionError as e:
        return CaseResult(name, False, str(e) or "assertion failed")
    except Exception as e:  # noqa: BLE001 — suite must catch backend crashes
        tb = traceback.format_exc(limit=4)
        return CaseResult(name, False, f"{type(e).__name__}: {e}\n{tb}")


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------


def case_schema_required_before_write(factory: StoreFactory) -> CaseResult:
    def body() -> None:
        store = factory()
        try:
            store.upsert_document({"@type": "Task", "task_key": "X", "title": "no schema"})
        except SchemaNotRegisteredError:
            return
        raise AssertionError("expected SchemaNotRegisteredError before register_schema")

    return _case("schema_required_before_write", body)


def case_schema_accepts_conforming(factory: StoreFactory) -> CaseResult:
    def body() -> None:
        store = factory()
        store.register_schema(default_schema_payload())
        doc_id = store.upsert_document(
            {"@type": "Task", "task_key": "T-ok", "title": "conforming"}
        )
        assert doc_id == "Task/T-ok", f"unexpected id {doc_id!r}"
        got = store.get_document("Task", "T-ok")
        assert got is not None, "lookup returned None"
        assert got["@type"] == "Task"
        assert got["task_key"] == "T-ok"

    return _case("schema_accepts_conforming_document", body)


def case_reject_free_float_confidence(factory: StoreFactory) -> CaseResult:
    def body() -> None:
        store = factory()
        store.register_schema(default_schema_payload())
        try:
            store.upsert_document(
                {
                    "@type": "Claim",
                    "claim_key": "bad-conf",
                    "text": "x",
                    "status": "proposed",
                    "confidence": 0.87,  # free float — forbidden
                }
            )
        except SchemaValidationError as e:
            assert e.field == "confidence" or "confidence" in str(e).lower(), str(e)
            return
        raise AssertionError("free-float confidence must be rejected")

    return _case("reject_free_float_confidence", body)


def case_reject_mention_document(factory: StoreFactory) -> CaseResult:
    def body() -> None:
        store = factory()
        store.register_schema(default_schema_payload())
        try:
            store.upsert_document(
                {
                    "@type": "Mention",
                    "mention_id": "m1",
                }
            )
        except SchemaValidationError as e:
            assert "mention" in str(e).lower() or e.field == "@type", str(e)
            return
        raise AssertionError("Mention document must be rejected")

    return _case("reject_mention_document", body)


def case_reject_evaluation_two_targets(factory: StoreFactory) -> CaseResult:
    def body() -> None:
        store = factory()
        store.register_schema(default_schema_payload())
        store.upsert_document({"@type": "Attempt", "attempt_key": "Ax", "lane": "L"})
        store.upsert_document(
            {
                "@type": "Artifact",
                "path": "a.txt",
                "content_hash": "h1",
            }
        )
        try:
            store.upsert_document(
                {
                    "@type": "Evaluation",
                    "evaluation_id": "E-two",
                    "verdict": "approved",
                    "evaluates_attempt": "Attempt/Ax",
                    "evaluates_artifact": "Artifact/a.txt+h1",
                }
            )
        except SchemaValidationError as e:
            assert "exactly one" in str(e).lower() or "evaluates" in str(e).lower(), str(e)
            return
        raise AssertionError("Evaluation with two targets must be rejected")

    return _case("reject_evaluation_two_targets", body)


def case_upsert_idempotent(factory: StoreFactory) -> CaseResult:
    def body() -> None:
        store = factory()
        store.register_schema(default_schema_payload())
        d1 = {"@type": "Task", "task_key": "idem", "title": "first"}
        d2 = {"@type": "Task", "task_key": "idem", "title": "second"}
        id1 = store.upsert_document(d1)
        id2 = store.upsert_document(d2)
        assert id1 == id2 == "Task/idem"
        got = store.get_document_by_id("Task/idem")
        assert got is not None and got["title"] == "second"
        tasks = store.list_documents("Task")
        assert sum(1 for t in tasks if t["task_key"] == "idem") == 1

    return _case("upsert_idempotent_same_key", body)


def case_optional_capabilities_closed_set(factory: StoreFactory) -> CaseResult:
    def body() -> None:
        store = factory()
        caps = store.capabilities()
        assert caps <= OPTIONAL_CAPABILITIES, (
            f"backend reported unknown capabilities {caps - OPTIONAL_CAPABILITIES}"
        )
        for name in OPTIONAL_CAPABILITIES:
            # has_capability must not raise for known names
            _ = store.has_capability(name)
        try:
            store.has_capability("not_a_real_cap")
            raise AssertionError("unknown capability must raise ValueError")
        except ValueError:
            pass

    return _case("optional_capabilities_closed_set", body)


def case_missing_capability_degrades(factory: StoreFactory) -> CaseResult:
    """Callers query capabilities and degrade; require_capability raises."""

    def body() -> None:
        store = factory()
        # Time-travel is optional. If absent, as_of raises CapabilityUnavailableError
        # after rejecting bad version forms. If present, as_of must accept a
        # normalised ref (we only assert the unavailable path's contract form).
        if not store.has_capability(CAP_TIME_TRAVEL):
            try:
                store.as_of("main")
                raise AssertionError("as_of must raise when time_travel absent")
            except CapabilityUnavailableError as e:
                assert e.capability == CAP_TIME_TRAVEL
            # Bad ref fails closed *before* / as well as capability check
            try:
                store.as_of("branch:main")
                raise AssertionError("branch: prefix must raise VersionReferenceError")
            except VersionReferenceError:
                pass
            except CapabilityUnavailableError as e:
                raise AssertionError(
                    "branch: prefix must be rejected as VersionReferenceError, "
                    f"not CapabilityUnavailableError ({e})"
                ) from e
        else:
            # Backend offers time_travel: still must reject branch: prefix
            try:
                store.as_of("branch:main")
                raise AssertionError("branch: prefix must raise VersionReferenceError")
            except VersionReferenceError:
                pass

    return _case("missing_capability_degrades_and_prefix_rejected", body)


def case_lineage_attempts_from_round(factory: StoreFactory) -> CaseResult:
    def body() -> None:
        store = factory()
        _seed_lineage_fixture(store)
        result = store.query(
            "attempts_from_round",
            expect_empty=False,
            params={"round_id": "Round/T7+1"},
        )
        # Round 1 has A1, A2. Transitive via derived_from does not reach A3/A4
        # from round 1. (R8 used parent_of across the whole task; our split
        # relations keep HAS_ATTEMPT round-scoped.)
        rows = set(result.rows)
        assert "Attempt/A1" in rows and "Attempt/A2" in rows, rows
        assert "Attempt/A3" not in rows and "Attempt/A4" not in rows, rows

        r2 = store.query(
            "attempts_from_round",
            expect_empty=False,
            params={"task_key": "T7", "index": 2},
        )
        rows2 = set(r2.rows)
        assert "Attempt/A3" in rows2 and "Attempt/A4" in rows2, rows2
        # A4 is reachable transitively via derived_from from A3 seed
        assert len(rows2) >= 2

    return _case("lineage_attempts_from_round", body)


def case_lineage_unevaluated_leaves(factory: StoreFactory) -> CaseResult:
    def body() -> None:
        store = factory()
        _seed_lineage_fixture(store)
        result = store.query("unevaluated_leaves", expect_empty=False)
        rows = set(result.rows)
        # A1 evaluated, A3 evaluated and has child A4; leaves unevaluated: A2, A4
        assert rows == {"Attempt/A2", "Attempt/A4"}, rows

    return _case("lineage_unevaluated_leaves", body)


def case_lineage_claims_contradicting(factory: StoreFactory) -> CaseResult:
    def body() -> None:
        store = factory()
        _seed_lineage_fixture(store)
        result = store.query(
            "claims_contradicting",
            expect_empty=False,
            params={"claim_id": "Claim/C1"},
        )
        assert set(result.rows) == {"Claim/C2"}, set(result.rows)

    return _case("lineage_claims_contradicting", body)


def case_unexpected_empty_raises(factory: StoreFactory) -> CaseResult:
    def body() -> None:
        store = factory()
        store.register_schema(default_schema_payload())
        # No attempts at all → unevaluated_leaves is genuinely empty
        try:
            store.query("unevaluated_leaves", expect_empty=False)
        except UnexpectedEmptyError as e:
            assert e.query_name == "unevaluated_leaves"
            return
        raise AssertionError("expected UnexpectedEmptyError")

    return _case("unexpected_empty_raises", body)


def case_expected_empty_true_negative(factory: StoreFactory) -> CaseResult:
    def body() -> None:
        store = factory()
        store.register_schema(default_schema_payload())
        # No claims → contradicting query is a true negative
        result = store.query(
            "claims_contradicting",
            expect_empty=True,
            params={"claim_key": "nope"},
        )
        assert result.is_empty
        assert result.expected_empty is True

    return _case("expected_empty_true_negative", body)


def case_unexpected_nonempty_raises(factory: StoreFactory) -> CaseResult:
    def body() -> None:
        store = factory()
        _seed_lineage_fixture(store)
        try:
            store.query(
                "claims_contradicting",
                expect_empty=True,
                params={"claim_id": "Claim/C1"},
            )
        except UnexpectedNonEmptyError as e:
            assert e.query_name == "claims_contradicting"
            assert e.count >= 1
            return
        raise AssertionError("expected UnexpectedNonEmptyError")

    return _case("unexpected_nonempty_raises", body)


def case_unknown_query_rejected(factory: StoreFactory) -> CaseResult:
    def body() -> None:
        store = factory()
        store.register_schema(default_schema_payload())
        try:
            store.query("not_a_lineage_query", expect_empty=True)
        except ValueError:
            return
        raise AssertionError("unknown query name must raise ValueError")

    return _case("unknown_query_rejected", body)


def case_lineage_query_names_complete(factory: StoreFactory) -> CaseResult:
    def body() -> None:
        # The closed set is part of the port; suite pins it so an adapter
        # cannot silently drop a required query.
        assert LINEAGE_QUERIES == {
            "attempts_from_round",
            "unevaluated_leaves",
            "claims_contradicting",
        }
        store = factory()
        # factory used so the case still goes through a real backend open
        assert store is not None

    return _case("lineage_query_names_complete", body)


def case_depends_on_cycle_rejected(factory: StoreFactory) -> CaseResult:
    def body() -> None:
        store = factory()
        store.register_schema(default_schema_payload())
        store.upsert_document({"@type": "Task", "task_key": "c1", "title": "c1"})
        store.upsert_document(
            {
                "@type": "Task",
                "task_key": "c2",
                "title": "c2",
                "depends_on": ["Task/c1"],
            }
        )
        try:
            store.upsert_document(
                {
                    "@type": "Task",
                    "task_key": "c1",
                    "title": "c1-cycle",
                    "depends_on": ["Task/c2"],
                }
            )
        except SchemaValidationError as e:
            assert "cycle" in str(e).lower(), str(e)
            return
        raise AssertionError("DEPENDS_ON cycle must be rejected")

    return _case("depends_on_cycle_rejected", body)


def case_resolved_to_requires_reviewer(factory: StoreFactory) -> CaseResult:
    def body() -> None:
        store = factory()
        store.register_schema(default_schema_payload())
        store.upsert_document(
            {
                "@type": "Entity",
                "canonical_name": "foreman",
                "entity_type": "project",
            }
        )
        store.upsert_document(
            {
                "@type": "Entity",
                "canonical_name": "Foreman",
                "entity_type": "project",
            }
        )
        try:
            store.upsert_document(
                {
                    "@type": "Entity",
                    "canonical_name": "Foreman",
                    "entity_type": "project",
                    "resolved_to": "Entity/foreman+project",
                    # missing reviewer + provenance
                }
            )
        except SchemaValidationError as e:
            assert "reviewer" in str(e).lower() or e.field == "resolved_to_reviewer", str(e)
            return
        raise AssertionError("RESOLVED_TO without reviewer must be rejected")

    return _case("resolved_to_requires_reviewer", body)


# ---------------------------------------------------------------------------
# Suite runner
# ---------------------------------------------------------------------------

ALL_CASES: list[Callable[[StoreFactory], CaseResult]] = [
    case_schema_required_before_write,
    case_schema_accepts_conforming,
    case_reject_free_float_confidence,
    case_reject_mention_document,
    case_reject_evaluation_two_targets,
    case_upsert_idempotent,
    case_optional_capabilities_closed_set,
    case_missing_capability_degrades,
    case_lineage_attempts_from_round,
    case_lineage_unevaluated_leaves,
    case_lineage_claims_contradicting,
    case_unexpected_empty_raises,
    case_expected_empty_true_negative,
    case_unexpected_nonempty_raises,
    case_unknown_query_rejected,
    case_lineage_query_names_complete,
    case_depends_on_cycle_rejected,
    case_resolved_to_requires_reviewer,
]


def run_suite(factory: StoreFactory) -> SuiteReport:
    """Run every case against ``factory``. Never swallows failures into pass."""
    report = SuiteReport()
    for case in ALL_CASES:
        report.results.append(case(factory))
    return report


def print_report(report: SuiteReport, *, stream: Any = None) -> None:
    stream = stream or sys.stdout
    for r in report.results:
        print(r.line(), file=stream)
    print(
        f"\n{report.passed} passed, {report.failed} failed, {len(report.results)} total",
        file=stream,
    )
    if report.ok:
        print("SUITE OK", file=stream)
    else:
        print("SUITE FAILED", file=stream)


# ---------------------------------------------------------------------------
# Stub backend — fails the suite for real contract reasons
# ---------------------------------------------------------------------------


class StubEmptyBackend(GraphStore):
    """Deliberately broken backend used to prove the suite is backend-agnostic.

    * Claims every optional capability (lying).
    * Accepts writes without schema.
    * Returns empty for every query (silent-empty footgun).
    * Stores nothing.

    The suite MUST fail against this backend for multiple independent reasons.
    If the suite passes against this stub, the suite is defective.
    """

    def capabilities(self) -> frozenset[str]:
        # Lie: claim all capabilities while implementing none correctly.
        return frozenset(OPTIONAL_CAPABILITIES)

    def register_schema(self, schema: Any, *, author: str = "foreman", message: str = "") -> None:
        pass  # pretend

    def upsert_document(self, doc: Mapping[str, Any]) -> str:
        # Accept anything, return a fake id, store nothing.
        return f"Stub/{doc.get('@type', 'X')}"

    def get_document(self, doc_type: str, key: Mapping[str, Any] | str) -> dict[str, Any] | None:
        return None

    def get_document_by_id(self, doc_id: str) -> dict[str, Any] | None:
        return None

    def list_documents(self, doc_type: str | None = None) -> list[dict[str, Any]]:
        return []

    def _run_query(self, name: str, params: dict[str, Any]) -> list[Any]:
        return []  # silent empty — the footgun

    def as_of(self, version_ref: str) -> GraphStore:
        # Does not normalise / reject branch: prefix — another real failure.
        return self


def files_only_factory() -> GraphStore:
    """Factory used by CI: fresh in-memory files-only store, no schema yet."""
    from .files_only import FilesOnlyGraphStore

    return FilesOnlyGraphStore(root=None, auto_schema=False)


def stub_factory() -> GraphStore:
    return StubEmptyBackend()


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    backend = "files_only"
    expect_fail = False
    for a in argv:
        if a in {"--backend=files_only", "--backend=files", "files_only", "files"}:
            backend = "files_only"
        elif a in {"--backend=stub", "stub"}:
            backend = "stub"
        elif a == "--expect-fail":
            expect_fail = True
        elif a in {"-h", "--help"}:
            print(
                "Usage: python -m graph_store.contract_suite "
                "[files_only|stub] [--expect-fail]\n"
                "  files_only (default): must PASS\n"
                "  stub: deliberately broken; must FAIL (use --expect-fail)\n"
                "Exit 0 only when the outcome matches expectation."
            )
            return 0
        else:
            print(f"unknown arg: {a}", file=sys.stderr)
            return 2

    factory: StoreFactory = files_only_factory if backend == "files_only" else stub_factory
    report = run_suite(factory)
    print_report(report)
    print(f"backend={backend} expect_fail={expect_fail}")

    if expect_fail:
        # Suite is sound only if it actually fails the stub for real reasons.
        if report.ok:
            print(
                "SOUNDNESS FAILURE: suite passed against the broken stub — "
                "the suite is not testing the contract",
                file=sys.stderr,
            )
            return 1
        if report.failed < 3:
            print(
                f"SOUNDNESS FAILURE: stub produced only {report.failed} failure(s); "
                f"expected several independent contract failures",
                file=sys.stderr,
            )
            return 1
        print(f"SOUNDNESS OK: stub failed {report.failed} cases as required")
        return 0

    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
