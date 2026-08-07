# foreman-qa

Claude Code plugin providing QA, code-quality, and testing guidance for
sessions working on the Foreman repo.

## Purpose

Sessions that open this repository and load `foreman-qa` get skills for
running and interpreting Foreman's test suite, following its code-quality
conventions, and coordinating QA passes without duplicating instructions in
`CLAUDE.md` or `AGENTS.md`.

## Contents

This directory is the plugin root (`.claude-plugin/plugin.json`), plus
skills, commands, and agents added by other work:

- `skills/foreman-testing/SKILL.md` — running and reading Foreman's test
  suite (bats, evidence contract, the gate mutex).
- `skills/foreman-code-quality/SKILL.md` — lint, format, and style
  conventions used in this repo.
- `skills/foreman-qa/SKILL.md` — the QA process that ties testing and
  code-quality checks together.
- `skills/foreman-qa-maintenance/SKILL.md` — keeping the other three skills
  current as the repo changes.
- `commands/` — slash commands the plugin exposes.
- `agents/` — subagent definitions the plugin exposes.

None of the four `SKILL.md` files, `commands/`, or `agents/` are created by
this scaffold. This directory currently holds only the manifest, this
README, and `INSTALL.md`.

## Install

See [`INSTALL.md`](INSTALL.md).
