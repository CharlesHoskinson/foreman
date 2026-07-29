#!/usr/bin/env bats
# @description Line-ending + exec-bit policy for bash-executed Foreman files
#   (openspec/changes/crlf-extensionless-hardening). Asserts:
#   (a) every tracked #!.../bash shebang file is LF in the git index (i/lf);
#   (b) working-tree files contain no CR when autocrlf=true OR path eol=lf;
#   (c) the property-derived exec-bit inventory is mode 100755 in the index;
#   (d) Windows carve-out present (eol=crlf on .ps1/.bat/.cmd) + materialised match;
#   (e) *.png binary present (check-attr) + renormalize-stable incl. NUL-free probe.
#   Inventory is derived by WHOLE-REPO shebang property on index blobs, then a
#   short documented PATTERN exclusion list (decision D11). Inclusion lists of
#   regions are forbidden — any new shebang script is covered by default.
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
#   Invokes git from Python (not a bash pipeline) so large blobs never
#   SIGPIPE under `set -o pipefail` (helpers.bash) when only the first
#   line is needed — a whole-repo sweep must touch PNG/binary blobs too.
# @arg $1 blob OID
# @stdout first line (CR stripped, NULs truncated for bash safety), may be empty
# @return 0 on success, non-zero if the object cannot be read
_index_blob_first_line() {
  local oid="$1"
  python3 -c '
import subprocess, sys
repo, oid = sys.argv[1], sys.argv[2]
try:
    data = subprocess.check_output(
        ["git", "-C", repo, "cat-file", "blob", oid],
        stderr=subprocess.DEVNULL,
    )
except (subprocess.CalledProcessError, FileNotFoundError):
    sys.exit(1)
if not data:
    sys.exit(0)
line = data.split(b"\n", 1)[0].rstrip(b"\r")
# Bash command substitution cannot carry NUL; truncate at first NUL and cap.
line = line.split(b"\0", 1)[0][:4096]
sys.stdout.buffer.write(line)
' "$REPO_ROOT" "$oid"
}

