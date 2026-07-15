#!/usr/bin/env bash
# @description Shared bats helpers: throwaway git repo + isolated FOREMAN_HOME.
set -euo pipefail

# This host's Windows jq.exe emits CRLF, so bats keeps a trailing CR on each
# element of ${lines[@]} when a test parses multi-line jq output, breaking
# string equality. Wrap jq for the TEST environment only (not the shipped
# library) to strip CR. Stripping CR from jq text output is always safe.
if command -v jq >/dev/null 2>&1 && [[ "$(printf '{}' | jq -c . | od -An -tx1)" == *0d* ]]; then
  export _REAL_JQ="$(type -P jq)"
  jq() { "$_REAL_JQ" "$@" | tr -d '\r'; }
  export -f jq
fi

# @description Create a disposable git repo and point FOREMAN_HOME at test tmp.
# @set REPO absolute path of the throwaway repo
# @set SCRIPTS absolute path of skills/foreman/scripts in the real checkout
# @set FOREMAN_HOME isolated run-state dir under bats tmp
setup_tmp_repo() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/foreman-home"
  mkdir -p "$FOREMAN_HOME"
  REPO="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$REPO"
  git -C "$REPO" init -q -b main
  git -C "$REPO" config user.email test@example.com
  git -C "$REPO" config user.name "Foreman Test"
  echo "# fixture" > "$REPO/README.md"
  git -C "$REPO" -c core.hooksPath= add README.md
  git -C "$REPO" -c core.hooksPath= commit -qm init
  cp "$BATS_TEST_DIRNAME/../.markdownlint-cli2.jsonc" "$REPO/"
  cp "$BATS_TEST_DIRNAME/../.codespellrc" "$REPO/"
  SCRIPTS="$(cd "$BATS_TEST_DIRNAME/../skills/foreman/scripts" && pwd)"
  export REPO SCRIPTS
}
