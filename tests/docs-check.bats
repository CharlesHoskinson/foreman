#!/usr/bin/env bats
load helpers

setup() {
  setup_tmp_repo
  cd "$REPO" || return
  mkdir -p scripts
}

# @description Normalize a path-like ignore/skip token: strip surrounding
#   whitespace and a single leading "./".
# @arg $1 raw token
# @stdout normalized token
normalize_path_token() {
  local t="$1"
  t="${t#"${t%%[![:space:]]*}"}"
  t="${t%"${t##*[![:space:]]}"}"
  if [[ "$t" == ./* ]]; then
    t="${t#./}"
  fi
  printf '%s' "$t"
}

# @description Return 0 when a normalized path is a forbidden whole-subtree
#   Council root ignore/skip. Reject exact root components/council with or
#   without a trailing slash. Reject any entry whose first path segment after
#   components/council/ starts with "*". Permit a fixed first subpath such as
#   components/council/openspec/changes/** or components/council/packages/*/dist.
# @arg $1 normalized path token
# @return 0 when forbidden, 1 when permitted or not a Council root form
is_forbidden_council_root_path() {
  local norm="$1"
  case "$norm" in
    'components/council'|'components/council/')
      return 0
      ;;
    components/council/*)
      local rest first
      rest="${norm#components/council/}"
      first="${rest%%/*}"
      # First segment begins with a glob wildcard.
      if [[ "$first" == '*'* ]]; then
        return 0
      fi
      return 1
      ;;
  esac
  return 1
}

# @description Return 0 when a markdownlint-cli2 config has no whole-subtree
#   Council ignore entry. Return 1 when a forbidden normalized entry is found.
#   Uses is_forbidden_council_root_path. Permitted fixed-subpath entries such as
#   components/council/openspec/changes/** are not rejected.
#   Fail-closed: parse only the decoded JSONC "ignores" array (not comments,
#   property names, or unrelated property values). Reject malformed JSONC,
#   a missing or non-array ignores member, non-string entries, embedded NUL,
#   parser failure, or temporary-file failure.
# @arg $1 path to .markdownlint-cli2.jsonc (or a temp copy)
markdownlint_council_ignore_ok() {
  local cfg="$1"
  [ -f "$cfg" ] || return 2

  local tmp_ignores
  tmp_ignores="$(mktemp)" || return 2

  # Decode JSONC with stdlib Python only. Emit NUL-delimited ignore values.
  if ! python3 - "$cfg" "$tmp_ignores" <<'PY'
import json
import sys
from pathlib import Path


def strip_jsonc_comments(text: str) -> str:
    """Remove // and /* */ comments only while outside JSON strings.

    Replace each removed comment with whitespace. Preserve newlines so
    token boundaries that a comment separated stay separated. Raise
    ValueError when a /* block has no closing */.
    """
    out: list[str] = []
    i = 0
    n = len(text)
    in_string = False
    escape = False
    while i < n:
        c = text[i]
        if in_string:
            out.append(c)
            if escape:
                escape = False
            elif c == "\\":
                escape = True
            elif c == '"':
                in_string = False
            i += 1
            continue
        if c == '"':
            in_string = True
            out.append(c)
            i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            # Line comment: replace with spaces; keep the newline.
            out.append("  ")
            i += 2
            while i < n and text[i] not in "\n\r":
                out.append(" ")
                i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            # Block comment: replace with whitespace; fail if unclosed.
            start = i
            i += 2
            closed = False
            while i + 1 < n:
                if text[i] == "*" and text[i + 1] == "/":
                    i += 2
                    closed = True
                    break
                i += 1
            if not closed:
                raise ValueError("unterminated block comment")
            for ch in text[start:i]:
                out.append(ch if ch in "\n\r" else " ")
            continue
        out.append(c)
        i += 1
    return "".join(out)


def strip_trailing_commas(text: str) -> str:
    """Remove trailing commas before ] or } only while outside strings."""
    out: list[str] = []
    i = 0
    n = len(text)
    in_string = False
    escape = False
    while i < n:
        c = text[i]
        if in_string:
            out.append(c)
            if escape:
                escape = False
            elif c == "\\":
                escape = True
            elif c == '"':
                in_string = False
            i += 1
            continue
        if c == '"':
            in_string = True
            out.append(c)
            i += 1
            continue
        if c == ",":
            j = i + 1
            while j < n and text[j] in " \t\r\n":
                j += 1
            if j < n and text[j] in "]}":
                i += 1
                continue
        out.append(c)
        i += 1
    return "".join(out)


def main() -> int:
    cfg_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2])
    try:
        raw = cfg_path.read_text(encoding="utf-8")
    except OSError:
        return 2
    try:
        cleaned = strip_trailing_commas(strip_jsonc_comments(raw))

        # JSONC forbids nonstandard numeric constants. Python's default
        # json.loads accepts NaN/Infinity/-Infinity; reject them here via
        # parse_constant so string contents cannot false-trigger.
        def reject_nonstandard_constant(name: str) -> None:
            raise ValueError(f"nonstandard JSON constant: {name}")

        data = json.loads(
            cleaned,
            parse_constant=reject_nonstandard_constant,
        )
    except (json.JSONDecodeError, ValueError, TypeError, RecursionError):
        return 1
    if not isinstance(data, dict):
        return 1
    ignores = data.get("ignores", None)
    if not isinstance(ignores, list):
        return 1
    for item in ignores:
        if not isinstance(item, str):
            return 1
        if "\0" in item:
            return 1
    try:
        with out_path.open("wb") as fh:
            for item in ignores:
                fh.write(item.encode("utf-8"))
                fh.write(b"\0")
    except OSError:
        return 2
    return 0


sys.exit(main())
PY
  then
    rm -f "$tmp_ignores"
    return 1
  fi

  # Open the decoded handoff on a checked FD before any unlink. If the path
  # disappeared after Python returned success, fail closed here — do not let
  # later cleanup or an explicit return 0 mask a failed redirection.
  local entry norm fd
  if ! exec {fd}<"$tmp_ignores"; then
    rm -f "$tmp_ignores"
    return 2
  fi
  # Every path after a successful open must close the descriptor explicitly.
  # Check post-open unlink. On failure, close the FD and return nonzero so
  # set -e, later cleanup, or an explicit return 0 cannot mask the error.
  # Check every close. Do not mask close status with || true.
  if ! rm -f "$tmp_ignores"; then
    if ! exec {fd}<&-; then
      return 2
    fi
    return 2
  fi
  while IFS= read -r -d '' entry || [ -n "$entry" ]; do
    [ -n "$entry" ] || continue
    norm="$(normalize_path_token "$entry")"
    if is_forbidden_council_root_path "$norm"; then
      printf 'FORBIDDEN markdownlint ignore: %s (normalized %s)\n' "$entry" "$norm" >&2
      if ! exec {fd}<&-; then
        return 2
      fi
      return 1
    fi
  done <&"$fd"
  if ! exec {fd}<&-; then
    return 2
  fi
  return 0
}

# @description Run a command with a temporary PATH prefix in this process.
#   PATH is local to this function so bats test subshells do not trigger
#   Shellcheck SC2030/SC2031 across tests. The command still runs in the
#   current shell (not a nested subshell), so descriptor-leak probes that
#   call markdownlint_council_ignore_ok through this helper stay valid.
# @arg $1 directory to prepend to PATH
# @arg $@ command and arguments
with_path_prefix() {
  local prefix="$1"
  shift
  local PATH="$prefix${PATH:+:$PATH}"
  "$@"
}

# @description Restore PATH and TMPDIR after a shimmed test path. Call on
#   every early-return and normal path when the test modified those values
#   in the outer test scope (TMPDIR) or after with_path_prefix returns
#   (PATH was local to the helper and needs no restore).
# @arg $1 saved PATH value
# @arg $2 saved TMPDIR value, or empty when TMPDIR was previously unset
restore_path_tmpdir() {
  PATH="$1"
  if [[ -n "${2}" ]]; then
    export TMPDIR="$2"
  else
    unset TMPDIR
  fi
}

# @description Return 0 when a codespell config skip list has no whole-subtree
#   Council element. Return 1 when a forbidden normalized element is found
#   first, middle, or last. Uses is_forbidden_council_root_path. Lockfile and
#   packages/*/dist paths stay permitted.
# @arg $1 path to .codespellrc (or a temp copy)
codespell_council_skip_ok() {
  local cfg="$1"
  [ -f "$cfg" ] || return 2

  local skip_line value
  skip_line="$(grep -E '^[[:space:]]*skip[[:space:]]*=' "$cfg" || true)"
  [ -n "$skip_line" ] || return 2
  value="${skip_line#*=}"
  value="${value#"${value%%[![:space:]]*}"}"

  local part norm
  IFS=',' read -r -a parts <<<"$value"
  for part in "${parts[@]}"; do
    norm="$(normalize_path_token "$part")"
    if is_forbidden_council_root_path "$norm"; then
      printf 'FORBIDDEN codespell skip: %s (normalized %s)\n' "$part" "$norm" >&2
      return 1
    fi
  done
  return 0
}

@test "docs-check passes on a clean fixture" {
  cat > scripts/good.sh <<'EOF'
#!/usr/bin/env bash
# @description Fixture script that is fully documented.
set -euo pipefail
# @description Say hello.
# @stdout the greeting
hello() { echo hello; }
EOF
  run bash "$SCRIPTS/docs-check.sh" --json out.json
  [ "$status" -eq 0 ]
  grep -q '"status": *"pass"' out.json
}

@test "docs-check fails on undocumented bash function" {
  cat > scripts/bad.sh <<'EOF'
#!/usr/bin/env bash
# @description Fixture with an undocumented function.
set -euo pipefail
mystery() { echo '?'; }
EOF
  run bash "$SCRIPTS/docs-check.sh" --json out.json
  [ "$status" -eq 1 ]
  grep -q 'undocumented function' <<< "$output"
}

@test "docs-check fails on script without purpose header" {
  printf '#!/usr/bin/env bash\nset -euo pipefail\n' > scripts/naked.sh
  run bash "$SCRIPTS/docs-check.sh" --json out.json
  [ "$status" -eq 1 ]
}

@test "docs-check writes machine-readable JSON" {
  run bash "$SCRIPTS/docs-check.sh" --json out.json
  [ -f out.json ]
  grep -q '"schema": *"foreman.docs-check.v1"' out.json
}

@test "docs-check exits 2 when a required tool is force-missing" {
  DOCS_CHECK_FORCE_MISSING=lychee run bash "$SCRIPTS/docs-check.sh"
  [ "$status" -eq 2 ]
}

@test "docs-check fails on raw vendor invocation in agent definition" {
  mkdir -p agents
  cat > agents/bad-agent.md <<'EOF'
# Agent fixture

```bash
codex exec --sandbox workspace-write
```
EOF
  run bash "$SCRIPTS/docs-check.sh" --json out.json
  [ "$status" -eq 1 ]
  grep -q 'raw vendor invocation: agents/bad-agent.md:4:' <<< "$output"
  grep -A2 '"agent-invocations"' out.json | grep -q '"status": *"fail"'
}

# Real checkout configs (not the throwaway fixture). Fail-capable assertions for
# the nested Council docs-gate exclusions required after the subtree import.
@test "markdownlint excludes nested council openspec changes not whole subtree" {
  local cfg
  cfg="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/.markdownlint-cli2.jsonc"
  [ -f "$cfg" ]
  local text
  text="$(cat "$cfg")"

  # Nested OpenSpec change records: same class as root openspec/changes/**.
  [[ "$text" == *'"components/council/openspec/changes/**"'* ]] \
    || [[ "$text" == *'components/council/openspec/changes/**'* ]]

  # Guard must pass on the real root config (narrow subpaths only).
  run markdownlint_council_ignore_ok "$cfg"
  [ "$status" -eq 0 ]
}

@test "markdownlint guard rejects injected whole-subtree council ignores" {
  local real_cfg tmp entry
  real_cfg="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/.markdownlint-cli2.jsonc"
  [ -f "$real_cfg" ]

  local -a forbidden=(
    'components/council'
    'components/council/'
    'components/council/*'
    'components/council/**'
    'components/council/**/*'
    'components/council/**/*.md'
    'components/council/*.md'
    'components/council/**/**'
    'components/council/**/README.md'
    './components/council'
    './components/council/'
    './components/council/*'
    './components/council/**'
    './components/council/**/*'
    './components/council/**/*.md'
    './components/council/*.md'
    './components/council/**/**'
    './components/council/**/README.md'
  )

  for entry in "${forbidden[@]}"; do
    tmp="$(mktemp "${BATS_TEST_TMPDIR}/mdlint-XXXXXX.jsonc")"
    # Copy real config, then inject the forbidden ignore as the first ignores entry.
    python3 - "$real_cfg" "$tmp" "$entry" <<'PY'
import sys
from pathlib import Path
src, dst, entry = sys.argv[1], sys.argv[2], sys.argv[3]
text = Path(src).read_text(encoding="utf-8")
needle = '"ignores": ['
assert needle in text, "ignores array missing"
text = text.replace(needle, needle + f'\n    "{entry}",', 1)
Path(dst).write_text(text, encoding="utf-8")
PY
    # Same guard used on the real config must return nonzero.
    run markdownlint_council_ignore_ok "$tmp"
    [ "$status" -ne 0 ]
    rm -f "$tmp"
  done
}

@test "codespell skips council lockfile and package dist not whole subtree" {
  local cfg
  cfg="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/.codespellrc"
  [ -f "$cfg" ]
  local text
  text="$(cat "$cfg")"

  # Narrow skips measured by the root docs gate against the imported subtree.
  [[ "$text" == *"components/council/pnpm-lock.yaml"* ]]
  [[ "$text" == *"components/council/packages/*/dist"* ]]

  # Guard must pass on the real root config (narrow subpaths only).
  run codespell_council_skip_ok "$cfg"
  [ "$status" -eq 0 ]
}

@test "codespell guard rejects injected whole-subtree council skips" {
  local real_cfg tmp spelling
  real_cfg="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/.codespellrc"
  [ -f "$real_cfg" ]

  local -a forbidden=(
    'components/council'
    'components/council/'
    'components/council/*'
    'components/council/**'
    'components/council/**/*'
    'components/council/**/*.md'
    'components/council/*.md'
    'components/council/**/**'
    'components/council/**/README.md'
    './components/council'
    './components/council/'
    './components/council/*'
    './components/council/**'
    './components/council/**/*'
    './components/council/**/*.md'
    './components/council/*.md'
    './components/council/**/**'
    './components/council/**/README.md'
  )

  for spelling in "${forbidden[@]}"; do
    # Last element (no trailing comma) — the weak-predicate miss class.
    tmp="$(mktemp "${BATS_TEST_TMPDIR}/codespell-last-XXXXXX.rc")"
    sed "s|^\\([[:space:]]*skip[[:space:]]*=[[:space:]]*\\)\\(.*\\)$|\\1\\2,${spelling}|" \
      "$real_cfg" > "$tmp"
    run codespell_council_skip_ok "$tmp"
    [ "$status" -ne 0 ]
    rm -f "$tmp"

    # First element.
    tmp="$(mktemp "${BATS_TEST_TMPDIR}/codespell-first-XXXXXX.rc")"
    sed "s|^\\([[:space:]]*skip[[:space:]]*=[[:space:]]*\\)\\(.*\\)$|\\1${spelling},\\2|" \
      "$real_cfg" > "$tmp"
    run codespell_council_skip_ok "$tmp"
    [ "$status" -ne 0 ]
    rm -f "$tmp"

    # Middle element (after first comma).
    tmp="$(mktemp "${BATS_TEST_TMPDIR}/codespell-mid-XXXXXX.rc")"
    sed "s|^\\([[:space:]]*skip[[:space:]]*=[[:space:]]*[^,]*\\),\\(.*\\)$|\\1,${spelling},\\2|" \
      "$real_cfg" > "$tmp"
    run codespell_council_skip_ok "$tmp"
    [ "$status" -ne 0 ]
    rm -f "$tmp"
  done
}

@test "markdownlint guard rejects JSONC-escaped whole-subtree ignores" {
  local real_cfg tmp entry
  real_cfg="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/.markdownlint-cli2.jsonc"
  [ -f "$real_cfg" ]

  # Raw JSONC string sources (not decoded path text). After JSONC decode these
  # yield components/council/** or ./components/council/**.
  local -a escaped_forbidden=(
    'components\/council\/**'
    'components/council/\u002a\u002a'
    './components\/council\/\u002a\u002a'
  )

  for entry in "${escaped_forbidden[@]}"; do
    tmp="$(mktemp "${BATS_TEST_TMPDIR}/mdlint-esc-XXXXXX.jsonc")"
    python3 - "$real_cfg" "$tmp" "$entry" <<'PY'
import sys
from pathlib import Path
src, dst, entry = sys.argv[1], sys.argv[2], sys.argv[3]
text = Path(src).read_text(encoding="utf-8")
needle = '"ignores": ['
assert needle in text, "ignores array missing"
# Inject entry as raw JSON string source (escapes stay as JSON source text).
text = text.replace(needle, needle + f'\n    "{entry}",', 1)
Path(dst).write_text(text, encoding="utf-8")
PY
    run markdownlint_council_ignore_ok "$tmp"
    [ "$status" -ne 0 ]
    rm -f "$tmp"
  done
}

@test "markdownlint guard ignores prohibited-looking text outside ignores" {
  local real_cfg tmp
  real_cfg="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/.markdownlint-cli2.jsonc"
  [ -f "$real_cfg" ]

  # JSONC comment containing the quoted prohibited text, outside ignores.
  tmp="$(mktemp "${BATS_TEST_TMPDIR}/mdlint-comment-XXXXXX.jsonc")"
  python3 - "$real_cfg" "$tmp" <<'PY'
import sys
from pathlib import Path
src, dst = sys.argv[1], sys.argv[2]
text = Path(src).read_text(encoding="utf-8")
comment = '// outside ignores: "components/council/**"\n'
Path(dst).write_text(comment + text, encoding="utf-8")
PY
  run markdownlint_council_ignore_ok "$tmp"
  [ "$status" -eq 0 ]
  rm -f "$tmp"

  # Unrelated top-level string property whose value is the prohibited path.
  tmp="$(mktemp "${BATS_TEST_TMPDIR}/mdlint-prop-XXXXXX.jsonc")"
  python3 - "$real_cfg" "$tmp" <<'PY'
import sys
from pathlib import Path
src, dst = sys.argv[1], sys.argv[2]
text = Path(src).read_text(encoding="utf-8")
# Insert a decoy top-level string property before "ignores".
needle = '"ignores": ['
assert needle in text, "ignores array missing"
prop = '"decoy_unrelated": "components/council/**",\n  '
text = text.replace(needle, prop + needle, 1)
Path(dst).write_text(text, encoding="utf-8")
PY
  run markdownlint_council_ignore_ok "$tmp"
  [ "$status" -eq 0 ]
  rm -f "$tmp"
}

@test "markdownlint guard fails closed on malformed JSONC comments" {
  local tmp

  # Complete top-level object with ignores, then an unterminated /* comment.
  # Current stripper silently discards the malformed suffix and returns success.
  tmp="$(mktemp "${BATS_TEST_TMPDIR}/mdlint-unterminated-XXXXXX.jsonc")"
  printf '%s\n' '{ "ignores": [] } /* unterminated block' > "$tmp"
  run markdownlint_council_ignore_ok "$tmp"
  [ "$status" -ne 0 ]
  rm -f "$tmp"

  # Numeric decoy tokens separated by a closed block comment must not become 12.
  tmp="$(mktemp "${BATS_TEST_TMPDIR}/mdlint-concat-XXXXXX.jsonc")"
  printf '%s\n' '{ "decoy": 1/* comment */2, "ignores": [] }' > "$tmp"
  run markdownlint_council_ignore_ok "$tmp"
  [ "$status" -ne 0 ]
  rm -f "$tmp"
}

@test "markdownlint guard rejects nonstandard JSON numeric constants" {
  local tmp token

  for token in NaN Infinity -Infinity; do
    tmp="$(mktemp "${BATS_TEST_TMPDIR}/mdlint-constant-XXXXXX.jsonc")"
    printf '{ "decoy": %s, "ignores": [] }\n' "$token" > "$tmp"
    run markdownlint_council_ignore_ok "$tmp"
    [ "$status" -ne 0 ]
    rm -f "$tmp"
  done
}

@test "markdownlint guard fails closed when decoded handoff disappears" {
  local real_cfg tmp real_python shim_dir old_path
  real_cfg="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/.markdownlint-cli2.jsonc"
  tmp="$(mktemp "${BATS_TEST_TMPDIR}/mdlint-handoff-XXXXXX.jsonc")"
  cp "$real_cfg" "$tmp"

  real_python="$(command -v python3)"
  shim_dir="${BATS_TEST_TMPDIR}/handoff-bin"
  mkdir -p "$shim_dir"
  cat > "$shim_dir/python3" <<'SH'
#!/usr/bin/env bash
set -u
"${REAL_PYTHON:?}" "$@"
rc=$?
if [[ "$rc" -eq 0 && "${1:-}" == "-" && $# -ge 3 ]]; then
  rm -f -- "$3"
fi
exit "$rc"
SH
  chmod +x "$shim_dir/python3"

  # PATH is scoped inside with_path_prefix (local). Capture and restore the
  # outer value explicitly on the normal path for auditability.
  old_path="$PATH"
  export REAL_PYTHON="$real_python"
  with_path_prefix "$shim_dir" run markdownlint_council_ignore_ok "$tmp"
  restore_path_tmpdir "$old_path" "${TMPDIR-}"
  unset REAL_PYTHON

  [ "$status" -ne 0 ]
  rm -f "$tmp"
}

@test "markdownlint guard fails closed when post-open handoff unlink fails" {
  local real_cfg tmp real_rm shim_dir controlled_tmp
  local old_path old_tmpdir status expected_fd reused_fd probe_fd
  local helper_body

  real_cfg="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/.markdownlint-cli2.jsonc"
  tmp="$(mktemp "${BATS_TEST_TMPDIR}/mdlint-unlink-XXXXXX.jsonc")"
  cp "$real_cfg" "$tmp"

  # Own TMPDIR so the helper handoff path is known and controllable.
  # Create first, then set mode (SC2174: -m with -p only affects the leaf).
  controlled_tmp="${BATS_TEST_TMPDIR}/handoff-unlink-tmp"
  mkdir -p "$controlled_tmp"
  chmod 700 "$controlled_tmp"

  # Capture the real rm before the shim is first on PATH. The shim fails only
  # the decoded handoff unlink and delegates every other call as argv data.
  real_rm="$(command -v rm)"
  shim_dir="${BATS_TEST_TMPDIR}/unlink-fail-bin"
  mkdir -p "$shim_dir"
  cat > "$shim_dir/rm" <<'SH'
#!/usr/bin/env bash
set -u
# Fail only when unlinking a path under CONTROLLED_TMP (the handoff dir).
# Treat every argv element as data. Do not interpret paths as shell code.
for arg in "$@"; do
  case "$arg" in
    -*) continue ;;
  esac
  case "$arg" in
    "${CONTROLLED_TMP:?}"|"${CONTROLLED_TMP}"/*)
      printf 'rm-shim: refusing handoff unlink: %s\n' "$arg" >&2
      exit 1
      ;;
  esac
done
exec "${REAL_RM:?}" "$@"
SH
  chmod +x "$shim_dir/rm"

  # Fail-capable structure: post-open closes must not mask errors with || true.
  helper_body="$(awk '/^markdownlint_council_ignore_ok\(\)/,/^}/' \
    "$BATS_TEST_FILENAME")"
  if grep -qE 'exec \{fd\}<&-[[:space:]]*\|\|[[:space:]]*true' \
    <<<"$helper_body"; then
    printf 'masked descriptor close found in helper\n' >&2
    rm -f "$tmp"
    return 1
  fi

  # PATH stays outer until with_path_prefix (local PATH). TMPDIR is set here
  # so the helper handoff lands under the controlled directory.
  old_path="$PATH"
  old_tmpdir="${TMPDIR-}"
  export REAL_RM="$real_rm"
  export CONTROLLED_TMP="$controlled_tmp"
  export TMPDIR="$controlled_tmp"

  # Bash-only descriptor probe. Record the next free dynamic FD, close it,
  # run the helper, then open again. A leaked handoff FD forces a new number.
  # No /proc, lsof, fuser, or host-specific command.
  if ! exec {probe_fd}</dev/null; then
    restore_path_tmpdir "$old_path" "$old_tmpdir"
    unset REAL_RM CONTROLLED_TMP
    rm -rf -- "$controlled_tmp"
    rm -f "$tmp"
    return 1
  fi
  expected_fd=$probe_fd
  if ! exec {probe_fd}<&-; then
    restore_path_tmpdir "$old_path" "$old_tmpdir"
    unset REAL_RM CONTROLLED_TMP
    rm -rf -- "$controlled_tmp"
    rm -f "$tmp"
    return 1
  fi

  # Call in this shell (not `run`) via with_path_prefix so a leaked handoff
  # FD remains in this process. PATH is local to with_path_prefix.
  status=0
  with_path_prefix "$shim_dir" markdownlint_council_ignore_ok "$tmp" \
    || status=$?

  restore_path_tmpdir "$old_path" "$old_tmpdir"
  unset REAL_RM CONTROLLED_TMP

  # Nonzero: failed post-open unlink must not report success.
  if [[ "$status" -eq 0 ]]; then
    rm -rf -- "$controlled_tmp"
    rm -f "$tmp"
    return 1
  fi

  # Descriptor reuse: the new probe must receive the recorded number.
  if ! exec {probe_fd}</dev/null; then
    rm -rf -- "$controlled_tmp"
    rm -f "$tmp"
    return 1
  fi
  reused_fd=$probe_fd
  if ! exec {probe_fd}<&-; then
    rm -rf -- "$controlled_tmp"
    rm -f "$tmp"
    return 1
  fi
  if [[ "$reused_fd" -ne "$expected_fd" ]]; then
    printf 'descriptor leak: expected fd %s, reused %s\n' \
      "$expected_fd" "$reused_fd" >&2
    rm -rf -- "$controlled_tmp"
    rm -f "$tmp"
    return 1
  fi

  rm -rf -- "$controlled_tmp"
  rm -f "$tmp"
}
