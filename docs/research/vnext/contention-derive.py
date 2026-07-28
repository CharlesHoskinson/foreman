#!/usr/bin/env python3
"""Derive the v0.2.9 file-contention table from MODIFICATION claims, not mentions.

Revision 2 (2026-07-28), after the codex re-audit found two defects in
revision 1:

  * The extension alternation had no trailing path boundary, so `\\.toml`
    matched the PREFIX of `config/foreman.toml.example` and the table named
    `config/foreman.toml` — a path that does not exist in the repo — as the most
    contended file. Fixed with a negative lookahead.
  * The committed table went stale when the fix round added claims (20 -> 22).
    The script now prints a stamp so a stale table is visible rather than
    inferred.

Known limitations, stated rather than hidden (both can UNDER-count):
  * A task claim is recognised only when the physical line begins with the
    checkbox, so a path on a wrapped continuation line of the same task is
    missed.
  * A single negation token suppresses every path on that line, so a mixed line
    carrying both a disclaimer and a real claim loses the real one.
Both were accepted deliberately: under-counting contention is the safer error,
because it produces a more conservative serialisation than reality requires,
whereas over-counting produced the inflated figures revision 1 reported.
"""
import re
import subprocess
from pathlib import Path
from collections import defaultdict

ROOT = Path("/root/foreman/openspec/changes")
PATH_RE = re.compile(
    r"(?:skills/foreman/scripts|env|tests|\.github/workflows|config|launcher|bin)"
    r"/[A-Za-z0-9_./-]+?\.(?:sh|toml|yml|yaml|bats|ps1|json|ts)"
    r"(?:\.example)?"              # .example is a real suffix, not a boundary violation
    r"(?![A-Za-z0-9_.-])"          # otherwise require a true path boundary
)
NEGATION = re.compile(
    r"\b(?:does not|do not|never|without|not touch|untouched|no change to|"
    r"owned by|owns|defer(?:s|red)? to|consumer of|do NOT)\b", re.I
)

claims = defaultdict(set)
mentions = defaultdict(set)

for pkg in sorted(p for p in ROOT.iterdir() if p.is_dir() and p.name != "archive"):
    for f in pkg.rglob("*.md"):
        rel = f.relative_to(pkg).as_posix()
        in_impact = False
        for ln in f.read_text(encoding="utf-8", errors="replace").split("\n"):
            if rel == "proposal.md" and ln.startswith("## "):
                in_impact = ln.strip().lower().startswith("## impact")
            claiming = (rel == "proposal.md" and in_impact) or \
                       (rel == "tasks.md" and re.match(r"\s*-\s*\[[ xX]\]", ln))
            for m in PATH_RE.findall(ln):
                mentions[m].add(pkg.name)
                if claiming and not NEGATION.search(ln):
                    claims[m].add(pkg.name)

# A nonexistent path is normal here: most are deliverables the packages create.
# The regex-artifact signature is narrower — a path that becomes REAL when a
# suffix is appended, which is how `config/foreman.toml` was matched inside
# `config/foreman.toml.example`. Only that is reported.
REPO = Path("/root/foreman")
missing = []
for f in claims:
    if (REPO / f).exists():
        continue
    parent = (REPO / f).parent
    if parent.is_dir() and any(s.name.startswith(Path(f).name + ".") for s in parent.iterdir()):
        missing.append(f)

head = subprocess.run(["git", "-C", "/root/foreman", "rev-parse", "--short", "HEAD"],
                      capture_output=True, text=True).stdout.strip()
print(f"# derived at HEAD {head}\n")
print("FILE".ljust(52), "CLAIMS", "MENTIONS")
print("-" * 84)
for f, pkgs in sorted(claims.items(), key=lambda kv: (-len(kv[1]), kv[0])):
    if len(pkgs) < 3:
        continue
    print(f"{f.ljust(52)} {str(len(pkgs)).rjust(6)} {str(len(mentions[f])).rjust(8)}")
    print("       ", ", ".join(sorted(pkgs)))

print()
print("Files claimed by >1 package:", sum(1 for p in claims.values() if len(p) > 1))
print("Peak contention (claims):", max((len(p) for p in claims.values()), default=0))
print("NONEXISTENT PATHS (regex artifacts):", missing if missing else "none")
