#!/usr/bin/env bash
# @description Shared bats helpers: throwaway git repo + isolated FOREMAN_HOME.
set -euo pipefail

# This host's Windows jq.exe emits CRLF, so bats keeps a trailing CR on each
# element of ${lines[@]} when a test parses multi-line jq output, breaking
# string equality. Wrap jq for the TEST environment only (not the shipped
# library) to strip CR. Stripping CR from jq text output is always safe.
if command -v jq >/dev/null 2>&1; then
  _f="${BATS_RUN_TMPDIR:-${BATS_TMPDIR:-/tmp}}/.foreman_jq_crlf"
  if [[ ! -f "$_f" ]]; then
    # Sentinel byte after jq's output: command substitution on this host strips
    # a trailing CRLF as a unit (not just the trailing \n), so a bare
    # "$(printf '{}' | jq -c .)" always loses the very CR it's testing for.
    # Appending a non-newline byte keeps jq's CRLF from being the trailing
    # bytes, so it survives capture intact.
    _probe="$(printf '{}' | jq -c .; printf x)"
    if [[ "$_probe" == *$'\r'* ]]; then _v=1; else _v=0; fi
    # Trailing newline required: under `set -e`, `read` on a file with no
    # final newline returns 1 (EOF-terminated read), which would trip errexit.
    printf '%s\n' "$_v" > "$_f.$$" && mv -f "$_f.$$" "$_f"   # atomic publish
  fi
  read -r _crlf < "$_f"
  if [[ "$_crlf" == 1 ]]; then
    export _REAL_JQ="$(type -P jq)"
    jq() { "$_REAL_JQ" "$@" | tr -d '\r'; }
    export -f jq
  fi
fi

# @description Create a disposable git repo and point FOREMAN_HOME at test tmp.
# @set REPO absolute path of the throwaway repo
# @set SCRIPTS absolute path of skills/foreman/scripts in the real checkout
# @set FOREMAN_HOME isolated run-state dir under bats tmp
setup_tmp_repo() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/foreman-home"
  mkdir -p "$FOREMAN_HOME"
  REPO="$BATS_TEST_TMPDIR/repo"
  local tpl="$BATS_FILE_TMPDIR/repo-tpl"
  if [[ ! -d "$tpl" ]]; then                 # built once per file
    mkdir -p "$tpl"
    git -C "$tpl" init -q -b main
    git -C "$tpl" config user.email test@example.com
    git -C "$tpl" config user.name "Foreman Test"
    echo "# fixture" > "$tpl/README.md"
    git -C "$tpl" -c core.hooksPath= add README.md
    git -C "$tpl" -c core.hooksPath= commit -qm init
    cp "$BATS_TEST_DIRNAME/../.markdownlint-cli2.jsonc" "$tpl/"
    cp "$BATS_TEST_DIRNAME/../.codespellrc" "$tpl/"
  fi
  cp -r "$tpl" "$REPO"
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"   # B#3: no cd&&pwd
  export REPO SCRIPTS
}
