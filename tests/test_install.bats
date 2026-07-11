#!/usr/bin/env bats

@test "installs skill to agents dir and symlinks claude dir, idempotently" {
  export FOREMAN_SKILLS_HOME="$BATS_TEST_TMPDIR/agents-skills"
  export FOREMAN_CLAUDE_SKILLS="$BATS_TEST_TMPDIR/claude-skills"
  run "$BATS_TEST_DIRNAME/../install.sh" --skip-tools
  [ "$status" -eq 0 ]
  [ -f "$FOREMAN_SKILLS_HOME/foreman/SKILL.md" ]
  [ -L "$FOREMAN_CLAUDE_SKILLS/foreman" ]
  run "$BATS_TEST_DIRNAME/../install.sh" --skip-tools   # second run must not fail
  [ "$status" -eq 0 ]
}
