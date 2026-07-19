#!/usr/bin/env bats
# @description Launcher-only profile tests for worker-run.sh (hard-mode
#   Task 3): supervision under a fake foreman-launch, batch heartbeat
#   mirroring into the event log, host-side evidence + commit (the worker
#   itself never commits), a clean-slate env (no ambient secrets reach the
#   worker), and the launcher's 124 (timeout) contract. The container
#   profile (Task 4) is intentionally NOT covered here.
#
# Test-only seam: FOREMAN_WORKER_CMD_SHIM. wc_build_argv (lib/worker-cmd.sh)
# always builds a real vendor invocation (argv[0] = "grok"/"codex", neither
# installed in CI); worker-run.sh honors FOREMAN_WORKER_CMD_SHIM by
# substituting argv[0] with the given path when set, exactly analogous to
# the existing FOREMAN_LAUNCH seam for the launcher binary itself. This
# lets these tests exercise the real argv-building + spawn plumbing against
# a fake worker executable instead of a real grok/codex install.

# @description Create $FH (isolated FOREMAN_HOME), a throwaway git repo
#   acting as both repo_root and worktree (WT), and this run's meta.json +
#   task.md — everything worker-run.sh needs to start.
# @set FH FOREMAN_HOME for this test
# @set T task id
# @set ROOT / WT repo root and worktree path (same directory here — the
#   linked-worktree distinction only matters for the container profile,
#   Task 4, not exercised by this file)
# @set BRANCH / BASE_SHA the run's branch and base commit
# @set RD the run directory
# @set SCRIPTS skills/foreman/scripts in the real checkout
# @set SHIMS a scratch dir for fake executables this test installs
setup_run_with_meta() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/foreman-home"
  FH="$FOREMAN_HOME"
  mkdir -p "$FH"

  T="t1"
  ROOT="$BATS_TEST_TMPDIR/repo"
  WT="$ROOT"
  mkdir -p "$ROOT"
  git -C "$ROOT" init -q -b main
  git -C "$ROOT" config user.email t@e.com
  git -C "$ROOT" config user.name t
  echo base > "$ROOT/f"
  git -C "$ROOT" add -A
  git -C "$ROOT" commit -qm base
  BASE_SHA="$(git -C "$ROOT" rev-parse HEAD)"
  BRANCH="ai/$T"
  git -C "$ROOT" checkout -qb "$BRANCH"

  RD="$FH/runs/$T"
  mkdir -p "$RD"
  jq -n --arg t "$T" --arg r "$ROOT" --arg w "$WT" --arg b "$BRANCH" --arg s "$BASE_SHA" \
    '{task_id:$t, repo_root:$r, worktree:$w, branch:$b, base_sha:$s}' > "$RD/meta.json"
  cat > "$RD/task.md" <<'EOF'
# Task t1

## Goal
Trivial test task: edit a file.
EOF

  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  SHIMS="$BATS_TEST_TMPDIR/shims"
  mkdir -p "$SHIMS"
  export ROOT WT T BRANCH BASE_SHA RD SCRIPTS SHIMS
}

