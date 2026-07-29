#!/usr/bin/env bats
# @description Line-ending + exec-bit policy for bash-executed Foreman files
#   (openspec/changes/crlf-extensionless-hardening). Asserts:
#   (a) every tracked #!.../bash shebang file is LF in the git index (i/lf);
#   (b) working-tree files contain no CR when autocrlf=true OR path eol=lf;
#   (c) the mechanically derived exec-bit inventory is mode 100755 in the index;
#   (d) tracked .bat/.cmd/.ps1 materialised endings match git check-attr eol;
#   (e) tracked PNG blobs stay byte-identical across git add --renormalize.
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
#   Three families, each a pure index pathspec sweep — never a literal path
#   and never a hardcoded count. The SDD scripts directory pathspec picks up
#   extensionless files that a *.sh glob structurally cannot.
# @stdout relative paths, one per line
exec_bit_inventory() {
  {
    git -C "$REPO_ROOT" ls-files \
      'skills/foreman/scripts/**/*.sh' \
      'skills/foreman/scripts/*.sh'
    # Directory pathspec (not *.sh): includes extensionless SDD scripts.
    git -C "$REPO_ROOT" ls-files \
      'skills/superpowers/skills/subagent-driven-development/scripts/*'
    git -C "$REPO_ROOT" ls-files \
      'skills/superpowers/hooks/*'
  } | sort -u
}

# @description Resolve the eol attribute for a path (lf / crlf / unspecified / ...).
# @arg $1 repo-relative path
# @stdout single token
path_eol_attr() {
  git -C "$REPO_ROOT" check-attr eol -- "$1" | awk -F': ' 'END { print $NF }'
}

# @description Return 0 if file bytes match the expected eol convention.
#   crlf: every LF is preceded by CR (no bare LF, no bare CR).
#   lf:   no CR bytes at all.
# @arg $1 absolute or relative file path
# @arg $2 expected eol (lf|crlf)
file_matches_eol() {
  local path="$1" expected="$2"
  python3 - "$path" "$expected" <<'PY'
import sys
path, expected = sys.argv[1], sys.argv[2]
data = open(path, "rb").read()
if expected == "lf":
    sys.exit(0 if (b"\r" not in data) else 1)
if expected == "crlf":
    # Allow empty file; otherwise every \n must be part of \r\n and no bare \r.
    i = 0
    n = len(data)
    while i < n:
        if data[i] == 0x0D:  # CR
            if i + 1 >= n or data[i + 1] != 0x0A:
                sys.exit(1)
            i += 2
            continue
        if data[i] == 0x0A:  # bare LF
            sys.exit(1)
        i += 1
    sys.exit(0)
sys.exit(2)
PY
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

@test "bash-shebang working trees contain no CR when autocrlf=true or path eol=lf" {
  # text eol=lf governs checkout independently of core.autocrlf. Widen beyond
  # autocrlf==true so attribute-forced LF paths (e.g. the three SDD scripts)
  # are checked non-vacuously on this ext4 host as well.
  local autocrlf f eol bad=() checked=0
  autocrlf="$(git -C "$REPO_ROOT" config --get core.autocrlf || true)"

  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    eol="$(path_eol_attr "$f")"
    if [[ "${autocrlf,,}" != "true" && "$eol" != "lf" ]]; then
      continue
    fi
    checked=$((checked + 1))
    if grep -q $'\r' "$REPO_ROOT/$f" 2>/dev/null; then
      bad+=("$f")
      echo "offending: $f (has CR in working tree; autocrlf=${autocrlf:-unset} eol=$eol)" >&2
    fi
  done < <(bash_shebang_files)

  if ((checked == 0)); then
    skip "no candidate files: core.autocrlf is '${autocrlf:-unset}' and no bash-shebang path has eol=lf"
  fi

  if ((${#bad[@]} > 0)); then
    echo "CR bytes in working tree for bash-shebang files under check:" >&2
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
      echo "offending: $f (mode=$mode)" >&2
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

@test "tracked .bat/.cmd/.ps1 line endings match git check-attr eol" {
  # Expectation is driven solely by `git check-attr eol` per path — never by
  # a hardcoded filename. Nested attribute overrides (e.g. a *.cmd eol=lf rule)
  # are honoured automatically because the attribute alone sets the expectation.
  #
  # Materialise via checkout-index into a temp prefix so the assertion sees
  # attribute-smudged checkout bytes (what the policy guarantees) without
  # mutating the live worktree.
  local f eol bad=() checked=0
  local tmp
  tmp="$(mktemp -d "${BATS_TEST_TMPDIR:-/tmp}/win-eol.XXXXXX")"

  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    eol="$(path_eol_attr "$f")"
    case "$eol" in
      lf|crlf) ;;
      *)
        bad+=("$f (eol attribute is '$eol'; expected lf or crlf)")
        echo "offending: $f (eol attribute='$eol')" >&2
        continue
        ;;
    esac
    mkdir -p "$tmp/$(dirname "$f")"
    git -C "$REPO_ROOT" checkout-index -f --prefix="$tmp/" -- "$f"
    if ! file_matches_eol "$tmp/$f" "$eol"; then
      bad+=("$f (materialised endings do not match attr eol=$eol)")
      echo "offending: $f (attr eol=$eol; materialised endings mismatch)" >&2
    fi
    checked=$((checked + 1))
  done < <(git -C "$REPO_ROOT" ls-files '*.bat' '*.cmd' '*.ps1')

  rm -rf "$tmp"

  if ((checked == 0)); then
    echo "no tracked .bat/.cmd/.ps1 files found — Windows carve-out test is vacuous" >&2
    return 1
  fi

  if ((${#bad[@]} > 0)); then
    echo "Windows scripts whose endings disagree with git check-attr eol:" >&2
    printf '  %s\n' "${bad[@]}" >&2
    printf 'offending: %s\n' "${bad[@]}" >&2
    return 1
  fi
}

@test "tracked PNG binary carve-out survives git add --renormalize" {
  # Temporary index only — never touch the real index. Sweep PNGs mechanically.
  local f sha_before sha_after bad=()
  local -a pngs=()
  local tmpidx
  tmpidx="$(mktemp "${BATS_TEST_TMPDIR:-/tmp}/png-idx.XXXXXX")"
  cp "$(git -C "$REPO_ROOT" rev-parse --git-path index)" "$tmpidx"

  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    pngs+=("$f")
  done < <(git -C "$REPO_ROOT" ls-files '*.png')

  if ((${#pngs[@]} == 0)); then
    rm -f "$tmpidx"
    echo "no tracked PNG files found — binary carve-out test is vacuous" >&2
    return 1
  fi

  (
    export GIT_INDEX_FILE="$tmpidx"
    for f in "${pngs[@]}"; do
      sha_before="$(git -C "$REPO_ROOT" ls-files -s -- "$f" | awk '{print $2}')"
      git -C "$REPO_ROOT" add --renormalize -- "$f"
      sha_after="$(git -C "$REPO_ROOT" ls-files -s -- "$f" | awk '{print $2}')"
      if [[ "$sha_before" != "$sha_after" ]]; then
        bad+=("$f (before=$sha_before after=$sha_after)")
        echo "offending: $f (blob SHA changed under renormalize: $sha_before -> $sha_after)" >&2
      fi
    done

    if ((${#bad[@]} > 0)); then
      echo "PNG blobs not byte-identical after git add --renormalize:" >&2
      printf '  %s\n' "${bad[@]}" >&2
      printf 'offending: %s\n' "${bad[@]}" >&2
      exit 1
    fi
  )
  local rc=$?
  rm -f "$tmpidx"
  return "$rc"
}
