#!/usr/bin/env bash
# repo-hygiene.sh -- refuse the document debt that accumulated through v0.2.9.
#
# Each rule here exists because the thing it forbids actually happened and cost
# real time. None is a style preference.
#
#   1. Root markdown allowlist. Two lane artifacts were committed to the
#      repository root, so every worktree checkout contained them, and a sweep
#      of 18 worktree roots copied them out as if lane-local -- one template
#      checked in 16 times, 27 redundant files. The root is what arms that gun.
#   2. No state-document sprawl. Four resume/checkpoint documents accumulated at
#      root, all disagreeing; the undated one read as canonical and named a
#      branch dead for days. Status belongs in the session store.
#   3. No byte-identical duplicates under docs/evidence. Archives are sacred;
#      copies of archives are not archives.
#   4. No root file byte-identical to one under docs/. That is rule 1's
#      failure mode caught from the other side.
#
# Exit 0 = clean. Exit 1 = violations, itemised. Exit 2 = cannot run.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || { printf 'ERROR cannot cd to %s\n' "$ROOT" >&2; exit 2; }

command -v git >/dev/null 2>&1 || { printf 'ERROR git not on PATH\n' >&2; exit 2; }

# Markdown permitted at the repository root. Everything else belongs under
# docs/. Keep this list SHORT -- each entry is a claim that the file is a
# doctrine document or a canonical ledger, not a work product.
ALLOWED_ROOT_MD="README.md CLAUDE.md ROADMAP.md RESUME.md AGENT_TRAPS.md bugeventlog.md checklist.md"

violations=0

# @description Report a hygiene violation and mark the run as failed.
# @arg $1 message the violation description; further arguments join with spaces
# @stdout the violation message
fail() { printf 'VIOLATION %s\n' "$*"; violations=$((violations + 1)); }

# --- Rule 1: root markdown allowlist -------------------------------------
while read -r f; do
  [[ -n "$f" ]] || continue
  case " $ALLOWED_ROOT_MD " in
    *" $f "*) ;;
    *) fail "root markdown not in the allowlist: $f -- move it under docs/, or add it to ALLOWED_ROOT_MD in tools/repo-hygiene.sh with a reason" ;;
  esac
done < <(git ls-files -- '*.md' ':!:*/*')

# --- Rule 2: no state-document sprawl ------------------------------------
# RESUME.md itself is allowed by rule 1; what is banned is a SECOND one, and
# any dated snapshot beside it.
while read -r f; do
  [[ -n "$f" ]] || continue
  [[ "$f" == "RESUME.md" ]] && continue
  fail "state-document sprawl: $f -- there is exactly one RESUME.md and it carries no status; put status in the session store and history in devlog/"
done < <(git ls-files -- 'RESUME*.md' 'CHECKPOINT*.md' 'STATE*.md' ':!:*/*')

# One hash->path listing serves rules 3 and 4. Content identity is taken from
# git's own object hash rather than a checksum tool, so it agrees with what the
# repository actually stores and needs no external dependency.
HASHES="$(mktemp)" || { printf 'ERROR cannot create temp file\n' >&2; exit 2; }
trap 'rm -f -- "$HASHES"' EXIT
while IFS= read -r -d '' f; do
  printf '%s\t%s\n' "$(git hash-object "$f")" "$f"
done < <(git ls-files -z -- 'docs/*' '*.md') >"$HASHES"

# --- Rule 3: no byte-identical duplicates under docs/evidence ------------
while read -r h; do
  [[ -n "$h" ]] || continue
  paths="$(awk -F'\t' -v h="$h" '$1==h {printf "%s ", $2}' "$HASHES")"
  fail "duplicate content under docs/evidence: ${paths}-- keep one canonical copy and reference it"
done < <(awk -F'\t' '$2 ~ /^docs\/evidence\// {print $1}' "$HASHES" | sort | uniq -d)

# --- Rule 4: no root file identical to one under docs/ -------------------
while IFS=$'\t' read -r h rf; do
  [[ -n "$h" ]] || continue
  match="$(awk -F'\t' -v h="$h" '$2 ~ /^docs\// {printf "%s ", $2}' <<<"$(awk -F'\t' -v h="$h" '$1==h' "$HASHES")")"
  [[ -n "$match" ]] && fail "root file duplicates documentation: $rf is byte-identical to ${match}-- delete the root copy"
done < <(awk -F'\t' '$2 !~ /\// {print}' "$HASHES")

# --- Rule 5: no file mode regression against the base branch ---------------
# Three times in one session a Windows-side edit silently dropped mode 100755
# to 100644. tests/line-endings.bats catches most of it, but it derives a BASH
# shebang inventory, so a python script (fm-session.py) lost its bit and that
# test still passed.
#
# The check is deliberately a REGRESSION check, not an absolute rule. "A file
# with a shebang must be executable" sounds right and is wrong here: 105 of 189
# tracked shebang files are correctly 100644, because .bats files are run by
# bats rather than executed. Asserting the absolute form would reproduce the
# documented failure where a hand re-derivation flagged 42 files against the
# real checker's one, by ignoring exclusions the real checker documents.
base=""
for candidate in "${FOREMAN_HYGIENE_BASE:-}" origin/main main; do
  [[ -n "$candidate" ]] || continue
  if git rev-parse --verify --quiet "$candidate" >/dev/null; then base="$candidate"; break; fi
done

if [[ -z "$base" ]]; then
  # Absence of a base is reported, never silently treated as clean: a diagnostic
  # that cannot say "I did not run" is the same defect as one that cannot fail.
  printf 'INFO  mode-regression check SKIPPED: no base ref (tried FOREMAN_HYGIENE_BASE, origin/main, main)\n'
else
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    base_mode="$(git ls-tree "$base" -- "$f" | awk '{print $1}')"
    head_mode="$(git ls-files -s -- "$f" | awk '{print $1}')"
    [[ -n "$base_mode" && -n "$head_mode" ]] || continue   # added or deleted
    if [[ "$base_mode" != "$head_mode" ]]; then
      fail "file mode changed vs ${base}: $f ${base_mode} -> ${head_mode} -- if deliberate, say so; if not, git update-index --chmod=+x"
    fi
  done < <(git diff --name-only "$base"...HEAD 2>/dev/null)
fi

if (( violations )); then
  printf '\nREPO HYGIENE FAILED: %d violation(s).\n' "$violations"
  exit 1
fi

printf 'repo-hygiene: clean (root allowlist, no state sprawl, no duplicate evidence)\n'
exit 0
