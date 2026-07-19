# Security model

## Honest limits

Containers (hard mode) share the host/WSL2 kernel — **defense-in-depth, not a
hard boundary**. Soft mode runs implementer CLIs on the host with their native
sandboxes only. Do not claim absolute isolation. The launcher-only hard-mode
profile (below) is process/filesystem/home isolation — it is explicitly **not**
network isolation, and this page previously implied otherwise; see "Hard mode
(shipped)".

## Threat → enforcement map

| Threat | Soft mode | Hard mode |
|---|---|---|
| Worker over-permissioned | Prefer `acceptEdits` / `workspace-write`; re-run checks yourself | launcher-only: process/fs/home isolation via a clean-slate env + worktree scope, no Docker; container: `--cap-drop ALL --cap-add NET_ADMIN,SETUID,SETGID,CHOWN`, `--security-opt no-new-privileges`, `--read-only` root + `--tmpfs /tmp,/run,/home/worker`, egress-capable bridge narrowed by `init-firewall.sh` (default-deny + allowlist) — never `--network none` |
| Tamperable evidence | Architect re-runs verification | Host `~/.foreman/runs/` evidence; never mounted into worker |
| Test/CI gamed | Spec forbids; review diff | Pre-run SHA-256 of hash_paths; forbidden_paths on gate |
| Prompt injection via repo | Cold five-part spec; advisor reads code carefully | Cold-diff auditor; worker output delimited untrusted; no MCP in worker |
| Git hooks as escape | Normal caution | `core.hooksPath=` on worktree + harness git |
| Secrets exposure | Don't paste keys into specs | Worker gets no host secrets ever (no `FOREMAN_GH_PAT`, no `docker.sock`); under OAuth/home-isolated auth the worker gets no vendor key at all, under API-key auth exactly the one vendor key (a documented narrowing, not a hole) |
| Reward hacking ("tests pass") | Re-run verification command | Pristine commit archive for checks |
| Same-vendor blind spots | Prefer Grok implementer + **Codex Sol auditor** + Claude architect | Enforce worker ≠ orchestrator; audit ≠ worker (default audit = Codex Sol) |

## Soft mode residual risk

- Implementer can modify any file the host CLI can write
- No automatic forbidden-path gate — architect must enforce via review
- Use hard mode (or at least worktrees + careful review) for high-stakes autonomy

## Hard mode (shipped)

`worker-run.sh` supervises an untrusted worker under `foreman-launch`
(timeout + heartbeat + whole-tree kill) and selects one of two profiles via
`hard_mode.profile` (`launcher-only`, the default, or `container`). Both
profiles converge on the SAME host-side finalize step: batch-mirror the
launcher's heartbeat file into the event log, then `git_nohooks -C "$WT" add
-A` and `diff --cached --stat` for evidence, then a **host-side commit**
(`git_retry git_nohooks -C "$WT" commit ...`) — the worker itself never runs
`git commit` at all; `task-new.sh`'s `task.md` boilerplate says so
explicitly.

### launcher-only (default, no Docker)

The worker runs directly in the run's worktree (`$WT`) under a clean-slate
env built from scratch (`env -i` + an explicit allowlist — `PATH HOME
USERPROFILE FOREMAN_TASK_ID LANE_VENDOR` plus the vendor home dir, plus
Windows-essential vars on that platform, plus the one vendor API key only
under `hard_mode.auth = api-key`) — never the ambient environment, never
`FOREMAN_GH_PAT`. **This is process/filesystem/home isolation, not network
isolation**: the worker shares the host's network stack outright (no
firewall, no bridge). Pick the container profile when the task needs
network egress narrowed, not just credential/filesystem hygiene.

### container (Docker/WSL2)

The worker runs inside `sandbox/`'s hardened devcontainer against a **clean
file COPY** of the worktree (`$RD/sandbox-work`, built via `git_nohooks -C
"$WT" archive HEAD | tar -x`, no `.git`) — never a bind-mount of `$WT`
itself, since `$WT/.git` is a FILE pointing at the host repo's common gitdir
that must never reach an untrusted container. Egress is an egress-**capable**
user-defined bridge (`foreman-sandbox-net`, NOT `--internal`, NOT `--network
none`) whose actual narrowing comes from `sandbox/init-firewall.sh`, applied
as root by `sandbox/entrypoint.sh` before it drops to the unprivileged
`worker` user via `gosu`: default-deny `OUTPUT` policy (both `iptables` v4
and, where available, `ip6tables` v6 — the allowlist itself is resolved v4
only, so v6 egress is denied outright) with an allowlist of exactly the
worker vendor's API host and the task's git remote host, resolved at
container start from `--env-file`, never baked into the image. `docker run`
adds `--cap-drop ALL --cap-add NET_ADMIN,SETUID,SETGID,CHOWN
--security-opt no-new-privileges --read-only --tmpfs /tmp --tmpfs /run
--tmpfs /home/worker` — `SETUID`/`SETGID`/`CHOWN` are load-bearing for
`gosu`'s root→worker drop and for making the `--tmpfs /home/worker` mount
writable, not decorative, and none of the three survive the `setuid(2)` drop
to reach the worker process itself (verified empirically against the image).
No `docker.sock` mount, no host secrets, ever. The container's `--env-file`
is its own minimal allowlist (`FOREMAN_TASK_ID`, `LANE_VENDOR`, the two
firewall hostnames, and the one vendor key only under API-key auth) —
**never** the launcher-only profile's host-shaped `WORKER_ENV_ALLOW`
(injecting host `PATH`/`HOME` into the container would override the image's
own `PATH` and break `gosu`/`iptables`/the vendor CLI). After the run, the
copy is synced back to `$WT` with a delete-aware mechanism (`rsync -a
--delete --exclude='.git'`, or a portable manifest-diff fallback when rsync
is absent) so the worker's own file deletions/renames propagate — the SAME
host-side evidence + commit step above then runs against `$WT`.

### pr-open: gate → HTTPS PAT push → draft PR

`pr-open.sh` still requires `gate-decision.json.pass == true` before doing
anything. Once passed: it refuses if `FOREMAN_GH_PAT` is unset (no
ambient-credential fallback) and refuses if `origin` is not an HTTPS
`github.com` remote (the fine-grained PAT is HTTPS-only — no falling back to
an SSH key or a cached credential helper). The push uses `GIT_ASKPASS` so the
token never appears in argv (`git -c http.extraHeader=...` would leak it to
`ps`/`/proc/*/cmdline`); `gh pr create --draft --head <branch> --base main -F
<body-file>` opens a draft PR with the token scoped to `GH_TOKEN` for that one
call. `gh pr ready` is a deliberately separate, human-invoked step — never
folded into `pr-open.sh`.

## Operator rules

1. Never pass orchestrator credentials into a worker container
2. Never skip gate on "looks good"
3. Prefer failing closed when audit or checks infrastructure is missing
