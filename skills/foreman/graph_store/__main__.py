# @description CLI entry: python -m graph_store <command>
"""Command-line interface for the GraphStore port.

Commands
--------
* ``contract``     — run the backend-agnostic conformance suite
* ``capabilities`` — print optional capabilities of the selected backend
* ``smoke``        — open default (files-only) store, register schema, upsert, query
* ``version-ref``  — normalise / reject a version reference (canary helper)

Environment
-----------
* ``FOREMAN_GRAPH_STORE``       — ``files_only`` (default) | ``terminusdb`` (deferred)
* ``FOREMAN_GRAPH_STORE_ROOT``  — materialisation directory for files-only
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def _ensure_path() -> None:
    # Allow ``python -m graph_store`` when CWD or skills/foreman is on path.
    here = Path(__file__).resolve().parent
    parent = str(here.parent)
    if parent not in sys.path:
        sys.path.insert(0, parent)


def cmd_contract(argv: list[str]) -> int:
    from graph_store.contract_suite import main as contract_main

    return contract_main(argv)


def cmd_capabilities(argv: list[str]) -> int:
    from graph_store.files_only import open_from_env
    from graph_store.port import OPTIONAL_CAPABILITIES

    store = open_from_env()
    caps = store.capabilities()
    print(json.dumps(
        {
            "backend": type(store).__name__,
            "optional_available": sorted(caps),
            "optional_unavailable": sorted(OPTIONAL_CAPABILITIES - caps),
            "all_optional": sorted(OPTIONAL_CAPABILITIES),
        },
        indent=2,
    ))
    return 0


def cmd_smoke(argv: list[str]) -> int:
    """Prove the fallback runs with no store configured at all."""
    import os
    import tempfile

    # Strip any terminusdb config so we truly exercise the no-store path.
    os.environ.pop("FOREMAN_GRAPH_STORE", None)
    root = tempfile.mkdtemp(prefix="foreman-gs-smoke-")
    os.environ["FOREMAN_GRAPH_STORE_ROOT"] = root

    from graph_store.files_only import open_from_env
    from graph_store.port import OPTIONAL_CAPABILITIES

    store = open_from_env()
    assert type(store).__name__ == "FilesOnlyGraphStore"
    assert store.capabilities() == frozenset()
    for cap in OPTIONAL_CAPABILITIES:
        assert not store.has_capability(cap), cap

    store.upsert_document(
        {
            "@type": "Task",
            "task_key": "smoke",
            "title": "no-store smoke",
        }
    )
    store.upsert_document(
        {
            "@type": "Round",
            "task_key": "smoke",
            "index": 1,
            "has_attempt": ["Attempt/S1"],
        }
    )
    store.upsert_document(
        {
            "@type": "Attempt",
            "attempt_key": "S1",
            "lane": "smoke-lane",
            "round": "Round/smoke+1",
        }
    )
    result = store.query(
        "attempts_from_round",
        expect_empty=False,
        params={"round_id": "Round/smoke+1"},
    )
    assert "Attempt/S1" in result.rows, result.rows

    # Degrade on time-travel rather than crash
    from graph_store.errors import CapabilityUnavailableError

    try:
        store.as_of("main")
        print("FAIL: as_of should be unavailable", file=sys.stderr)
        return 1
    except CapabilityUnavailableError:
        pass

    print(
        json.dumps(
            {
                "ok": True,
                "backend": "FilesOnlyGraphStore",
                "root": root,
                "store_configured": False,
                "capabilities": [],
                "attempts_from_round": list(result.rows),
            },
            indent=2,
        )
    )
    return 0


def cmd_version_ref(argv: list[str]) -> int:
    from graph_store.errors import VersionReferenceError
    from graph_store.port import normalise_version_ref

    if not argv:
        print("usage: version-ref <ref>", file=sys.stderr)
        return 2
    ref = argv[0]
    try:
        print(normalise_version_ref(ref))
        return 0
    except VersionReferenceError as e:
        print(f"REJECTED: {e}", file=sys.stderr)
        return 1


def main(argv: list[str] | None = None) -> int:
    _ensure_path()
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in {"-h", "--help"}:
        print(__doc__)
        print("Commands: contract | capabilities | smoke | version-ref")
        return 0
    cmd, rest = argv[0], argv[1:]
    if cmd == "contract":
        return cmd_contract(rest)
    if cmd == "capabilities":
        return cmd_capabilities(rest)
    if cmd == "smoke":
        return cmd_smoke(rest)
    if cmd == "version-ref":
        return cmd_version_ref(rest)
    print(f"unknown command: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
