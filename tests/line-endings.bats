#!/usr/bin/env bats
# @description Line-ending + exec-bit policy for bash-executed Foreman files
#   (openspec/changes/crlf-extensionless-hardening). Asserts:
#   (a) every tracked #!.../bash shebang file is LF in the git index (i/lf);
#   (b) working-tree files contain no CR when autocrlf=true OR path eol=lf;
#   (c) the property-derived exec-bit inventory is mode 100755 in the index;
#   (d) Windows carve-out present (eol=crlf on .ps1/.bat) + materialised match;
#   (e) *.png binary present (check-attr) + renormalize-stable incl. NUL-free probe.
#   Inventory is derived by shebang property under Foreman-owned trees (plus a
#   deliberate hooks directory sweep), never a hardcoded count (decision D1).
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
#   Property-based over Foreman-owned trees: every tracked path whose index
#   blob starts with a bash shebang — no extension filter. That covers
#   extensionless scripts under skills/foreman/scripts/ (and lib/), SDD,
#   install.sh, env/, and tests/probes/, and naturally excludes non-exec data
#   such as skills/foreman/scripts/adapters/verdict.schema.json.
#   Shebang is read from the INDEX blob (git show :path), so GIT_INDEX_FILE
#   experiments that only mutate the index are visible to the inventory.
#   Hooks remain a deliberate directory sweep (see below) — not accidental.
# @stdout relative paths, one per line
exec_bit_inventory() {
  local f first
  {
    while IFS= read -r f; do
      [[ -n "$f" ]] || continue
      # Index blob, not worktree — respects GIT_INDEX_FILE.
      first="$(git -C "$REPO_ROOT" show ":$f" 2>/dev/null | head -n 1 || true)"
      if [[ "$first" == '#!'*bash* ]]; then
        printf '%s\n' "$f"
      fi
    done < <(git -C "$REPO_ROOT" ls-files \
      'skills/foreman/scripts/*' \
      'skills/superpowers/skills/subagent-driven-development/scripts/*' \
      'install.sh' \
      'env/*' \
      'tests/probes/*')
    # Hooks directory: deliberate directory sweep, NOT the shebang property.
    # Cursor/Claude hook installers package every file under hooks/ for direct
    # exec / copy-as-hook use; hooks.json and hooks-cursor.json ship at 100755
    # as part of that bundle (and run-hook.cmd is a polyglot with no bash
    # shebang). Sweeping by property alone would drop the non-bash members
    # without a separate decision — keep the whole directory by design.
    git -C "$REPO_ROOT" ls-files 'skills/superpowers/hooks/*'
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
  # Two independent predicates:
  #   (1) Carve-out presence/effect: tracked .ps1 and .bat must resolve
  #       eol=crlf literally. Deleting `*.ps1 text eol=crlf` (or *.bat) from
  #       .gitattributes flips check-attr to lf via `* text=auto eol=lf` and
  #       fails here even when checkout-index and check-attr stay consistent.
  #       (.cmd is NOT hard-asserted to crlf: nested skills/superpowers
  #       overrides set run-hook.cmd to eol=lf by design.)
  #   (2) Materialisation match: checkout-index bytes match the resolved eol
  #       (nested overrides honoured automatically — no filename special-case).
  local f eol bad=() checked=0 ps1_or_bat=0
  local tmp
  tmp="$(mktemp -d "${BATS_TEST_TMPDIR:-/tmp}/win-eol.XXXXXX")"

  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    eol="$(path_eol_attr "$f")"

    # (1) Root Windows carve-out must be present and effective for .ps1/.bat.
    case "$f" in
      *.ps1|*.bat)
        ps1_or_bat=$((ps1_or_bat + 1))
        if [[ "$eol" != "crlf" ]]; then
          bad+=("$f (Windows carve-out requires eol=crlf; got '$eol')")
          echo "offending: $f (Windows carve-out requires eol=crlf; got '$eol')" >&2
          continue
        fi
        ;;
    esac

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

  if ((ps1_or_bat == 0)); then
    echo "no tracked .bat/.ps1 files — cannot assert Windows eol=crlf carve-out" >&2
    return 1
  fi

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
  # Temporary index only — never touch the real index.
  #
  # Tracked PNGs in this corpus all contain NUL bytes, so text=auto classifies
  # them binary by heuristic whether or not `*.png binary` exists. Renormalize
  # stability of those blobs alone is therefore vacuous for the carve-out.
  #
  # Two non-vacuous predicates:
  #   (1) Rule presence: git check-attr binary is literally "set" for each
  #       tracked PNG. Deleting `*.png binary` flips this to unspecified.
  #   (2) Rule effect: a NUL-free CRLF probe matching *.png is added to a temp
  #       index; with the carve-out, renormalize keeps its blob SHA. Without
  #       the carve-out, text=auto + eol=lf rewrites CRLF→LF and the SHA moves
  #       (auditor break 5B).
  # Latent gap (stated, not silently ignored): *.jpg *.jpeg *.ico *.pdf *.exe
  # are in the same .gitattributes rule and the spec, but no such files are
  # tracked today, so they are not exercised by this test.
  local f sha_before sha_after bad=() bin_attr
  local -a pngs=()
  local tmpidx probe_path probe_blob probe_wt rc=0
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

  # (1) Rule presence on every tracked PNG (independent of NUL heuristic).
  for f in "${pngs[@]}"; do
    bin_attr="$(git -C "$REPO_ROOT" check-attr binary -- "$f" | awk -F': ' 'END { print $NF }')"
    if [[ "$bin_attr" != "set" ]]; then
      bad+=("$f (binary attribute is '$bin_attr'; expected set)")
      echo "offending: $f (binary attribute='$bin_attr'; *.png binary carve-out missing or ineffective)" >&2
    fi
  done

  # (2) NUL-free probe under a temp index. Worktree probe lives only for the
  # duration of renormalize and is always removed.
  probe_path="assets/zz-nul-free-probe.png"
  probe_wt="$(mktemp "${BATS_TEST_TMPDIR:-/tmp}/png-probe.XXXXXX")"
  # CRLF, no NUL — susceptible to text=auto eol=lf conversion if not binary.
  printf 'PNG-PROBE-NOT-BINARY-HEURISTIC\r\nline-two\r\n' >"$probe_wt"
  mkdir -p "$REPO_ROOT/$(dirname "$probe_path")"
  cp "$probe_wt" "$REPO_ROOT/$probe_path"

  export GIT_INDEX_FILE="$tmpidx"
  probe_blob="$(git -C "$REPO_ROOT" hash-object -w --no-filters -- "$probe_wt")"
  git -C "$REPO_ROOT" update-index --add --cacheinfo "100644,${probe_blob},${probe_path}"

  for f in "${pngs[@]}" "$probe_path"; do
    sha_before="$(git -C "$REPO_ROOT" ls-files -s -- "$f" | awk '{print $2}')"
    git -C "$REPO_ROOT" add --renormalize -- "$f"
    sha_after="$(git -C "$REPO_ROOT" ls-files -s -- "$f" | awk '{print $2}')"
    if [[ "$sha_before" != "$sha_after" ]]; then
      bad+=("$f (before=$sha_before after=$sha_after)")
      echo "offending: $f (blob SHA changed under renormalize: $sha_before -> $sha_after)" >&2
    fi
  done

  unset GIT_INDEX_FILE
  rm -f "$tmpidx" "$probe_wt" "$REPO_ROOT/$probe_path"

  if ((${#bad[@]} > 0)); then
    echo "PNG binary carve-out check failed:" >&2
    printf '  %s\n' "${bad[@]}" >&2
    printf 'offending: %s\n' "${bad[@]}" >&2
    return 1
  fi
}
