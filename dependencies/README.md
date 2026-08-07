# Dependencies — everything required to run Foreman

Complete inventory of what Foreman needs on a host, why each entry is needed,
and **what breaks without it**. Every version below was probed on a real host,
not copied from a package index.

- **Verified:** 2026-08-01 on WSL2 Ubuntu 26.04 (`Ubuntu-26.04`), non-root user,
  WSL-native ext4 checkout.
- **Machine-readable inventory:** `env/reference-manifest.toml`
- **Readiness check:** `bash env/tool-check.sh [--profile soft|hard|full|durable]`
- **Provisioner:** `bash env/bootstrap-wsl.sh --profile full --yes`
  (Windows: `env/bootstrap-windows.ps1`)

This file is the human-readable view. It does not replace the manifest or the
checker — `dependencies/check-drift.sh` exists to prove the three agree, because
the one time they silently disagreed it cost 102 test failures (see
[Why this directory exists](#why-this-directory-exists)).

## Quick start on a fresh host

```bash
git clone https://github.com/CharlesHoskinson/foreman ~/foreman
cd ~/foreman
bash env/bootstrap-wsl.sh --profile full --yes   # installs everything below
bash install.sh                                  # links the skill into ~/.claude/skills
bash env/tool-check.sh                           # must print READY: yes
python3 skills/foreman/scripts/fm-session.py recover
```

Use a **WSL-native path** (`~/foreman`, ext4). A `/mnt/c/...` checkout has
produced a stale plugin tree that resolved to zero files, and a checkout under
`/root` breaks Windows interop (`AGENT_TRAPS.md` trap 20).

## Profiles

| Profile | What it runs | Use when |
|---|---|---|
| `soft` | Architect + vendor lanes, no containers | Day-to-day driving |
| `hard` | Adds container transport and the full gate | Running the real gate |
| `full` | Everything including build and lint tooling | Development on Foreman itself |
| `durable` | Adds the durable-lane transport | Long-running detached lanes |

## Core runtime — required

Without these Foreman does not run at all.

| Tool | Profile | Why it is needed | Without it | Install (WSL) | Verified |
|---|---|---|---|---|---|
| `git` | all | Worktree isolation is the unit of lane work | No lanes, no gate | `apt install git` | 2.53.0 |
| `bash` | all | Every script is bash; arrays and `local` are used throughout | Nothing runs | `apt install bash` | 5.3.9 |
| `python3` (≥3.11) | all | Session store, gate evaluation, MCP session transport | No session store, no `recover` | `apt install python3 python3-pip python3-venv` | 3.14.4 |
| `python3` `sqlite3` module | all | `.foreman/session.db` is SQLite; the **stdlib module** is what reads it | No facts, measurements or obligations | ships with `python3` | lib 3.46.1 |
| `jq` | **all** | `meta.json`, gate evaluation, verdict parsing, and the fit ledger | Gate cannot evaluate; `foreman-fit-report.sh` refuses | `apt install jq` | 1.8.1 |
| `flock` (util-linux) | hard, full, durable | **Carries every durable lock on Linux** — see [Locking](#locking--read-this-before-changing-coreutils) | Event log and lane locks fail closed | `apt install util-linux` | 2.41.3 |
| `strace` | all POSIX | The **only** evidence class that can license a lock mechanism as atomic | No trusted lock; `FM_LOCK_UNAVAILABLE`; 102 tests fail | `apt install strace` | 6.19 |
| `coreutils` | all | `timeout`, `stat`, `mkdir`, `rmdir` throughout | Timeouts and bounds unenforceable | `apt install coreutils` | see [Locking](#locking--read-this-before-changing-coreutils) |
| `util-linux-extra` | all | `hwclock`, used by the WSL clock-resync hook | Clock drift alerts on every lane round | `apt install util-linux-extra` | 2.41.3 |
| `ca-certificates`, `curl` | all | Every network install route below | Bootstrap cannot fetch anything | `apt install ca-certificates curl` | — |
| Foreman skill link | all | `install.sh` links `skills/foreman` into agent homes | Agents run an empty or stale skill | `bash install.sh` | — |

## Vendor CLIs

At least one worker vendor and one **different** auditor vendor are required —
the cross-vendor invariant is enforced in code, and an auditor may not equal the
worker's vendor.

| Tool | Required | Why | Install | Verified |
|---|---|---|---|---|
| `codex` | worker or auditor | Primary worker lane; MCP session transport | `npm i -g @openai/codex@latest` | 0.145.0 |
| `grok` | worker or auditor | Cross-vendor auditor; headless OAuth | `npm i -g @xai-official/grok@latest` | 0.2.112 |
| `claude` | optional | Orchestrator / auditor | Claude Code installer | 2.1.220 |
| `opencode` | optional | Session-transport cockpit | `opencode` installer | 1.17.19 |

Authentication is **not** provisioned by bootstrap and must be done once per
host: `codex login`, `grok login --device-code`, `claude` then `/login`.

## Gate and development tooling

Needed to run the gate (`tools/ci-local.sh`) and therefore to commit safely.

| Tool | Profile | Why | Without it | Install | Verified |
|---|---|---|---|---|---|
| `bats` | hard, full | The 635-test suite | No suite; the bats gate cannot run | `apt install bats` | 1.13.0 |
| `shellcheck` | hard, full | Shell gate over 52 files | Shell gate skipped | `apt install shellcheck` | (installed) |
| `docker` | hard, full | Container transport and sandboxing | Container transport unavailable | Docker Engine (native, not Desktop) | 29.7.1 |
| `gh` | hard, full | `pr-open.sh`, CI run inspection | Cannot open PRs or read CI | `apt install gh` | 2.97.0 |
| `node` + `npm` | soft, full | Install route for `codex` and `grok`; `markdownlint-cli2` | No vendor CLI install path | fnm-managed (bootstrap) | 24.18.1 / 11.16.0 |
| `bun` (pinned 1.3.14) | full | Builds `launcher/dist/foreman-launch` | Launcher binary absent | pinned install script | 1.3.14 |
| `sqlite3` CLI | full | `tests/session.bats` shells out to the CLI directly to dump and cross-check database rows/columns (import-sidecar fidelity) and to seed fields for the freshness tests — the **product code** itself only uses python3's stdlib `sqlite3` module | Those tests fail with status 127 instead of skipping: measured pass=31 fail=3 of 34 without the CLI, pass=34 fail=0 with it, same host; before this entry existed, a full-profile bootstrap completed exit 0 without installing it | `apt install sqlite3` | 3.46.1 |

## Docs gate

| Tool | Why | Install | Verified |
|---|---|---|---|
| `markdownlint-cli2` | Markdown structure gate | `npm i -g markdownlint-cli2` | v0.23.2 |
| `codespell` | Spelling gate | `apt install codespell` | 2.4.1 |
| `lychee` | Link gate | GitHub release binary | 0.24.2 |

## Optional and durable-lane transport

| Tool | Profile | Why | Verified |
|---|---|---|---|
| `pueue` | full | Detached lane queue | 4.0.4 |
| `nats-server`, `nats` | durable | Durable-lane transport | not installed here |
| `gnu-coreutils` | none | Provides `gnumkdir`; see [Locking](#locking--read-this-before-changing-coreutils) | 9.7 |

## Locking — read this before changing coreutils

Ubuntu 26.04 resolves `/bin/mkdir` to **uutils (Rust) coreutils 0.8.0**, which
performs a userspace `statx` check-then-act instead of issuing `mkdir(2)`. It is
**not usable as a mutual-exclusion primitive** — measured at 20 violations in 40
eight-racer rounds, against 0 for GNU 9.7. This is a documented blocker:
`docs/research/vnext/F-uutils-mkdir-blocker.md`.

Consequences you must not undo:

1. **`flock` carries every durable lock.** `mkdir` is permanently distrusted on
   this platform and `lib/lock.sh` is fail-closed.
2. **`strace` is mandatory, not diagnostic.** Flavour licenses nothing and
   contention can only ever license `non-atomic`; the syscall evidence class is
   the only route to `atomic`. On a host without `strace`, no mechanism earns
   trust, `lib/lock.sh` returns `FM_LOCK_UNAVAILABLE`, and the suite fails 102
   tests that have nothing to do with the code under test.
3. Verify with `bash tests/probes/mkdir-atomicity.sh` — it reports both the
   mechanism and a contention sample. Do not reimplement it.

## Why `jq` is required rather than optional

`foreman-fit-report.sh` reads a JSON-lines ledger and is invoked from
`foreman-cleanup.sh`, which closes runs in **every** profile — so `jq` is a
`must` everywhere, not just on hard and full.

It was written jq-optional, with a `grep`/`awk` fallback for hosts without it.
A cross-vendor audit proved the fallback silently miscounts **valid** JSON: a
record whose nested object carries a decoy `phase` parsed as `implement/1` under
`jq` and `discover/5` under the regex, and a trailing comma that `jq` rejects was
silently accepted. A regex cannot parse JSON structure, so the fallback could
only ever agree on the cases someone thought to test.

This is a metric. A number that is quietly wrong is worse than a refusal,
because someone will quote it. The script now refuses without `jq` and names
this file in the message.

## Why this directory exists

`env/reference-manifest.toml` calls itself the inventory source of truth, but
`tool-check.sh` reads it only for the lock-atomicity pin register and otherwise
**embeds a mirror** of the profile lists, which its own header admits. Nothing
compared the two. `strace` was absent from the manifest, absent from the
provisioner, and unreported by the checker, so a freshly provisioned host looked
`READY: yes` and failed 102 tests.

`dependencies/check-drift.sh` compares the manifest, the checker's profile
arrays and the provisioner's install routes, and names every entry present in
one and missing from another. Run it after touching any of the three:

```bash
bash dependencies/check-drift.sh
```

A dependency list nobody checks becomes a record that lies. This one is checked.