# @description Fake foreman-launch: parses --heartbeat-file out of its own
#   args, writes >=1 heartbeat JSON line (matching the real schema's field
#   names closely enough for jq consumers), then execs everything after
#   `--` as the real CMD and exits with its status. Also installs a worker
#   CMD shim (at $SHIMS/worker.sh) that edits $WT/work.txt (giving the host
#   commit something to capture) and dumps its own environment to
#   $SHIMS/worker-env-dump.txt (so a test can assert no secret leaked
#   through). Sets FAKE_LAUNCH.
make_fake_launcher_writing_heartbeat_then_running_cmd() {
  local f="$BATS_TEST_TMPDIR/fake-launcher.sh"
  cat > "$f" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
hb=""
args=("$@")
i=0
cmd=()
while [[ $i -lt ${#args[@]} ]]; do
  case "${args[$i]}" in
    --heartbeat-file) hb="${args[$((i+1))]}"; i=$((i+2)) ;;
    --) i=$((i+1)); cmd=("${args[@]:$i}"); break ;;
    *) i=$((i+1)) ;;
  esac
done
if [[ -n "$hb" ]]; then
  printf '{"ts":"2026-07-18T00:00:00.000Z","launcher_pid":%d,"pid":%d,"job_id":"1","alive":true,"stdout_bytes":0,"stderr_bytes":0,"elapsed_s":0.1}\n' "$$" "$$" >> "$hb"
fi
rc=0
if [[ ${#cmd[@]} -gt 0 ]]; then
  "${cmd[@]}" || rc=$?
fi
if [[ -n "$hb" ]]; then
  printf '{"ts":"2026-07-18T00:00:01.000Z","launcher_pid":%d,"pid":%d,"job_id":"1","alive":false,"stdout_bytes":0,"stderr_bytes":0,"elapsed_s":0.2}\n' "$$" "$$" >> "$hb"
fi
exit "$rc"
EOF
  chmod +x "$f"
  FAKE_LAUNCH="$f"

  local w="$SHIMS/worker.sh"
  cat > "$w" <<EOF
#!/usr/bin/env bash
env > "$SHIMS/worker-env-dump.txt"
echo edited >> "$WT/work.txt"
EOF
  chmod +x "$w"
  export FAKE_LAUNCH
}

# @description Fake foreman-launch that ignores CMD entirely and exits with
#   a fixed code — stands in for a launcher that already killed CMD (e.g. a
#   real timeout: exit 124) before returning. Sets FAKE_LAUNCH.
# @arg $1 exit code to return
make_fake_launcher_exiting() {
  local code="$1" f="$BATS_TEST_TMPDIR/fake-launcher-exit.sh"
  cat > "$f" <<EOF
#!/usr/bin/env bash
exit $code
EOF
  chmod +x "$f"
  FAKE_LAUNCH="$f"
  export FAKE_LAUNCH
}

@test "launcher-only: supervise, mirror, evidence, host commit, clean env" {
  setup_run_with_meta
  make_fake_launcher_writing_heartbeat_then_running_cmd
  run env FOREMAN_LAUNCH="$FAKE_LAUNCH" FOREMAN_HOME="$FH" FOREMAN_GH_PAT="SECRET" \
    FOREMAN_WORKER_CMD_SHIM="$SHIMS/worker.sh" bash "$SCRIPTS/worker-run.sh" "$T"
  [ "$status" -eq 0 ]
  grep -q '"type":"heartbeat"' "$FH/runs/$T/events.jsonl"
  # evidence is non-empty AND names the file the worker created (a plain
  # `diff BASE_SHA` before `add -A` would omit the untracked new file and
  # leave this empty — the bug the post-`add -A` `--cached` diff fixes).
  [ -s "$FH/runs/$T/evidence/diff-stat.txt" ]
  grep -q 'work.txt' "$FH/runs/$T/evidence/diff-stat.txt"
  # exactly one commit over base, HOST-authored (the worker shim never runs
  # git), and it actually contains the worker's file.
  [ "$(git -C "$WT" rev-list --count "$BASE_SHA"..HEAD)" -eq 1 ]
  [ "$(git -C "$WT" log -1 --format='%ae')" = "t@e.com" ]
  git -C "$WT" show HEAD --stat | grep -q 'work.txt'
  ! grep -q SECRET "$SHIMS/worker-env-dump.txt"
}

@test "launcher-only: timeout => 124 + timeout alert" {
  setup_run_with_meta
  make_fake_launcher_exiting 124
  run env FOREMAN_LAUNCH="$FAKE_LAUNCH" FOREMAN_HOME="$FH" bash "$SCRIPTS/worker-run.sh" "$T"
  [ "$status" -eq 124 ]
  grep -q '"kind":"worker_timeout"' "$FH/runs/$T/events.jsonl"
}

# =======================================================================
# Task 4: container profile (Docker-guarded)
#
# The two shim tests below reuse setup_run_with_meta and
# make_fake_launcher_writing_heartbeat_then_running_cmd from Task 3 above —
# same isolated $FH/$WT/$RD, same deterministic fake foreman-launch. A real
# Docker daemon's own timeout/heartbeat semantics aren't needed to prove
# worker-run.sh's OWN docker-invocation plumbing (mounts, flags, env-file,
# network, sync-back) — that is what these two tests assert on. The one
# test that needs a real Docker daemon (image build + hardened run) is
# separately Docker-guarded at the bottom of this section.
# =======================================================================

# @description Install a fake `docker` on PATH that records every
#   invocation's full argv, one line per call, to $DOCKER_ARGV.
#   `network inspect` always misses (exit 1), forcing worker-run.sh's
#   create-if-absent branch to actually call `network create`; `network
#   create` and `run` both succeed (exit 0) without ever touching a real
#   container. Sets DOCKER_ARGV.
# @set DOCKER_ARGV path to the recorded-argv file
install_docker_shim_recording_argv() {
  local dir="$BATS_TEST_TMPDIR/docker-shim"
  mkdir -p "$dir"
  DOCKER_ARGV="$BATS_TEST_TMPDIR/docker-argv.txt"
  : > "$DOCKER_ARGV"
  cat > "$dir/docker" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$DOCKER_ARGV"
case "\$1" in
  network)
    case "\$2" in
      inspect) exit 1 ;;
      *) exit 0 ;;
    esac
    ;;
  run) exit 0 ;;
  *) exit 0 ;;
