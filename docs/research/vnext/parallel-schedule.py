#!/usr/bin/env python3
"""Derive a contention-aware parallel schedule for the remaining v0.2.9 work.

Reuses the claim-extraction rules of contention-derive.py verbatim (same regex,
same negation suppression, same under-count-is-safer stance), then:

  1. builds the conflict graph  — two packages conflict iff they claim a
     common file, because LANDING-ORDER requires same-file claimants to land
     serially rather than in parallel worktrees;
  2. greedily colours it into WAVES, largest-degree-first so the most
     entangled packages are placed before the schedule fills up;
  3. reports the theoretical parallel width and what actually bounds it.

A wave is a set of packages with pairwise-disjoint write sets: every member can
run concurrently in its own worktree without a merge conflict.
"""
import re
from pathlib import Path
from collections import defaultdict

ROOT = Path("/root/foreman/openspec/changes")
PATH_RE = re.compile(
    r"(?:skills/foreman/scripts|env|tests|\.github/workflows|config|launcher|bin)"
    r"/[A-Za-z0-9_./-]+?\.(?:sh|toml|yml|yaml|bats|ps1|json|ts)"
    r"(?:\.example)?"
    r"(?![A-Za-z0-9_.-])"
)
NEGATION = re.compile(
    r"\b(?:does not|do not|never|without|not touch|untouched|no change to|"
    r"owned by|owns|defer(?:s|red)? to|consumer of|do NOT)\b", re.I)

# Packages already implemented this session; excluded from the remaining schedule.
DONE = {"crlf-extensionless-hardening", "lock-primitive-hardening"}

claims = defaultdict(set)
for pkg in sorted(p for p in ROOT.iterdir() if p.is_dir() and p.name != "archive"):
    if pkg.name in DONE:
        continue
    for fname in ("proposal.md", "tasks.md"):
        f = pkg / fname
        if not f.exists():
            continue
        in_impact = False
        for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
            if fname == "proposal.md":
                if line.startswith("## "):
                    in_impact = line.strip().lower().startswith("## impact")
                if not in_impact:
                    continue
            else:
                if not line.lstrip().startswith("- ["):
                    continue
            if NEGATION.search(line):
                continue
            for m in PATH_RE.findall(line):
                claims[pkg.name].add(m)

pkgs = sorted(claims)
conflict = {p: set() for p in pkgs}
for i, a in enumerate(pkgs):
    for b in pkgs[i + 1:]:
        if claims[a] & claims[b]:
            conflict[a].add(b)
            conflict[b].add(a)

# Greedy colouring, most-entangled first.
order = sorted(pkgs, key=lambda p: (-len(conflict[p]), p))
wave_of = {}
for p in order:
    used = {wave_of[q] for q in conflict[p] if q in wave_of}
    w = 0
    while w in used:
        w += 1
    wave_of[p] = w

waves = defaultdict(list)
for p, w in wave_of.items():
    waves[w].append(p)

print("=" * 74)
print("PARALLEL SCHEDULE — remaining packages (S1 excluded, already implemented)")
print("=" * 74)
print(f"packages remaining : {len(pkgs)}")
print(f"waves required     : {len(waves)}")
print(f"widest wave        : {max(len(v) for v in waves.values())}")
print()
for w in sorted(waves):
    members = sorted(waves[w])
    print(f"WAVE {w + 1}  ({len(members)} concurrent)")
    for m in members:
        top = sorted(claims[m])[:3]
        print(f"    {m:<34} {', '.join(top) if top else '(no file claims parsed)'}")
    print()

print("-" * 74)
print("WHAT BINDS THE WIDTH")
hot = sorted(((len({q for q in pkgs if f in claims[q]}), f) for f in
              {f for c in claims.values() for f in c}), reverse=True)[:6]
for n, f in hot:
    if n > 1:
        print(f"    {n} packages claim {f}")
print()
print("    Vendor concurrency caps: grok 3, codex 2, claude 3 (lane-queue.sh).")
print("    So a wave wider than ~5 implement lanes cannot all run at once")
print("    regardless of file disjointness; audits are read-only and add 2 more.")
