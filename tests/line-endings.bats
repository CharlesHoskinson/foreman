#!/usr/bin/env bats
# @description Line-ending + exec-bit policy for bash-executed Foreman files
#   (openspec/changes/crlf-extensionless-hardening). Asserts:
#   (a) every tracked #!.../bash shebang file is LF in the git index (i/lf);
#   (b) working-tree files contain no CR when autocrlf=true OR path eol=lf;
#   (c) the property-derived exec-bit inventory is mode 100755 in the index;
#   (d) Windows carve-out present (eol=crlf on .ps1/.bat/.cmd) + materialised match;
#   (e) *.png binary present (check-attr) + renormalize-stable incl. NUL-free probe.
#   Inventory is derived by shebang property under Foreman-owned *regions*
#   (repo root via ':(glob)*', declared directory trees, plus a deliberate
#   hooks directory sweep), never a hardcoded path or count (decision D1).
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

# @description Read the first line of an index blob by OID without NUL warnings.
#   Uses a byte-safe Python reader so binary/NUL blobs do not spam
#   "ignored null byte in input" via bash command substitution.
# @arg $1 blob OID
# @stdout first line (CR stripped), may be empty
# @return 0 on success, non-zero if the object cannot be read
_index_blob_first_line() {
  local oid="$1"
  git -C "$REPO_ROOT" cat-file blob "$oid" | python3 -c '
import sys
data = sys.stdin.buffer.read(8192)
if not data:
    sys.exit(0)
line = data.split(b"\n", 1)[0].rstrip(b"\r")
sys.stdout.buffer.write(line)
'
}