esac
EOF
  chmod +x "$dir/docker"
  export PATH="$dir:$PATH"
  export DOCKER_ARGV
}

# @description Like install_docker_shim_recording_argv, but its `docker run`
#   ALSO deletes the given host path before exiting — standing in for a
#   worker (running for real inside a container this shim never actually
#   creates) that deleted a file in its copy of the worktree. Proves
#   worker-run.sh's rsync sync-back is delete-aware (`--delete`), not merely
#   additive (a plain `tar -x` sync-back would leave the file behind).
# @arg $1 path absolute host path to delete when `docker run` is invoked
# @set DOCKER_ARGV path to the recorded-argv file
install_docker_shim_deleting() {
  local target="$1"
  local dir="$BATS_TEST_TMPDIR/docker-shim"
  mkdir -p "$dir"
  DOCKER_ARGV="$BATS_TEST_TMPDIR/docker-argv.txt"
  : > "$DOCKER_ARGV"
  cat > "$dir/docker" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$DOCKER_ARGV"
case "\$1" in
  network)
    case "\$2" in
      inspect) exit 1 ;;
      *) exit 0 ;;
    esac
    ;;
  run)
    rm -f "$target"
    exit 0
    ;;
  *) exit 0 ;;
esac
EOF
  chmod +x "$dir/docker"
  export PATH="$dir:$PATH"
  export DOCKER_ARGV
}

# @description Rewrite this run's meta.json base_sha in place (the deletion
#   test commits a second, later base on top of setup_run_with_meta's own
#   initial commit, so the "file to delete" actually exists in the archived
#   HEAD the container branch copies from) and refresh the caller's own
#   $BASE_SHA to match.
# @arg $1 new base_sha
update_meta_base() {
  local new_base="$1" tmp="$RD/meta.json.tmp"
  jq --arg s "$new_base" '.base_sha = $s' "$RD/meta.json" > "$tmp" && mv "$tmp" "$RD/meta.json"
  BASE_SHA="$new_base"
}

@test "container: copy dir mounted rw, egress bridge, hardened flags, no socket/PAT" {
  setup_run_with_meta
  make_fake_launcher_writing_heartbeat_then_running_cmd
  install_docker_shim_recording_argv
  run env FOREMAN_LAUNCH="$FAKE_LAUNCH" FOREMAN_HOME="$FH" FOREMAN_GH_PAT="SECRET" \
    bash "$SCRIPTS/worker-run.sh" "$T" --profile container
  [ "$status" -eq 0 ]
  grep -qE -- "-v [^ ]*sandbox-work:/work" "$DOCKER_ARGV"     # the COPY, not $WT
  ! grep -qF "$WT/.git" "$DOCKER_ARGV"
  ! grep -qE -- '--network[= ](none|.*--internal)' "$DOCKER_ARGV"
  grep -qF -- '--cap-drop ALL' "$DOCKER_ARGV"
  grep -qF -- '--cap-add NET_ADMIN' "$DOCKER_ARGV"
  grep -qF -- '--security-opt no-new-privileges' "$DOCKER_ARGV"
  grep -qF -- '--read-only' "$DOCKER_ARGV"
  grep -qF -- '--tmpfs /home/worker' "$DOCKER_ARGV"           # writable HOME
  grep -qF -- '--tmpfs /run' "$DOCKER_ARGV"                   # iptables lock
  ! grep -qF 'docker.sock' "$DOCKER_ARGV"
  ! grep -qF SECRET "$DOCKER_ARGV"
  # Bonus (beyond the plan's literal assertion list): the container env-file
  # itself never carries the ambient secret either, not just the argv.
  ! grep -qF SECRET "$RD/sandbox.env"
  # Regression guard for the host-var leak: the container env-file must carry
  # a CONTAINER allowlist ONLY — never the native host's PATH/HOME/USERPROFILE/
  # <vendor>_HOME (injecting those via --env-file overrides the image PATH so
  # gosu/iptables/the vendor CLI stop resolving and the container fails).
  ! grep -qE '^(PATH|HOME|USERPROFILE|GROK_HOME|CODEX_HOME)=' "$RD/sandbox.env"
}

