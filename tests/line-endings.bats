#!/usr/bin/env bats
# @description Line-ending + exec-bit policy for bash-executed Foreman files
#   (openspec/changes/crlf-extensionless-hardening). Asserts:
#   (a) every tracked #!.../bash shebang file is LF in the git index (i/lf);
#   (b) on autocrlf=true checkouts, those working-tree files contain no CR;
#   (c) the mechanically derived exec-bit inventory is mode 100755 in the index.
#   Inventory is derived, never a hardcoded count (decision D1).
load helpers

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"

# @description List tracked files whose first line is a bash shebang (any ext).
# @stdout relative paths, one per line
bash_shebang_files() {
  local f first
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    first="$(head -n 1 "$REPO_ROOT/$f" 2>/dev/null || true)"
    if [[ "$first" == '#!'*bash* ]]; then
      printf '%s\n' "$f"
    fi
  done < <(git -C "$REPO_ROOT" ls-files)
}

# @description Mechanically derive the direct-exec inventory (D1 / BRIEF 3b).
#   Reproduces: skills/foreman/scripts/**/*.sh + 3 SDD extensionless scripts
#   + skills/superpowers/hooks/* — never a literal count.
# @stdout relative paths, one per line
exec_bit_inventory() {
  {
    git -C "$REPO_ROOT" ls-files 'skills/foreman/scripts/**/*.sh' 'skills/foreman/scripts/*.sh'
    # Explicit extensionless SDD scripts (no extension; glob alone misses them)
    for f in \
      skills/superpowers/skills/subagent-driven-development/scripts/review-package \
      skills/superpowers/skills/subagent-driven-development/scripts/sdd-workspace \
      skills/superpowers/skills/subagent-driven-development/scripts/task-brief
    do
      if git -C "$REPO_ROOT" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
        printf '%s\n' "$f"
      fi
    done
    git -C "$REPO_ROOT" ls-files 'skills/superpowers/hooks/*'
  } | sort -u
}

@test "every tracked bash-shebang file is LF in the git index (i/lf)" {
  local f eol bad=()
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    # git ls-files --eol: "i/lf    w/lf    attr/...<TAB>path"
    eol="$(git -C "$REPO_ROOT" ls-files --eol -- "$f" 2>/dev/null | head -n1)"
    if [[ "$eol" != i/lf* ]]; then
      bad+=("$f")
      echo "offending: $f (eol report: $eol)" >&2
    fi
  done < <(bash_shebang_files)

  if ((${#bad[@]} > 0)); then
    echo "CRLF/non-LF index blobs for bash-shebang files:" >&2
    printf '  %s\n' "${bad[@]}" >&2
    return 1
  fi
}

@test "on autocrlf=true checkout, bash-shebang working trees contain no CR" {
  local autocrlf f bad=()
  autocrlf="$(git -C "$REPO_ROOT" config --get core.autocrlf || true)"
  # Also treat true when checkout attributes force crlf; the gate is the
  # effective autocrlf setting for this worktree/repo.
  if [[ "${autocrlf,,}" != "true" ]]; then
    skip "core.autocrlf is '${autocrlf:-unset}' (not true); working-tree CR check is non-vacuous only on autocrlf=true checkouts (Git-Bash / shared /mnt/c)"
  fi

  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    if grep -q $'\r' "$REPO_ROOT/$f" 2>/dev/null; then
      bad+=("$f")
    fi
  done < <(bash_shebang_files)

  if ((${#bad[@]} > 0)); then
    echo "CR bytes in working tree for bash-shebang files (autocrlf=true):" >&2
    printf '  %s\n' "${bad[@]}" >&2
    printf 'offending: %s\n' "${bad[@]}" >&2
    return 1
  fi
}

@test "derived exec-bit inventory is mode 100755 in the git index" {
  local f mode bad=()
  local -a inv=()
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    inv+=("$f")
    mode="$(git -C "$REPO_ROOT" ls-files -s -- "$f" | awk '{print $1}')"
    if [[ "$mode" != "100755" ]]; then
      bad+=("$f (mode=$mode)")
    fi
  done < <(exec_bit_inventory)

  # Non-vacuous: inventory must be non-empty (a zero-file pass is a checker bug)
  if ((${#inv[@]} == 0)); then
    echo "exec-bit inventory derivation returned zero files" >&2
    return 1
  fi

  if ((${#bad[@]} > 0)); then
    echo "files in derived exec-bit inventory missing index mode 100755:" >&2
    printf '  %s\n' "${bad[@]}" >&2
    printf 'offending: %s\n' "${bad[@]}" >&2
    return 1
  fi
}
