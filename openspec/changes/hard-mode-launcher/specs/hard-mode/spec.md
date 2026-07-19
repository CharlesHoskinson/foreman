# Spec delta — launcher-based hard mode (worker-run + pr-open)

EARS-phrased. See `skills/foreman/references/five-part-spec.md`. Approved for
next-release execution.

## ADDED Requirement: worker-run supervises the worker through foreman-launch

WHEN a hard-mode task runs, `worker-run.sh` SHALL spawn the worker under
foreman-launch (timeout + heartbeat + whole-tree kill), with network egress
governed by the selected profile (WHERE clauses below — never a bare
"disabled" default), and SHALL mirror the launcher heartbeats into the run's
event log.

- The worker SHALL NOT commit inside its sandbox; evidence (diff-stat,
  transcript) SHALL be extracted host-side from the worktree.
- WHERE the launcher-only profile is selected (default), the worker SHALL run
  directly in the run's worktree under the launcher + a clean-slate env
  allowlist; this isolates process/filesystem/host-credential exposure but
  SHALL NOT isolate network — the worker shares the host's network stack, and
  Docker SHALL NOT be required.
- WHERE the container profile is selected, the worker SHALL run in a
  devcontainer against a clean file COPY of the worktree (never a bind mount
  of the canonical worktree, whose `.git` is a linked-worktree file pointing
  at the host repo) on an egress-CAPABLE bridge narrowed by a default-deny
  firewall (allowlist of the vendor API host and the git remote host only) —
  never `--network none`; the copy SHALL be synced back to the worktree,
  delete-aware, once the container exits.
- IF the worker exceeds its timeout, THEN foreman-launch SHALL reap the whole
  tree and worker-run SHALL emit the timeout outcome (exit 124 semantics).

#### Scenario: launcher-only hard-mode task with no Docker

- WHEN hard mode runs with the launcher-only profile
- THEN the worker runs supervised with no container, sharing the host
  network, evidence is extracted host-side, and no in-sandbox commit occurs.

## ADDED Requirement: pr-open pushes only after the gate and only host-side

WHEN opening a PR, `pr-open.sh` SHALL first require `gate-decision.json.pass
== true`, THEN push the branch host-side, THEN run `gh pr create --draft
--head <branch> --base main -F <body-file>` with a fine-grained,
single-repo, expiring PAT.

- The worker/container SHALL NEVER hold push credentials; the push and PR
  creation happen host-side after the gate.
- PRs from automation SHALL be `--draft`; `gh pr ready` SHALL be a separate
  human/`pr-ready` step, never folded into creation.
- IF the gate has not passed, THEN pr-open SHALL refuse (exit non-zero) and
  push nothing.

#### Scenario: gate not passed blocks the PR

- WHEN `gate-decision.json.pass` is false or absent
- THEN pr-open exits non-zero and neither pushes nor creates a PR.

## ADDED Requirement: secrets and mounts follow least privilege

The worker SHALL receive no host secrets and no `docker.sock` mount; only a
short-lived, single-repo-scoped token reaches the host-side `gh` call, never
the worker. WHERE the container profile is selected, repo access SHALL be a
file COPY of the worktree, never a bind mount (read-only or otherwise) of the
canonical worktree or its `.git`.