@test "container: worker file DELETION propagates to the host commit (rsync --delete)" {
  setup_run_with_meta
  echo old > "$WT/todelete.txt"
  git -C "$WT" add -A && git -C "$WT" commit -qm base
  BASE_SHA="$(git -C "$WT" rev-parse HEAD)"
  update_meta_base "$BASE_SHA"
  make_fake_launcher_writing_heartbeat_then_running_cmd
  install_docker_shim_deleting "$RD/sandbox-work/todelete.txt"
  # FOREMAN_SYNC_NO_RSYNC pins the portable manifest-diff fallback (the riskier
  # custom code) deterministically, regardless of whether this host has rsync.
  run env FOREMAN_HOME="$FH" FOREMAN_LAUNCH="$FAKE_LAUNCH" FOREMAN_SYNC_NO_RSYNC=1 \
    bash "$SCRIPTS/worker-run.sh" "$T" --profile container
  [ "$status" -eq 0 ]
  [ ! -f "$WT/todelete.txt" ]                                 # deletion synced back
  git -C "$WT" show HEAD --stat | grep -q 'todelete.txt'      # and captured in the commit
}

@test "container: real Docker - hardened run (read-only) firewall default-deny + worker unprivileged" {
  command -v docker >/dev/null && docker info >/dev/null 2>&1 || skip "docker unavailable"
  run docker build -t foreman-sandbox:test "$BATS_TEST_DIRNAME/../sandbox"
  [ "$status" -eq 0 ]
  # Exercise the SHIPPED run posture: read-only rootfs + tmpfs, cap-drop,
  # NET_ADMIN. SETUID/SETGID/CHOWN are ALSO part of the shipped posture
  # (worker-run.sh's own docker run, sandbox/devcontainer.json) — a
  # deviation from an earlier reading of the plan's literal capability list,
  # verified necessary against this exact image: without SETUID+SETGID
  # gosu's setuid(2) drop fails outright ("failed switching to \"worker\":
  # operation not permitted") and the container never starts the real
  # command at all; without CHOWN the --tmpfs /home/worker mount stays
  # root:root 0755 and the third assertion below (HOME writable) fails.
  # None of the three reach the worker — see sandbox/entrypoint.sh.
  # -e FOREMAN_VENDOR_API_HOST=<resolvable host>: worker-run.sh's real run
  # supplies this (+ FOREMAN_GIT_HOST) so init-firewall resolves a non-empty
  # allowlist; --check REQUIRES a non-empty allowlist (count>0), so a bare run
  # without it would (correctly) fail. DNS egress is allowed before the DROP
  # flip, so the host resolves at container start.
  local HARDEN=(--rm -e FOREMAN_VENDOR_API_HOST=api.openai.com \
                --cap-drop ALL --cap-add NET_ADMIN --cap-add SETUID --cap-add SETGID --cap-add CHOWN \
                --security-opt no-new-privileges --read-only --tmpfs /tmp --tmpfs /run --tmpfs /home/worker)
  run docker run "${HARDEN[@]}" foreman-sandbox:test /init-firewall.sh --check
  [ "$status" -eq 0 ]
  run docker run "${HARDEN[@]}" foreman-sandbox:test id -un
  [ "$output" != "root" ]   # N5: full entrypoint runs
  run docker run "${HARDEN[@]}" foreman-sandbox:test sh -c 'touch $HOME/x && echo ok'
  [ "$output" = ok ]        # HOME writable
}