# @description Mechanically derive the direct-exec inventory (D1 / BRIEF 3b).
#   Property-based over Foreman-owned *regions* (not literal path singletons):
#   every tracked regular blob (100644/100755) under those regions whose index
#   blob starts with a bash shebang — no extension filter. That covers
#   extensionless scripts under skills/foreman/scripts/ (and lib/), SDD,
#   repo-root scripts (install.sh and any future root shebang file), env/,
#   and tests/probes/, and naturally excludes non-exec data such as
#   skills/foreman/scripts/adapters/verdict.schema.json.
#
#   Regions (git pathspecs):
#     ':(glob)*'  — repo-root depth-1 only (glob magic does not cross /)
#     skills/foreman/scripts/*
#     skills/superpowers/skills/subagent-driven-development/scripts/*
#     env/*
#     tests/probes/*
#   plus a deliberate hooks directory sweep (see below).
#
#   Symlinks (120000) and gitlinks (160000) are excluded structurally before
#   any content read. Object-read failure is a hard error (diagnostic naming
#   the path) — never a silent "not a script".
#   Shebang is read from the INDEX blob by OID, so GIT_INDEX_FILE experiments
#   that only mutate the index are visible to the inventory.
# @stdout relative paths, one per line
# @return 0 on success; 1 if a regular-blob object is unreadable
exec_bit_inventory() {
  local f mode oid first line
  local out
  out="$(mktemp "${BATS_TEST_TMPDIR:-/tmp}/exec-inv.XXXXXX")"

  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    line="$(git -C "$REPO_ROOT" ls-files -s -- "$f")"
    [[ -n "$line" ]] || continue
    mode="$(awk '{print $1}' <<<"$line")"
    oid="$(awk '{print $2}' <<<"$line")"
    # Only regular blobs — exclude symlinks (120000) and gitlinks (160000)
    # before reading any content.
    case "$mode" in
      100644|100755) ;;
      *) continue ;;
    esac
    if [[ -z "$oid" ]] || ! git -C "$REPO_ROOT" cat-file -e "$oid" 2>/dev/null; then
      echo "error: cannot read index object for path: $f (mode=$mode oid=${oid:-empty})" >&2
      rm -f "$out"
      return 1
    fi
    if ! first="$(_index_blob_first_line "$oid")"; then
      echo "error: cannot read index object for path: $f (mode=$mode oid=$oid)" >&2
      rm -f "$out"
      return 1
    fi
    if [[ "$first" == '#!'*bash* ]]; then
      printf '%s\n' "$f" >>"$out"
    fi
  done < <(git -C "$REPO_ROOT" ls-files \
    ':(glob)*' \
    'skills/foreman/scripts/*' \
    'skills/superpowers/skills/subagent-driven-development/scripts/*' \
    'env/*' \
    'tests/probes/*')

  # Hooks directory: deliberate directory sweep, NOT the shebang property.
  # Cursor/Claude hook installers package every file under hooks/ for direct
  # exec / copy-as-hook use; hooks.json and hooks-cursor.json ship at 100755
  # as part of that bundle (and run-hook.cmd is a polyglot with no bash
  # shebang). Sweeping by property alone would drop the non-bash members
  # without a separate decision — keep the whole directory by design.
  git -C "$REPO_ROOT" ls-files 'skills/superpowers/hooks/*' >>"$out"

  sort -u "$out"
  rm -f "$out"
  return 0
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
  local inv_file
  inv_file="$(mktemp "${BATS_TEST_TMPDIR:-/tmp}/exec-inv-out.XXXXXX")"

  # Call inventory as a real command so object-read failures (return 1) are
  # not discarded by process-substitution status swallowing.
  if ! exec_bit_inventory >"$inv_file"; then
    echo "exec_bit_inventory failed — unreadable index object (see error above)" >&2
    rm -f "$inv_file"
    return 1
  fi

  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    inv+=("$f")
    mode="$(git -C "$REPO_ROOT" ls-files -s -- "$f" | awk '{print $1}')"
    if [[ "$mode" != "100755" ]]; then
      bad+=("$f (mode=$mode)")
      echo "offending: $f (mode=$mode)" >&2
    fi
  done <"$inv_file"
  rm -f "$inv_file"

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
  # Two independent predicate families:
  #
  #   (1) Root Windows carve-out *effect* (independent of checkout-index):
  #       assert resolved eol is literally `crlf` for representative root-scope
  #       pathnames of each of *.bat, *.cmd, *.ps1. These pathnames need not
  #       be tracked — git check-attr evaluates .gitattributes against the
  #       path. Deleting `*.bat text eol=crlf` (etc.) from the root
  #       .gitattributes flips the synthetic path to lf via
  #       `* text=auto eol=lf` and fails here even when materialisation and
  #       check-attr stay consistent with each other.
  #
  #       Deliberate exception is attribute-driven, not a filename special-
  #       case: skills/superpowers/.gitattributes sets `*.cmd text eol=lf`
  #       (polyglot run-hook.cmd). Assert that path resolves to eol=lf.
  #
  #   (2) Materialisation match for every tracked .bat/.cmd/.ps1: checkout-
  #       index bytes match the resolved eol (nested overrides honoured
  #       automatically — no filename special-case in the match loop).
  local f eol bad=() checked=0
  local tmp
  local synth_bat synth_cmd synth_ps1
  tmp="$(mktemp -d "${BATS_TEST_TMPDIR:-/tmp}/win-eol.XXXXXX")"

  # (1) Independent root carve-out assertions (synthetic root-scope paths).
  synth_bat="zz-win-carveout-probe.bat"
  synth_cmd="zz-win-carveout-probe.cmd"
  synth_ps1="zz-win-carveout-probe.ps1"
  for f in "$synth_bat" "$synth_cmd" "$synth_ps1"; do
    eol="$(path_eol_attr "$f")"
    if [[ "$eol" != "crlf" ]]; then
      bad+=("$f (root Windows carve-out requires eol=crlf; got '$eol')")
      echo "offending: $f (root Windows carve-out requires eol=crlf; got '$eol')" >&2
    fi
  done

  # Attribute-driven exception: polyglot under skills/superpowers must be lf.
  f="skills/superpowers/hooks/run-hook.cmd"
  eol="$(path_eol_attr "$f")"
  if [[ "$eol" != "lf" ]]; then
    bad+=("$f (superpowers polyglot override requires eol=lf; got '$eol')")
    echo "offending: $f (superpowers polyglot override requires eol=lf; got '$eol')" >&2
  fi

  # (2) Materialisation match for tracked Windows scripts.
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
    echo "no tracked .bat/.cmd/.ps1 files found — Windows carve-out materialisation test is vacuous" >&2
    return 1
  fi

  if ((${#bad[@]} > 0)); then
    echo "Windows scripts / carve-out probes whose endings disagree with policy:" >&2
    printf '  %s\n' "${bad[@]}" >&2
    printf 'offending: %s\n' "${bad[@]}" >&2
    return 1
  fi
}

@test "tracked PNG binary carve-out survives git add --renormalize" {
  # Fully isolated: disposable clone under $BATS_TEST_TMPDIR. Never touches the
  # live worktree, live index, or live object database. trap cleans every exit.
  #
  # Tracked PNGs in this corpus all contain NUL bytes, so text=auto classifies
  # them binary by heuristic whether or not `*.png binary` exists. Renormalize
  # stability of those blobs alone is therefore vacuous for the carve-out.
  #
  # Two non-vacuous predicates:
  #   (1) Rule presence: git check-attr binary is literally "set" for each
  #       tracked PNG. Deleting `*.png binary` flips this to unspecified.
  #   (2) Rule effect: a NUL-free CRLF probe matching *.png is added inside
  #       the clone only; with the carve-out, renormalize keeps its blob SHA.
  #       Without the carve-out, text=auto + eol=lf rewrites CRLF→LF and the
  #       SHA moves.
  # Latent gap (stated, not silently ignored): *.jpg *.jpeg *.ico *.pdf *.exe
  # are in the same .gitattributes rule and the spec, but no such files are
  # tracked today, so they are not exercised by this test.
  local f sha_before sha_after bad=() bin_attr
  local -a pngs=()
  local tmpdir clone_dir probe_path probe_blob
  local status_before status_after

  tmpdir="$(mktemp -d "${BATS_TEST_TMPDIR:-/tmp}/png-carve.XXXXXX")"
  cleanup_png_test() {
    rm -rf "$tmpdir"
  }
  trap cleanup_png_test EXIT

  status_before="$(git -C "$REPO_ROOT" status --porcelain -uall)"

  clone_dir="$tmpdir/clone"
  # --no-hardlinks: object writes stay inside the clone's odb.
  git clone --no-hardlinks --quiet "$REPO_ROOT" "$clone_dir"

  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    pngs+=("$f")
  done < <(git -C "$clone_dir" ls-files '*.png')

  if ((${#pngs[@]} == 0)); then
    echo "no tracked PNG files found — binary carve-out test is vacuous" >&2
    return 1
  fi

  # (1) Rule presence on every tracked PNG (independent of NUL heuristic).
  for f in "${pngs[@]}"; do
    bin_attr="$(git -C "$clone_dir" check-attr binary -- "$f" | awk -F': ' 'END { print $NF }')"
    if [[ "$bin_attr" != "set" ]]; then
      bad+=("$f (binary attribute is '$bin_attr'; expected set)")
      echo "offending: $f (binary attribute='$bin_attr'; *.png binary carve-out missing or ineffective)" >&2
    fi
  done

  # (2) NUL-free probe — unique path inside the clone only (never assets/).
  probe_path="zz-nul-free-probe-$$.png"
  # CRLF, no NUL — susceptible to text=auto eol=lf conversion if not binary.
  printf 'PNG-PROBE-NOT-BINARY-HEURISTIC\r\nline-two\r\n' >"$clone_dir/$probe_path"
  probe_blob="$(git -C "$clone_dir" hash-object -w --no-filters -- "$clone_dir/$probe_path")"
  git -C "$clone_dir" update-index --add --cacheinfo "100644,${probe_blob},${probe_path}"

  for f in "${pngs[@]}" "$probe_path"; do
    sha_before="$(git -C "$clone_dir" ls-files -s -- "$f" | awk '{print $2}')"
    git -C "$clone_dir" add --renormalize -- "$f"
    sha_after="$(git -C "$clone_dir" ls-files -s -- "$f" | awk '{print $2}')"
    if [[ "$sha_before" != "$sha_after" ]]; then
      bad+=("$f (before=$sha_before after=$sha_after)")
      echo "offending: $f (blob SHA changed under renormalize: $sha_before -> $sha_after)" >&2
    fi
  done

  status_after="$(git -C "$REPO_ROOT" status --porcelain -uall)"
  if [[ "$status_before" != "$status_after" ]]; then
    echo "offending: live repository mutated by PNG carve-out test" >&2
    echo "status before:" >&2
    printf '%s\n' "$status_before" >&2
    echo "status after:" >&2
    printf '%s\n' "$status_after" >&2
    bad+=("live-repo-status-changed")
  fi

  if ((${#bad[@]} > 0)); then
    echo "PNG binary carve-out check failed:" >&2
    printf '  %s\n' "${bad[@]}" >&2
    printf 'offending: %s\n' "${bad[@]}" >&2
    return 1
  fi
}
