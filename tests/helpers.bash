#!/usr/bin/env bash
# @description Shared bats helpers: throwaway git repo + isolated FOREMAN_HOME.
set -euo pipefail

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