# @description Documented PATTERN exclusion list for the whole-repo exec-bit
#   inventory (decision D11). Escaping coverage requires deliberately adding a
#   PATTERN here with a one-line reason. Patterns only — no filename
#   enumeration (except the single documented suite runner tests/run.sh).
#
#   Format of each entry (after optional '# comment' lines):
#     pattern|one-line reason
#   Pattern language (matched against the full repo-relative path):
#     literal/path        — exact path match
#     some/prefix/**      — prefix tree (fnmatch; * crosses '/')
#     skills/.../*/x/**   — single-segment wildcards allowed
#     *.bash              — suffix / extension match
#   The '|' reason is documentation only and is stripped before matching.
#
# @stdout exclusion entries, one per line (pattern|reason)
_exec_bit_exclusion_entries() {
  cat <<'EOF'
# D11 — pattern exclusions (every entry is a PATTERN + reason; not a file list).
sandbox/**|modes set by Dockerfile RUN chmod 0755 at image build
skills/superpowers/tests/**|test scripts invoked via bash/sh by their runners
skills/superpowers/scripts/**|documented bash scripts/<name> invocations
skills/superpowers/skills/brainstorming/scripts/**|documented sh skills/brainstorming/scripts/<name> invocations
*.bash|sourced helpers, never executed
# Single documented file exception (suite runner is always bash-invoked):
tests/run.sh|the suite runner, invoked as bash tests/run.sh
EOF
}

# @description Return 0 if path matches a documented exclusion PATTERN.
# @arg $1 repo-relative path
_exec_bit_excluded() {
  local f="$1" entry path_part
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    [[ "$entry" == \#* ]] && continue
    path_part="${entry%%|*}"
    path_part="${path_part%"${path_part##*[![:space:]]}"}" # rtrim
    path_part="${path_part#"${path_part%%[![:space:]]*}"}" # ltrim
    [[ -n "$path_part" ]] || continue
    # Case-sensitive pathname match (fnmatch semantics: * crosses '/').
    # shellcheck disable=SC2254
    case "$f" in
      $path_part) return 0 ;;
    esac
  done < <(_exec_bit_exclusion_entries)
  return 1
}

# @description Mechanically derive the direct-exec inventory (D1 / D11).
#   WHOLE-REPOSITORY sweep — not a closed list of regions:
#     git ls-files -s
#   For every tracked entry:
#     - Consider only regular blobs (100644/100755); exclude symlinks (120000)
#       and gitlinks (160000) structurally before reading content.
#     - Include any whose index blob's first line is a bash shebang.
#     - Subtract the short documented PATTERN exclusion list
#       (_exec_bit_exclusion_entries / D11).
#
#   One code path only (REWORK F1): type filter, object existence, and first-line
#   read apply to every candidate — no separate hooks branch that bypasses them.
#
#   Object-read failure is a hard error (diagnostic naming the path) — never a
#   silent "not a script". Shebang is read from the INDEX blob by OID, so
#   GIT_INDEX_FILE experiments that only mutate the index are visible.
#
#   Implementation: one Python process + `git cat-file --batch` so a 600+ file
#   whole-repo sweep stays sub-second under pipefail (per-blob bash pipelines
#   SIGPIPE on large binaries and take tens of seconds).
# @stdout relative paths, one per line
# @return 0 on success; 1 if a regular-blob object is unreadable
exec_bit_inventory() {
  local excl_file rc
  excl_file="$(mktemp "${BATS_TEST_TMPDIR:-/tmp}/exec-excl.XXXXXX")"
  _exec_bit_exclusion_entries >"$excl_file"

  # Python reads REPO_ROOT from argv, exclusion file from argv.
  # Prints matching paths on stdout; errors on stderr; exit 1 on bad objects.
  python3 - "$REPO_ROOT" "$excl_file" <<'PY'
import fnmatch
import subprocess
import sys

repo, excl_path = sys.argv[1], sys.argv[2]

# D11: every exclusion entry is a PATTERN (fnmatch; * crosses '/').
patterns = []
with open(excl_path, "r", encoding="utf-8") as fh:
    for raw in fh:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        path_part = line.split("|", 1)[0].strip()
        if path_part:
            patterns.append(path_part)

def excluded(path: str) -> bool:
    for pat in patterns:
        if fnmatch.fnmatch(path, pat):
            return True
    return False

ls = subprocess.check_output(["git", "-C", repo, "ls-files", "-s"], text=True)
entries = []  # (mode, oid, path)
for line in ls.splitlines():
    if not line:
        continue
    if "\t" in line:
        left, path = line.split("\t", 1)
    else:
        parts = line.split(None, 3)
        if len(parts) < 4:
            continue
        left = " ".join(parts[:3])
        path = parts[3]
    fields = left.split()
    if len(fields) < 3:
        continue
    mode, oid = fields[0], fields[1]
    # Only regular blobs — exclude symlinks (120000) and gitlinks (160000)
    # structurally before any content read.
    if mode not in ("100644", "100755"):
        continue
    if excluded(path):
        continue
    entries.append((mode, oid, path))

if not entries:
    sys.exit(0)

oids = "".join(oid + "\n" for _, oid, _ in entries).encode()
proc = subprocess.run(
    ["git", "-C", repo, "cat-file", "--batch"],
    input=oids,
    capture_output=True,
)
if proc.returncode != 0:
    sys.stderr.write(
        "error: git cat-file --batch failed (rc=%s)\n" % proc.returncode
    )
    sys.exit(1)

raw = proc.stdout
pos = 0
hits = []
for mode, oid, path in entries:
    nl = raw.find(b"\n", pos)
    if nl < 0:
        sys.stderr.write(
            "error: cannot read index object for path: %s (mode=%s oid=%s)\n"
            % (path, mode, oid)
        )
        sys.exit(1)
    header = raw[pos:nl].decode("utf-8", "replace")
    pos = nl + 1
    parts = header.split()
    # missing object: "<oid> missing"
    if len(parts) < 2 or parts[1] == "missing":
        sys.stderr.write(
            "error: cannot read index object for path: %s (mode=%s oid=%s)\n"
            % (path, mode, oid if oid else "empty")
        )
        sys.exit(1)
    if parts[1] != "blob" or len(parts) < 3:
        sys.stderr.write(
            "error: cannot read index object for path: %s (mode=%s oid=%s)\n"
            % (path, mode, oid)
        )
        sys.exit(1)
    try:
        size = int(parts[2])
    except ValueError:
        sys.stderr.write(
            "error: cannot read index object for path: %s (mode=%s oid=%s)\n"
            % (path, mode, oid)
        )
        sys.exit(1)
    data = raw[pos : pos + size]
    pos += size
    if pos < len(raw) and raw[pos : pos + 1] == b"\n":
        pos += 1
    if not data:
        continue
    first = data.split(b"\n", 1)[0].rstrip(b"\r").split(b"\0", 1)[0]
    try:
        s = first.decode("utf-8", "replace")
    except Exception:
        continue
    if s.startswith("#!") and "bash" in s:
        hits.append(path)

for p in sorted(set(hits)):
    print(p)
PY
  rc=$?
  rm -f "$excl_file"
  return "$rc"
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
  # F2: compose with Bats' EXIT trap; never replace it. Replacing silences
  # failure diagnostics ("Executed 0 instead of expected 1 tests") because
  # Bats installs `bats_teardown_trap as-exit-trap` on EXIT for reporting.
  # Chain: our cleanup, then the prior handler command.
  local _png_prev_exit_cmd
  _png_prev_exit_cmd="$(trap -p EXIT 2>/dev/null | sed -n "s/^trap -- '\\(.*\\)' EXIT$/\\1/p")"
  # shellcheck disable=SC2064
  trap "rm -rf $(printf '%q' "$tmpdir"); ${_png_prev_exit_cmd}" EXIT

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
