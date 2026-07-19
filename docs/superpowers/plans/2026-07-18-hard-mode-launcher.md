# hard-mode-launcher Implementation Plan (next release · container profile shipped)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> or superpowers:executing-plans. **Implementer: Sonnet 5. Auditor: Opus 4.8.**
> EARS: `openspec/changes/hard-mode-launcher/specs/hard-mode/spec.md`.
> Design + research basis: `openspec/changes/hard-mode-launcher/design.md`.
> Dependencies (both LANDED in v0.2.7.5): worktree-hardening (`git_retry`,
> `wt_sweep_stale_locks`) and posix-cascade-parity (WSL container supervision).
> Build the launcher-only profile FIRST and prove it end-to-end; the container
> profile is Docker-guarded and layers on top.
>
> **Revision 3** — after two Opus audits. Rev1 (6 BLOCKING) and rev2 (3 BLOCKING:
> a non-existent config accessor; a broken container git-dir mount; an `env -i`
> regression that breaks the Node vendor CLIs on Windows) are both folded in.
> Rev3's load-bearing corrections: the config accessor is `toml_get "$CONFIG"
> KEY DEFAULT` (`common.sh:50`), NOT `config_get`/`cfg_get` (`hard_mode.*` is not
> in `cfg_get`'s allowlist); the container profile runs the worker in a **clean
> file copy** of the worktree (no `.git`), synced back host-side — which also
> re-aligns with the spec's "worktree COPY" language and removes the dangling-
> gitdir problem; the launcher-only clean env keeps the **Windows-essential**
> vars Node needs; and heartbeats are mirrored by a **batch read after the
> worker exits** (no `tail -F`/FIFO/background-lock hazards).
>
> A third (focused) audit returned APPROVED-WITH-FIXES — launcher-only path sound;
> two container-only BLOCKING + minor items folded in: sync-back is
> `rsync -a --delete --exclude='.git'` (propagates worker deletions/renames; a
> plain `tar -x` would not); the hardened `--read-only` run adds
> `--tmpfs /home/worker` (writable vendor `$HOME`) + `--tmpfs /run` (iptables
> lock) + a `--name`d container reaped on timeout; the PAT push uses `GIT_ASKPASS`
> (token out of argv, not `-c http.extraHeader`); and the launcher rc is captured
> `|| rc=$?` so a 124 still reaches the alert path under `set -e`.

**Goal:** Turn the `worker-run.sh` stub and partial `pr-open.sh` into a shipped
hard mode: foreman-launch supervises an untrusted worker, heartbeats mirror into
the event log, evidence is extracted host-side, the worker never commits (a
host-side stage commits its diff), and — only after the gate passes — the branch
is pushed and a **draft** PR opened host-side with a fine-grained, single-repo
token the worker never sees. Two profiles: **launcher-only** (default, no Docker)
and **container** (devcontainer + default-deny egress firewall).

**Architecture:** `lib/launch.sh` factors foreman-launch *resolution* into a
self-contained unit (`fl_resolve_launcher`) so `worker-run.sh` reuses the v0.2.5
supervision contract without touching frozen `lane-run.sh`. `lib/worker-cmd.sh`
builds the per-vendor worker argv as a bash array, delivering the task prompt as
a **file/positional argument** (the launcher nulls stdin). `worker-run.sh` reads
the run's `meta.json`; **launcher-only** runs the worker directly in `$WT` under
a clean env that keeps Windows-essential vars; **container** runs it in a
`git archive` copy (`$RD/sandbox-work`, no `.git`) bind-mounted rw into a
hardened devcontainer on an egress-capable user-defined bridge whose root
entrypoint applies `init-firewall.sh` (default-deny allowlist) then drops to an
unprivileged worker, and the copy is synced back to `$WT` afterward. Both
profiles then extract evidence and **host-side commit** the diff onto the branch
(`git_nohooks`), never inside the sandbox, and mirror the launcher's heartbeat
lines into the event log by reading the heartbeat file after the worker exits.
`pr-open.sh` keeps its `gate-decision.json.pass` precondition, then pushes over
HTTPS with the fine-grained PAT and opens a draft PR.

**Tech Stack:** bash (strict mode), bats-core, `skills/foreman/scripts/lib/{common,worktree,eventlog,config}.sh`, the v0.2.5 `foreman-launch` binary (`launcher/dist/`), Docker Desktop/WSL2 (container profile only), `gh` CLI, `jq`, `git`.

## Ground-truth interfaces (verified against code 2026-07-18; two audits)

- **Launcher CLI:** `foreman-launch [--timeout SECS] [--grace SECS=10]
  [--heartbeat-file F] [--heartbeat-interval SECS=15] [--detach] -- CMD [ARGS...]`
  (`launcher/README.md:26-28`). **CMD's stdin is the null device** (`:32-33`) —
  the worker prompt CANNOT arrive on stdin. Exit codes: CMD's own / `124` timeout
  / `125` launcher error. Heartbeat lines: `{ts, launcher_pid, pid, job_id, alive,
  stdout_bytes, stderr_bytes, elapsed_s}`. Binary: `launcher/dist/foreman-launch.exe`.
- **Launcher resolution reference:** `lane_resolve_launcher()` `lane-run.sh:542-564`
  (computes repo root 3 levels up from `scripts/`). `lib/launch.sh` lives one level
  deeper (`scripts/lib`) → **4 levels** to repo root.
- **Config accessor:** `toml_get "$CONFIG" section.key default` — defined in
  `common.sh:50`, used by `audit-run.sh:27-29`; reads an ARBITRARY dotted key from
  a TOML file. (NOT `config_get` — nonexistent — and NOT `cfg_get SECTION KEY
  DEFAULT` `config.sh:210`, whose closed allowlist has no `hard_mode.*`.) Derive
  `ROOT="$(jq -r .repo_root "$RD/meta.json")"`, `CONFIG="$ROOT/.foreman/config.toml"`.
- **Event log:** `el_init "$run"` once at start (reclaims a crashed run's stale
  `.seq.lock`; `el_emit` has NO in-band reclaim — `eventlog.sh:50-58,71-74`);
  `el_emit run type lane payload [commit]` (5 positional; echoes seq on stdout —
  redirect `>/dev/null`). Lane label must match `^[A-Za-z0-9._-]+$` if ever passed
  to `el_attempt_new` (`eventlog.sh:214`) — use `worker-$VENDOR` (hyphen, no colon).
- **Run dir + meta:** `run_dir "$TASK_ID"` → `$FOREMAN_HOME/runs/$TASK_ID`;
  `meta.json` = `{task_id, repo_root, worktree, branch, base_sha}`; the worktree is
  a **linked** worktree (`task-new.sh:27` `git worktree add`), so `$WT/.git` is a
  FILE pointing at the host repo — it must NOT be bind-mounted into a container.
- **Gate/audit both diff `BASE_SHA...HEAD`** (`gate-eval.sh:29`, `audit-run.sh:49`)
  → HEAD MUST carry a host-side commit or they are vacuous. `pr-open.sh:11` reads
  `gate-decision.json.pass`.
- **git without hooks:** `git_nohooks() { git -c core.hooksPath= "$@"; }`
  (`common.sh:42`) — use it for all host-side git in worker-run (the worktree is
  untrusted; `task-new.sh:27` already adds worktrees hook-free).
- **Exit codes/helpers (`common.sh:4-50`):** `EXIT_OK/FAIL/CONFIG/MISSING_CLI =
  0/1/2/3`; `log`, `die CODE MSG`, `run_dir`, `require_cmd`, `toml_get`, `git_nohooks`.
- **Worktree helpers (`worktree.sh`):** `git_retry` (`:73`, runs any command incl.
  a function, with backoff), `wt_sweep_stale_locks` (`:122`).
- **Security doctrine to reconcile (`security-model.md:13,18`):** `--cap-drop ALL`,
  no-new-privileges, read-only root, "container gets only worker vendor API key".
- **No `sandbox/` or `.devcontainer/` exists yet** — Task 4 creates `sandbox/`.

## Global constraints

Strict mode (`set -euo pipefail`) + portability checklist (MSYS/WSL/Git-Bash) +
gate mutex per bats run, **on a QUIET host** (agents/writes flake the slow
watcher/wall-clock tests). `lane-run.sh` byte-frozen. The worker gets a
**clean-slate env** (allowlist only, plus Windows-essential vars for the native
launcher-only profile) — never `FOREMAN_GH_PAT`, host secrets, or a `docker.sock`
mount. **No commit inside the sandbox**; the host-side commit stage (`git_nohooks`)
is separate. Container bats are Docker-guarded; gh/push bats use shims except one
guarded live path. Every new script `shellcheck`-clean. **Scope:** the
no-host-secrets guarantee holds under OAuth/home-isolated vendor auth; API-key
auth necessarily passes that one vendor key — a documented narrowing, not a hole.

## File structure

- Create `skills/foreman/scripts/lib/launch.sh`, `lib/worker-cmd.sh`.
- Modify `worker-run.sh`, `pr-open.sh`, `task-new.sh` (task.md boilerplate).
- Create `sandbox/Dockerfile`, `sandbox/entrypoint.sh`, `sandbox/init-firewall.sh`, `sandbox/devcontainer.json`.
- Create `tests/launch-lib.bats`, `tests/worker-cmd.bats`, `tests/worker-run.bats`, `tests/pr-open.bats`.
- Modify `references/security-model.md` + `orchestration-hardening.md`, and the
  OpenSpec delta (`openspec/changes/hard-mode-launcher/**`) to match the shipped model.

---

### Task 1: shared launcher resolver (`lib/launch.sh`)

**Files:** Create `skills/foreman/scripts/lib/launch.sh`; Test `tests/launch-lib.bats`.

- [ ] **Step 1: Write the failing test** — override authoritative (non-exec ⇒
  absent) AND the dist/PATH fallback branch resolves the committed binary.

```bash
# tests/launch-lib.bats
setup() { source "$BATS_TEST_DIRNAME/../skills/foreman/scripts/lib/launch.sh"; }
@test "override authoritative when executable" {
  local f="$BATS_TEST_TMPDIR/fl"; printf '#!/usr/bin/env bash\ntrue\n' >"$f"; chmod +x "$f"
  FOREMAN_LAUNCH="$f" run fl_resolve_launcher; [ "$status" -eq 0 ]; [ "$output" = "$f" ]
}
@test "non-executable override means ABSENT" { FOREMAN_LAUNCH="$BATS_TEST_TMPDIR/x" run fl_resolve_launcher; [ "$status" -ne 0 ]; }
@test "no override resolves the committed launcher/dist binary (fallback)" {
  unset FOREMAN_LAUNCH; run fl_resolve_launcher; [ "$status" -eq 0 ]; [[ "$output" == *"launcher/dist/foreman-launch"* ]]
}
```

- [ ] **Step 2: Run to verify it fails** (absent).
- [ ] **Step 3: Implement** `fl_resolve_launcher`: honor `FOREMAN_LAUNCH` (`[[ -x ]]`
  else return 1); else repo root **self-contained** from this file —
  `"$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"` (FOUR levels — the
  audit's off-by-one trap); pick `.exe` on Windows (`case "$(uname -s)" in
  *NT*|MINGW*|MSYS*|CYGWIN*)`); test `[[ -x ]]`; else `command -v foreman-launch`;
  else return 1. worker-run builds the launcher argv as a bash **array** directly.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `git commit -m "feat(hard-mode): lib/launch.sh self-contained foreman-launch resolver"`.

---

### Task 2: per-vendor worker command builder (`lib/worker-cmd.sh`)

**Files:** Create `skills/foreman/scripts/lib/worker-cmd.sh`; Test `tests/worker-cmd.bats`.

Prompt via file/argv, never stdin. v1 = the two live vendors (grok, codex); claude
out of scope (REQUIRES-SEPARATE-HOME).

- [ ] **Step 1: Write the failing test** — `wc_build_argv` fills `WC_ARGV` with a
  prompt-as-argument invocation, no stdin redirect, errors on unknown vendor.

```bash
# tests/worker-cmd.bats
setup() { source "$BATS_TEST_DIRNAME/../skills/foreman/scripts/lib/worker-cmd.sh"; }
@test "grok: prompt delivered via --prompt-file" {
  local p="$BATS_TEST_TMPDIR/p"; echo hi >"$p"; wc_build_argv grok "$p" /work
  [ "${WC_ARGV[0]}" = "grok" ]; [[ " ${WC_ARGV[*]} " == *"--prompt-file $p"* ]]
}
@test "codex: exec with prompt arg + sandbox flags, no stdin redirect" {
  local p="$BATS_TEST_TMPDIR/p"; echo "do it" >"$p"; wc_build_argv codex "$p" /work
  [ "${WC_ARGV[0]}" = "codex" ]; [[ " ${WC_ARGV[*]} " == *" exec "* ]]
  [[ " ${WC_ARGV[*]} " != *"<"* ]]
}
@test "unknown vendor errors" { run wc_build_argv nope /dev/null /work; [ "$status" -ne 0 ]; }
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement `wc_build_argv VENDOR PROMPT_FILE WORKDIR`** → global
  `WC_ARGV=()`:
  - `grok`: `grok --prompt-file "$PROMPT_FILE"` + the one-shot/non-interactive
    flags the grok lane uses (ground-truth against `references/lanes.md:7,39` and
    `agents/grok-implementer.md:97` — grok's real prompt interface is `--prompt-file`).
  - `codex`: `codex exec --sandbox workspace-write --skip-git-repo-check
    --output-last-message "$WORKDIR/.foreman-last.txt" --model gpt-5.6-sol
    -c model_reasoning_effort=medium "$(cat "$PROMPT_FILE")"` (positional prompt;
    verify the exact form against `codex exec --help` at implementation).
  - unknown: `die "$EXIT_CONFIG" "unknown worker vendor: $VENDOR"` (or return 2).
  Model/effort overridable via env. Header-comment: prompt MUST NOT be on stdin.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `git commit -m "feat(hard-mode): lib/worker-cmd.sh per-vendor worker argv (prompt-as-file, not stdin)"`.

---

### Task 3: worker-run launcher-only profile (default, no Docker)

**Files:** Modify `worker-run.sh`; Test `tests/worker-run.bats`.

- [ ] **Step 1: Write the failing test** — supervise, batch-mirror ≥1 heartbeat,
  extract evidence, host-side commit (exactly one over BASE_SHA, host-authored),
  clean env carries no secret, timeout ⇒ 124 + alert.

```bash
# tests/worker-run.bats (excerpt)
@test "launcher-only: supervise, mirror, evidence, host commit, clean env" {
  setup_run_with_meta
  make_fake_launcher_writing_heartbeat_then_running_cmd   # writes >=1 hb line, runs a shim that edits $WT/work.txt
  run env FOREMAN_LAUNCH="$FAKE_LAUNCH" FOREMAN_HOME="$FH" FOREMAN_GH_PAT="SECRET" \
    FOREMAN_WORKER_CMD_SHIM="$SHIMS/worker.sh" bash "$SCRIPTS/worker-run.sh" "$T"
  [ "$status" -eq 0 ]
  grep -q '"type":"heartbeat"' "$FH/runs/$T/events.jsonl"
  [ -f "$FH/runs/$T/evidence/diff-stat.txt" ]
  [ "$(git -C "$WT" rev-list --count "$BASE_SHA"..HEAD)" -eq 1 ]
  ! grep -q SECRET "$SHIMS/worker-env-dump.txt"
}
@test "launcher-only: timeout ⇒ 124 + timeout alert" {
  setup_run_with_meta; make_fake_launcher_exiting 124
  run env FOREMAN_LAUNCH="$FAKE_LAUNCH" FOREMAN_HOME="$FH" bash "$SCRIPTS/worker-run.sh" "$T"
  [ "$status" -eq 124 ]; grep -q '"kind":"worker_timeout"' "$FH/runs/$T/events.jsonl"
}
```

- [ ] **Step 2: Run to verify it fails** (stub exits `EXIT_MISSING_CLI`).
- [ ] **Step 3: Implement:**
  - Source `lib/common.sh` (gives `toml_get`,`git_nohooks`), `lib/launch.sh`,
    `lib/worker-cmd.sh`, `lib/eventlog.sh`, `lib/worktree.sh`.
  - `TASK_ID="${1:?usage: worker-run.sh TASK_ID [--profile launcher-only|container] [--vendor V]}"`;
    `RD="$(run_dir "$TASK_ID")"`; `WT/BRANCH/BASE_SHA/ROOT` from `meta.json` via `jq`;
    `CONFIG="$ROOT/.foreman/config.toml"`. `LANE="worker-$VENDOR"` (hyphen — N13).
  - `el_init "$TASK_ID"`.
  - `PROFILE="${arg:-$(toml_get "$CONFIG" hard_mode.profile launcher-only)}"`;
    `VENDOR="${arg:-$(toml_get "$CONFIG" hard_mode.vendor codex)}"`;
    `TO="$(toml_get "$CONFIG" hard_mode.timeout 600)"` (N1 — `toml_get`, not config_get).
  - `wt_sweep_stale_locks "$WT"`.
  - `LAUNCHER="$(fl_resolve_launcher)"` else `die "$EXIT_MISSING_CLI" "hard mode
    requires foreman-launch"`.
  - Prompt: write `$RD/worker-prompt.txt` = a hard-mode preamble (**"Edit files in
    the worktree only. Do NOT run git or commit — the host commits your changes."**)
    plus the task goal from `$RD/task.md`, then `wc_build_argv "$VENDOR"
    "$RD/worker-prompt.txt" "$WT"`.
  - **Clean env (N6):** base allowlist `WORKER_ENV_ALLOW=(PATH HOME USERPROFILE
    FOREMAN_TASK_ID LANE_VENDOR <vendor-home var>)`, plus the vendor API-key var
    (`XAI_API_KEY` for grok / `OPENAI_API_KEY` for codex) ONLY when the deployment
    uses API-key auth (the documented narrowing — under OAuth/home isolation no key
    is passed). `ENV_KV` (launcher-only, native Windows worker) = those names as
    `NAME=value` pairs AND, guarded by `case "$(uname -s)"` for Windows/MSYS,
    `SYSTEMROOT WINDIR APPDATA LOCALAPPDATA TEMP TMP PATHEXT COMSPEC
    NUMBER_OF_PROCESSORS` (Node's TLS/DNS/crypto + auth-file discovery need them).
    `CLEAN_ENV` (container, Linux) = the base allowlist ONLY — no Windows vars. Both
    are built from scratch (`env -i` for launcher-only; `--env-file` for the
    container); NEVER `FOREMAN_GH_PAT` or the ambient environment.
  - Spawn (launcher-only): `rc=0; env -i "${ENV_KV[@]}" "$LAUNCHER" --timeout "$TO"
    --heartbeat-file "$RD/worker-heartbeat.jsonl" -- "${WC_ARGV[@]}" \
    >"$RD/worker-stdout.log" 2>"$RD/worker-stderr.log" || rc=$?`, cwd `$WT`. The
    `|| rc=$?` is load-bearing under `set -e`: a 124 timeout / 125 launcher-error
    is a NON-zero exit and a bare `rc=$?` would abort before the mirror + alert
    path runs (the timeout test depends on reaching it). `ENV_KV` is built from
    `WORKER_ENV_ALLOW` (below).
  - **Batch heartbeat mirror (N14):** after the worker exits,
    `[[ -f "$RD/worker-heartbeat.jsonl" ]] && while IFS= read -r line; do
    [[ -n "$line" ]] && el_emit "$TASK_ID" heartbeat "$LANE" "$line" >/dev/null 2>&1
    || true; done < "$RD/worker-heartbeat.jsonl"` — no background process, no
    tail/FIFO, no lock race. (foreman-launch's own `--heartbeat-file` is the live
    view; the event log is the durable mirror.)
  - **Stage + evidence (host-side, N10):** `git_nohooks -C "$WT" add -A` FIRST
    (so evidence AND the commit include NEW/untracked files — a plain
    `diff --stat "$BASE_SHA"` compares base→working-tree and omits untracked, so a
    worker that *creates* a file would produce empty evidence), then `mkdir -p
    "$RD/evidence"; git_nohooks -C "$WT" diff --cached --stat "$BASE_SHA" >
    "$RD/evidence/diff-stat.txt"; cp "$RD/worker-stdout.log"
    "$RD/evidence/transcript.log"`.
  - **Host-side commit (N10):** IF rc==0 AND `! git_nohooks -C "$WT" diff --cached
    --quiet` (something staged): fail clearly if the host git identity is unset,
    then `git_retry git_nohooks -C "$WT" commit -m "foreman(worker): $TASK_ID"`.
    (No commit inside the sandbox — this is the host.)
  - Outcome: `124` → `el_emit … alert … '{"kind":"worker_timeout"}' >/dev/null||true`,
    exit 124; `125` → alert `worker_launcher_error`, exit 125; else pass rc.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `git commit -m "feat(hard-mode): worker-run launcher-only (supervise, batch-mirror, evidence, host-side commit, clean env)"`.

---

### Task 4: worker-run container profile (bridge + firewall, file-copy work dir)

**Files:** Create `sandbox/{Dockerfile,entrypoint.sh,init-firewall.sh,devcontainer.json}`;
Modify `worker-run.sh`; Test `tests/worker-run.bats` (Docker-guarded).

Container work dir is a **clean copy** (no `.git`) — resolves the linked-worktree
mount problem (N2) and matches the spec's "worktree COPY".

- [ ] **Step 1: Write the failing test** — docker shim records argv: the mount is
  the **copy** dir rw (not `$WT`, no `.git`), an egress-capable bridge (NOT
  `--internal`, NOT `--network none`), `--cap-drop ALL --cap-add NET_ADMIN
  --security-opt no-new-privileges --read-only --tmpfs /tmp`, NO `docker.sock`, NO
  `FOREMAN_GH_PAT`; live-Docker (guarded) builds the image, `init-firewall.sh
  --check` is default-deny + allowlist populated, and the worker runs unprivileged.

```bash
# tests/worker-run.bats (excerpt)
@test "container: copy dir mounted rw, egress bridge, hardened flags, no socket/PAT" {
  setup_run_with_meta; install_docker_shim_recording_argv
  run env FOREMAN_HOME="$FH" FOREMAN_GH_PAT="SECRET" bash "$SCRIPTS/worker-run.sh" "$T" --profile container
  [ "$status" -eq 0 ]
  grep -qE -- "-v [^ ]*sandbox-work:/work" "$DOCKER_ARGV"     # the COPY, not $WT
  ! grep -qF "$WT/.git" "$DOCKER_ARGV"
  ! grep -qE -- '--network[= ](none|.*--internal)' "$DOCKER_ARGV"
  grep -qF -- '--cap-drop ALL' "$DOCKER_ARGV"; grep -qF -- '--cap-add NET_ADMIN' "$DOCKER_ARGV"
  grep -qF -- '--security-opt no-new-privileges' "$DOCKER_ARGV"; grep -qF -- '--read-only' "$DOCKER_ARGV"
  grep -qF -- '--tmpfs /home/worker' "$DOCKER_ARGV"; grep -qF -- '--tmpfs /run' "$DOCKER_ARGV"  # writable HOME + iptables lock
  ! grep -qF 'docker.sock' "$DOCKER_ARGV"; ! grep -qF SECRET "$DOCKER_ARGV"
}
@test "container: worker file DELETION propagates to the host commit (rsync --delete)" {
  setup_run_with_meta; echo old > "$WT/todelete.txt"; git -C "$WT" add -A && git -C "$WT" commit -qm base
  BASE_SHA="$(git -C "$WT" rev-parse HEAD)"; update_meta_base "$BASE_SHA"
  install_docker_shim_deleting "$RD/sandbox-work/todelete.txt"   # shim: worker deletes the file in the copy
  run env FOREMAN_HOME="$FH" bash "$SCRIPTS/worker-run.sh" "$T" --profile container
  [ "$status" -eq 0 ]; [ ! -f "$WT/todelete.txt" ]                # deletion synced back
  git -C "$WT" show HEAD --stat | grep -q 'todelete.txt'          # and captured in the commit
}
@test "container: real Docker — hardened run (read-only) firewall default-deny + worker unprivileged" {
  command -v docker >/dev/null && docker info >/dev/null 2>&1 || skip "docker unavailable"
  run docker build -t foreman-sandbox:test "$BATS_TEST_DIRNAME/../sandbox"; [ "$status" -eq 0 ]
  # exercise the SHIPPED run posture: read-only rootfs + tmpfs, cap-drop, NET_ADMIN
  local HARDEN=(--rm --cap-drop ALL --cap-add NET_ADMIN --security-opt no-new-privileges \
                --read-only --tmpfs /tmp --tmpfs /run --tmpfs /home/worker)
  run docker run "${HARDEN[@]}" foreman-sandbox:test /init-firewall.sh --check; [ "$status" -eq 0 ]
  run docker run "${HARDEN[@]}" foreman-sandbox:test id -un; [ "$output" != "root" ]   # N5: full entrypoint runs
  run docker run "${HARDEN[@]}" foreman-sandbox:test sh -c 'touch $HOME/x && echo ok'; [ "$output" = ok ]  # HOME writable
}
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement:**
  - `sandbox/Dockerfile` — minimal base + `git iptables ipset ca-certificates
    gosu` (N4) + the vendor CLI; create unprivileged user `worker`;
    `COPY init-firewall.sh entrypoint.sh /`; `ENTRYPOINT ["/entrypoint.sh"]`.
  - `sandbox/init-firewall.sh` — adapted from `anthropics/claude-code
    .devcontainer/init-firewall.sh` (cite): default-deny OUTPUT, ipset allowlist of
    the vendor API host + git remote host (resolved), allow DNS + established.
    `--check` exits 0 only if default OUTPUT policy is DROP and the allowlist is
    non-empty.
  - `sandbox/entrypoint.sh` — as **root**: `/init-firewall.sh`; then
    `exec gosu worker "$@"` (drop; the worker has no CAP_NET_ADMIN and cannot flush
    the firewall — N6).
  - `sandbox/devcontainer.json` — Dockerfile ref; `runArgs`:
    `--cap-drop=ALL --cap-add=NET_ADMIN --security-opt=no-new-privileges
    --read-only --tmpfs=/tmp` (N9); NO `docker.sock`; `remoteUser: worker`.
  - `worker-run.sh` container branch:
    1. Build the copy: `mkdir -p "$RD/sandbox-work"; git_nohooks -C "$WT" archive
       HEAD | tar -x -C "$RD/sandbox-work"` (clean tree, no `.git`; add uncommitted
       tracked changes via `git_nohooks -C "$WT" stash create` or a `diff | apply`
       if the run expects a dirty base — otherwise HEAD is the base).
    2. Ensure the user-defined bridge `foreman-sandbox-net` exists (egress-capable
       — `docker network create foreman-sandbox-net`, NOT `--internal` — N8).
    3. Write the container env to a real `0600` temp file `$RD/sandbox.env` (the
       Linux allowlist only — no Windows vars, no `FOREMAN_GH_PAT`, no host env, no
       `docker.sock`; include the vendor API key ONLY in API-key mode) — a real
       file, not `<(process-sub)`, because `docker` is a grandchild of the launcher
       and the `/dev/fd` would not survive. Run under supervision with a NAMED
       container so a timeout actually reaps it: `"$LAUNCHER" --timeout "$TO"
       --heartbeat-file … -- docker run --rm --name "foreman-$TASK_ID"
       --network foreman-sandbox-net --cap-drop ALL --cap-add NET_ADMIN
       --security-opt no-new-privileges --read-only --tmpfs /tmp --tmpfs /run
       --tmpfs /home/worker -v "$RD/sandbox-work":/work -w /work
       --env-file "$RD/sandbox.env" foreman-sandbox "${WC_ARGV[@]}"`. The
       `--tmpfs /home/worker` gives the unprivileged worker the writable `$HOME`
       the native-Node vendor CLI needs (cache/token-refresh) under the read-only
       rootfs; `--tmpfs /run` gives `iptables` its `/run/xtables.lock`. On ANY exit
       (trap), `docker rm -f "foreman-$TASK_ID" 2>/dev/null || true` — killing the
       `docker run` CLI on a 124 does not stop the dockerd-owned container by
       itself.
    4. Sync back with **rsync (delete-aware)**: `rsync -a --delete
       --exclude='.git' "$RD/sandbox-work/" "$WT/"`. `--delete` propagates the
       worker's file DELETIONS and renames (a plain `tar -x` is additive and would
       leave deleted files behind → a wrong commit diff); `--exclude='.git'` is
       MANDATORY — it protects `$WT`'s linked-worktree `.git` FILE that `--delete`
       would otherwise remove. Then the SAME host-side evidence + commit +
       heartbeat-mirror path as Task 3 operates on `$WT`.
- [ ] **Step 4: Run to verify it passes** (shim always; live case when Docker up).
- [ ] **Step 5: Commit** `git commit -m "feat(hard-mode): container profile — file-copy work dir, egress bridge+firewall, root-init drops to worker, hardened run"`.

---

### Task 5: pr-open completion (gate → HTTPS PAT push → draft PR)

**Files:** Modify `pr-open.sh`; Test `tests/pr-open.bats`.

- [ ] **Step 1: Write the failing test** — gate-not-passed refuses (no push/gh);
  gate-passed pushes over HTTPS with the PAT then `gh pr create --draft -F body`
  (never `-b`), PAT scoped, never `gh pr ready`; no-PAT refuses.

```bash
# tests/pr-open.bats (excerpt)
@test "gate not passed: refuse, no push, no gh" {
  setup_run_with_gate false; install_git_shim_recording; install_gh_shim_recording
  run env FOREMAN_HOME="$FH" bash "$SCRIPTS/pr-open.sh" "$T"; [ "$status" -ne 0 ]
  ! grep -q push "$GIT_ARGV" 2>/dev/null; [ ! -s "$GH_ARGV" ]
}
@test "gate passed: HTTPS PAT push then DRAFT PR with -F, no gh pr ready" {
  setup_run_with_gate true; write_pr_body; set_origin_https; install_git_shim_recording; install_gh_shim_recording
  run env FOREMAN_HOME="$FH" FOREMAN_GH_PAT=tok bash "$SCRIPTS/pr-open.sh" "$T"; [ "$status" -eq 0 ]
  grep -q push "$GIT_ARGV"; grep -qF -- '--draft' "$GH_ARGV"; grep -qF -- '-F' "$GH_ARGV"
  ! grep -qE -- '(^| )-b( |$)' "$GH_ARGV"; ! grep -q 'pr ready' "$GH_ARGV"
}
@test "no PAT: refuse (no ambient fallback)" { setup_run_with_gate true; write_pr_body
  run env FOREMAN_HOME="$FH" bash "$SCRIPTS/pr-open.sh" "$T"; [ "$status" -ne 0 ]; }
@test "ssh origin: refuse (PAT is HTTPS-only)" { setup_run_with_gate true; write_pr_body; set_origin_ssh
  run env FOREMAN_HOME="$FH" FOREMAN_GH_PAT=tok bash "$SCRIPTS/pr-open.sh" "$T"; [ "$status" -ne 0 ]; }
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** past the existing `.pass == true` guard:
  - `require_cmd gh git`; `die EXIT_FAIL` if `FOREMAN_GH_PAT` unset (no fallback).
  - `ORIGIN="$(git_nohooks -C "$WT" remote get-url origin)"`; assert it is
    `https://…github.com/<owner>/<repo>` (N11) — else `die` (the fine-grained PAT
    is HTTPS-only; refuse rather than fall back to an SSH key/ambient credential).
  - Body: `$RD/pr-body.md` (synthesize from `evidence/diff-stat.txt` + `task.md` if absent).
  - Push with the PAT via **`GIT_ASKPASS`** (keeps the token OUT of argv — a
    `-c http.extraHeader=…` would expose the base64 PAT in `ps`/`/proc/…/cmdline`
    to other local users): write a `0700` helper `$RD/.askpass.sh`
    (`#!/usr/bin/env bash` + `printf '%s' "$FOREMAN_GH_PAT"`) that reads the PAT
    from its inherited env, then `git_retry env GIT_ASKPASS="$RD/.askpass.sh"
    GIT_TERMINAL_PROMPT=0 GIT_USERNAME=x-access-token git_nohooks -C "$WT" push -u
    origin "$BRANCH"`; unlink the helper afterward. No ambient credential-helper/SSH
    key participates (origin already asserted HTTPS above).
  - `GH_TOKEN="$FOREMAN_GH_PAT" gh pr create --draft --head "$BRANCH" --base main
    -F "$RD/pr-body.md"` → URL to `$RD/pr-url.txt`. Never `gh pr ready`.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `git commit -m "feat(hard-mode): pr-open HTTPS PAT push + scoped-token draft PR (gate-gated)"`.

---

### Task 6: least-privilege assertions + task.md boilerplate

**Files:** Test additions; Modify `task-new.sh` (N7).

- [ ] **Step 1: Write the failing tests** — (a) launcher-only + container worker
  env dumps carry no `FOREMAN_GH_PAT` / no non-allowlisted host var; (b) container
  args never include `docker.sock`; (c) pr-open exposes the PAT only to the push
  header + the one `gh` call.
- [ ] **Step 2: Run to verify they fail** on any leak.
- [ ] **Step 3: Implement** the allowlist enforcement (built from scratch, Task 3/4);
  fix `task-new.sh:52` ("Work only inside the worktree; commit all changes before
  finishing") → hard-mode-correct ("Work only inside the worktree; do NOT commit —
  the host commits your changes after review"), and `:54` ("No network access is
  available in hard-mode containers") → accurate ("Network egress in the container
  profile is default-deny with an allowlist; the launcher-only profile shares host
  network").
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** `git commit -m "test(hard-mode): least-privilege env allowlist; honest task.md commit/network boilerplate"`.

---

### Task 7: docs + OpenSpec reconciliation

**Files:** Modify `references/security-model.md` + `orchestration-hardening.md` +
the OpenSpec delta under `openspec/changes/hard-mode-launcher/**` (N3).

- [ ] **Step 1** — Hard-mode section: the two profiles + when to pick each; the
  launcher-only network-honesty caveat (process/fs/home isolation, NOT network);
  the container model (file-copy work dir synced back, egress bridge + default-deny
  firewall applied root-then-drop, `--read-only`/`no-new-privileges`/`--tmpfs`, no
  socket, no secrets); host-side evidence + commit + no-in-sandbox-commit; gate →
  HTTPS PAT push → draft PR; `gh pr ready` separate. Update `security-model.md:13`
  (the run flags now shipped) and `:18` (clarify: nothing under OAuth/home
  isolation; exactly the one vendor key under API-key mode). Every command verified
  against the shipped scripts.
- [ ] **Step 2: Reconcile the OpenSpec delta** — `spec.md:11` ("network default
  none") and the proposal/design "worktree COPY" wording now match the shipped
  model (copy + egress-firewall); fix the spec.md internal contradiction (old line
  11 vs the WHERE clauses). Note the reconciliation in the change folder.
- [ ] **Step 3: docs-check + Commit** `git commit -m "docs(hard-mode): profiles, network/mount/commit/PR policy; OpenSpec delta reconciled"`.

---

### Task 8: package proof + full gate

- [ ] **Step 1** — Launcher-only hard-mode task END-TO-END on a trivial change:
  worker supervised → heartbeats mirrored → evidence → host-side commit → gate run
  → pr-open refused when gate fails / draft-PR path exercised (gh shim if no live
  remote). Capture as the FOREMAN_REPORT proof. Container proof = the Docker-guarded
  bats when a daemon is present; state explicitly if Docker was absent.
- [ ] **Step 2: Full gate** — `bash tests/run.sh` under the mutex on a **QUIET
  host** (no concurrent agents/writes) + `docs-check.sh`; `shellcheck` the new scripts.
- [ ] **Step 3: Commit** the proof.

## Self-review

- **Spec coverage:** supervision → T3; worktree (launcher-only `$WT`, container
  copy) → T3/T4; heartbeat mirror → T3; NO in-sandbox commit + host evidence AND
  commit → T3/T4; container default-deny firewall → T4; launcher-only default → T3;
  timeout ⇒ 124 → T3; pr-open gate precondition → T5; HTTPS-PAT push + draft `-F`
  PR → T5; worker holds no credentials + no socket + copy-not-canonical-bind →
  T4/T6; `gh pr ready` separate → T5. All covered.
- **All rev1+rev2 BLOCKING closed:** rev1 #1–#6 and rev2 N1 (`toml_get`), N2
  (file-copy work dir), N6 (Windows-essential env). SHOULD-FIX N3 (OpenSpec
  reconcile T7), N4 (gosu T4), N5 (cap in test T4), N7 (task.md T6), N8 (egress
  bridge T4), N9 (hardened run T4); NITs N10 (`git_nohooks`), N11 (HTTPS assert),
  N12 (ground-truth fixed), N13 (`worker-$VENDOR`), N14 (batch mirror).
- **No invented interfaces:** `toml_get`/`git_nohooks`/`el_init`/`el_emit`, launcher
  flags/stdin-null, `gh pr create` flags, `gate-decision.json` all quoted from
  verified code; T2 re-verifies each vendor's real prompt flag via `--help`.
- **Frozen code untouched:** `lane-run.sh` unchanged; T1/T2 are new libs.
- **Name consistency:** `fl_resolve_launcher`, `wc_build_argv`/`WC_ARGV`,
  `hard_mode.{profile,vendor,timeout}` (via `toml_get`), `LANE="worker-$VENDOR"`,
  `foreman-sandbox`/`foreman-sandbox-net`, `$RD/sandbox-work`, `$RD/evidence/diff-stat.txt`,
  `$RD/pr-body.md`, `$RD/pr-url.txt` — consistent.

## Acceptance

worker-run ships both profiles (launcher-only proven end-to-end incl. the
host-side commit; container Docker-guarded with a coherent egress-bridge+firewall
the worker cannot subvert and a file-copy work dir synced back), pr-open completes
the gate → HTTPS-PAT push → draft-PR flow, least privilege is enforced, the gate
precondition is preserved, and the suite + docs-check + shellcheck are green.
Archive the change folder on ship.
