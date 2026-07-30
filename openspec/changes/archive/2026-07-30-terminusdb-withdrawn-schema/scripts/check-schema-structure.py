#!/usr/bin/env python3
"""Structural checks for the frozen terminusdb-schema (T1 + T2).

Exit 0 only when every check passes. Exit non-zero on any failure.

Self-test (known-bad must fail the checker):
  python3 check-schema-structure.py --self-test
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path


def extract_schema(design_md: Path) -> list:
    text = design_md.read_text(encoding="utf-8")
    blocks = re.findall(r"```json\n(.*?)```", text, re.S)
    best = None
    best_raw = None
    for b in blocks:
        try:
            obj = json.loads(b)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, list):
            if best is None or len(obj) > len(best):
                best = obj
                best_raw = b
    if best is None:
        raise SystemExit("FAIL: no parseable fenced JSON schema block in design.md")
    return best


def collect_failures(schema: list, design_text: str) -> list[str]:
    fails: list[str] = []
    by_id = {x["@id"]: x for x in schema if isinstance(x, dict) and "@id" in x}
    enums = [x for x in schema if x.get("@type") == "Enum"]
    classes = [x for x in schema if x.get("@type") == "Class"]
    tus = [x for x in schema if x.get("@type") == "TaggedUnion"]

    if len(enums) != 12:
        fails.append(f"expected 12 enums, got {len(enums)}")
    if "Provenance" not in by_id:
        fails.append("missing Provenance")
    if by_id.get("EvaluationTarget", {}).get("@type") != "TaggedUnion":
        fails.append("EvaluationTarget must be TaggedUnion")
    for abs_id in ("GraphNode", "WorkNode", "Artifact"):
        if "@abstract" not in by_id.get(abs_id, {}):
            fails.append(f"{abs_id} must be abstract")

    concrete = [
        c["@id"]
        for c in classes
        if "@abstract" not in c and c["@id"] != "Provenance"
    ]
    if len(concrete) != 15:
        fails.append(f"expected 15 concrete classes (excl Provenance), got {len(concrete)}: {concrete}")

    blob = json.dumps(schema)
    for bad in ("parent_of", "PARENT_OF", "mentions", "Mention"):
        if re.search(rf'"{bad}"', blob) or re.search(rf'"@id": "{bad}"', blob):
            fails.append(f"forbidden name present: {bad}")
    # plain supersedes field (not Supersession class)
    if re.search(r'"supersedes"\s*:', blob):
        fails.append("plain supersedes field must not exist")

    def prop_on(cls: str, prop: str) -> bool:
        return prop in by_id.get(cls, {})

    required_props = [
        ("Round", "has_attempt"),
        ("Task", "subtask_of"),
        ("Task", "depends_on"),
        ("Artifact", "artifact_depends_on"),
        ("Entity", "broader_than"),
        ("GraphNode", "graphify_version"),
        ("Evaluation", "target"),
        ("Finding", "about"),
        ("Entity", "resolved_to"),
        ("Entity", "resolved_reviewed_by"),
    ]
    for cls, prop in required_props:
        if not prop_on(cls, prop):
            fails.append(f"missing {cls}.{prop}")

    # each named relation on exactly one class
    owners = {
        "has_attempt": [],
        "subtask_of": [],
        "depends_on": [],
        "artifact_depends_on": [],
        "broader_than": [],
    }
    for cid, obj in by_id.items():
        for prop in owners:
            if prop in obj:
                owners[prop].append(cid)
    expected_owner = {
        "has_attempt": ["Round"],
        "subtask_of": ["Task"],
        "depends_on": ["Task"],
        "artifact_depends_on": ["Artifact"],
        "broader_than": ["Entity"],
    }
    for prop, expect in expected_owner.items():
        if owners[prop] != expect:
            fails.append(f"{prop} owners {owners[prop]} != {expect}")

    # subtask_of and depends_on distinct
    if by_id.get("Task", {}).get("subtask_of") == by_id.get("Task", {}).get("depends_on"):
        fails.append("subtask_of and depends_on must not be the same property shape by accident merge")

    # EvaluationTarget refs
    et = by_id.get("Evaluation", {}).get("target")
    if et != "EvaluationTarget":
        fails.append(f"Evaluation.target must be EvaluationTarget, got {et!r}")
    about = by_id.get("Finding", {}).get("about")
    if not (isinstance(about, dict) and about.get("@type") == "Optional" and about.get("@class") == "EvaluationTarget"):
        fails.append(f"Finding.about must be Optional EvaluationTarget, got {about!r}")

    # resolved_to Optional Entity
    rt = by_id.get("Entity", {}).get("resolved_to")
    if not (isinstance(rt, dict) and rt.get("@type") == "Optional" and rt.get("@class") == "Entity"):
        fails.append(f"Entity.resolved_to must be Optional Entity, got {rt!r}")

    # Supersession top-level, not subdocument
    sup = by_id.get("Supersession")
    if not sup or "@subdocument" in sup:
        fails.append("Supersession must be top-level class")
    for fld in ("old", "new", "at", "reason"):
        if fld not in (sup or {}):
            fails.append(f"Supersession missing {fld}")

    # LLM enums
    if by_id.get("Provenance", {}).get("confidence") != "ConfidenceLevel":
        fails.append("Provenance.confidence must be ConfidenceLevel")
    if by_id.get("Claim", {}).get("status") != "ClaimStatus":
        fails.append("Claim.status must be ClaimStatus")
    if by_id.get("Entity", {}).get("kind") != "EntityKind":
        fails.append("Entity.kind must be EntityKind")
    if by_id.get("Measurement", {}).get("value") != "xsd:decimal":
        fails.append("Measurement.value must be xsd:decimal")

    # subdocument rules
    for cid in ("Claim", "Evaluation", "Finding", "Source"):
        if "@subdocument" in by_id.get(cid, {}):
            fails.append(f"{cid} must not be @subdocument")
    prov = by_id.get("Provenance", {})
    if "@subdocument" not in prov:
        fails.append("Provenance must be @subdocument")
    if prov.get("@key", {}).get("@type") != "ValueHash":
        fails.append("Provenance must key ValueHash")

    # AgentRun optionals
    ar = by_id.get("AgentRun", {})
    for fld in ("invocation_id", "external_params"):
        v = ar.get(fld)
        if not (isinstance(v, dict) and v.get("@type") == "Optional"):
            fails.append(f"AgentRun.{fld} must be Optional")
    rd = ar.get("resolved_deps", {})
    if isinstance(rd, dict) and "@min_cardinality" in rd:
        fails.append("AgentRun.resolved_deps must not carry @min_cardinality")

    # graphify_version Optional string on GraphNode
    gv = by_id.get("GraphNode", {}).get("graphify_version")
    if not (
        isinstance(gv, dict)
        and gv.get("@type") == "Optional"
        and gv.get("@class") == "xsd:string"
    ):
        fails.append(f"GraphNode.graphify_version must be Optional xsd:string, got {gv!r}")

    # every concrete class inherits GraphNode (transitively)
    def inherits_graphnode(cid: str) -> bool:
        seen: set[str] = set()
        stack = list(by_id.get(cid, {}).get("@inherits", []))
        while stack:
            p = stack.pop()
            if p in seen:
                continue
            seen.add(p)
            if p == "GraphNode":
                return True
            stack.extend(by_id.get(p, {}).get("@inherits", []))
        return cid == "GraphNode"

    for cid in concrete:
        if not inherits_graphnode(cid):
            fails.append(f"{cid} does not inherit GraphNode")

    # Claim/Entity never inherit WorkNode
    for cid in ("Claim", "Entity"):
        seen: set[str] = set()
        stack = list(by_id.get(cid, {}).get("@inherits", []))
        while stack:
            p = stack.pop()
            if p in seen:
                continue
            seen.add(p)
            stack.extend(by_id.get(p, {}).get("@inherits", []))
        if "WorkNode" in seen:
            fails.append(f"{cid} must not inherit WorkNode")

    # CQ table: 24 rows, gaps only 16 and 22
    start = design_text.find("## Competency question mapping")
    end = design_text.find("## graphify -> schema mapping")
    if start < 0 or end < 0:
        fails.append("missing CQ mapping or graphify manifest section")
    else:
        section = design_text[start:end]
        nums = re.findall(r"^\| (\d+) \|", section, re.M)
        if nums != [str(i) for i in range(1, 25)]:
            fails.append(f"CQ table must list 1..24 in order, got {nums}")
        gaps = []
        for line in section.splitlines():
            m = re.match(r"^\| (\d+) \| ([^|]+) \|", line)
            if m and m.group(2).strip().lower().startswith("gap"):
                gaps.append(m.group(1))
        if gaps != ["16", "22"]:
            fails.append(f"exactly CQ-16 and CQ-22 must be gaps, got {gaps}")

    # graphify manifest: six file_types + reject + hyperedge
    for ft in ("code", "document", "paper", "image", "concept", "rationale"):
        if f"| {ft} |" not in design_text and f"|{ft}|" not in design_text:
            # table uses | code |
            if re.search(rf"\|\s*{ft}\s*\|", design_text) is None:
                fails.append(f"graphify manifest missing file_type {ft}")
    if "manifest_version" not in design_text:
        fails.append("manifest_version missing")
    if "Reject rule" not in design_text and "rejected before any write" not in design_text:
        fails.append("reject rule for unmapped file_type missing")
    if "hyperedge" not in design_text.lower():
        fails.append("hyperedge drop rule missing")

    # version + change procedure
    if "Schema version and change procedure" not in design_text:
        fails.append("missing Schema version and change procedure section")
    if "v0.2.9" not in design_text:
        fails.append("schema version v0.2.9 not documented")

    return fails


def run_on(design_md: Path) -> int:
    schema = extract_schema(design_md)
    fails = collect_failures(schema, design_md.read_text(encoding="utf-8"))
    if fails:
        print(f"FAIL: {len(fails)} structural check(s) failed:")
        for f in fails:
            print(f"  - {f}")
        return 1
    print(
        f"PASS: structural checks ok "
        f"({len(schema)} schema objects, 12 enums, 15 concrete classes, CQ 1-24)"
    )
    return 0


def self_test(design_md: Path) -> int:
    """Demonstrate the checker FAILS on known-bad inputs."""
    text = design_md.read_text(encoding="utf-8")
    # Known-bad 1: inject forbidden PARENT_OF property name into Task block area
    bad1 = text.replace('"depends_on":', '"parent_of":', 1)
    # Known-bad 2: drop CQ-22 gap marker so gap set is wrong
    bad2 = text.replace(
        "| 22 | gap, by design",
        "| 22 | AgentRun.context (invented)",
        1,
    )
    cases = [("forbidden parent_of", bad1), ("missing CQ-22 gap", bad2)]
    observed_fail = 0
    for name, content in cases:
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "design.md"
            p.write_text(content, encoding="utf-8")
            # If replace didn't land for bad1 (depends_on might appear later), force
            if name.startswith("forbidden") and '"parent_of"' not in content:
                schema = extract_schema(design_md)
                # mutate schema object
                for obj in schema:
                    if obj.get("@id") == "Task":
                        obj["parent_of"] = obj.get("depends_on", "Task")
                # write a minimal design with only the mutated schema
                p.write_text(
                    "# bad\n\n```json\n" + json.dumps(schema) + "\n```\n"
                    + "\n## Competency question mapping\n"
                    + "\n".join(
                        f"| {i} | mapped | n |" if i not in (16, 22) else f"| {i} | gap, by design | n |"
                        for i in range(1, 25)
                    )
                    + "\n\n## graphify -> schema mapping\n"
                    + "manifest_version: 1\n"
                    + "| code | Source |\n| document | Source |\n| paper | Source |\n"
                    + "| image | Source |\n| concept | Entity |\n| rationale | Claim |\n"
                    + "Reject rule: rejected before any write\nhyperedges drop\n"
                    + "## Schema version and change procedure\nv0.2.9\n",
                    encoding="utf-8",
                )
            rc = run_on(p)
            if rc == 0:
                print(f"SELF-TEST FAIL: known-bad case {name!r} was accepted")
                return 2
            print(f"SELF-TEST OK: known-bad case {name!r} was rejected (exit {rc})")
            observed_fail += 1
    if observed_fail != len(cases):
        print("SELF-TEST FAIL: not all known-bad cases observed failing")
        return 2
    print(f"SELF-TEST PASS: {observed_fail} known-bad cases observed failing")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--design",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "design.md",
    )
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="Run known-bad inputs and require the checker to fail them",
    )
    args = ap.parse_args()
    if args.self_test:
        return self_test(args.design)
    return run_on(args.design)


if __name__ == "__main__":
    sys.exit(main())
