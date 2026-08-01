# RESUME — how to pick this repository up cold

This file is a **runbook, not a status report.** It deliberately contains no
counts, no percentages, no criteria state and no "where we are" narrative.
Every one of those lives in the session store, which is the only thing that
stays true without someone remembering to edit it.

Four separate resume documents existed before this one, all at the repository
root, all disagreeing. The most authoritative-looking was the most wrong: it
was undated, so it read as canonical, and it named a pickup branch that had
been superseded for days. That is why this file states nothing that can rot.

## Start here

```bash
git clone https://github.com/CharlesHoskinson/foreman ~/foreman
cd ~/foreman
bash env/bootstrap-wsl.sh --profile full --yes   # installs every dependency
bash install.sh                                  # links the skill into agent homes
bash env/tool-check.sh                           # must print READY: yes
python3 skills/foreman/scripts/fm-session.py recover
```

`recover` is the checkpoint. It prints the durable facts, the measurements with
their freshness, and the open obligations. The store travels with the
repository under `.foreman/`, deliberately not gitignored.

Full dependency inventory, with what breaks without each entry:
`dependencies/README.md`.

## Where to work

**Use a WSL-native path on ext4** — `~/foreman`. Two checkout locations have
caused real losses:

- A `/mnt/c/...` checkout left the installed plugin symlink resolving to zero
  files while the repository shipped 76. Every session that believed it was
  running the installed skill was running nothing.
- A checkout under `/root` breaks Windows interop for any path beneath it
  (`AGENT_TRAPS.md` trap 20), and several controls silently assumed that home
  and failed differently for every other user.

Verify the plugin actually resolves before trusting it:
`bash tools/plugin-drift.sh ~/.claude/skills/foreman skills/foreman`.

## What the store will tell you

| Question | Command |
|---|---|
| What is true, and what is owed? | `fm-session.py recover` |
| Which numbers may I still quote? | `fm-session.py freshness --stale-only --format tsv` |
| What am I about to break? | `AGENT_TRAPS.md` — standing rules, read before dispatching |
| What does this release still need? | `checklist.md` |
| What did we decide not to fix? | `docs/RESIDUALS.md` |

A measurement is **stale** when any commit has touched its declared scope since
it was taken. Stale is the resting state, not an alarm — but do not quote a
stale number. Every stale measurement carries the command that regenerates it;
re-run it and re-record rather than repeating it.

## Before you claim anything is done

Run the gate and read its own verdict line, not your impression of it:

```bash
FOREMAN_CI_BATS=1 bash tools/ci-local.sh
```

The last line is `CI-LOCAL RESULT PASS|FAIL gates_failed=<n>`. Any script that
edits tracked files must gate its commit on its own verification and exit
non-zero on failure — a checklist corruption once reached `origin` because a
script printed a verification result and then committed regardless.

## Owner decisions that block work

These need a human, not more analysis. Read them in the store rather than here,
because a summary in this file would be stale within a day:

```bash
python3 skills/foreman/scripts/fm-session.py recover | grep -A3 "OWNER DECISION"
```

## Pointers

- `AGENT_TRAPS.md` — standing rules, each earned by a specific failure
- `bugeventlog.md` — the incident ledger those rules were distilled from
- `devlog/` — the only artefact that accumulates; every session ends with one
- `dependencies/README.md` — what this software needs to run
- `docs/RESIDUALS.md` — what this release does not do
