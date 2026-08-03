# v0.2.8.2 residuals

This file states the known limits of v0.2.8.2. It is current release guidance,
not a historical audit log.

## External pilot boundary

- The external pilot covers one Gobox change: the DOSBox dependency-closure
  installer. It does not prove general compatibility with every repository or
  build system.
- The pilot passed Gobox `make check` and Foreman's pristine-archive gate. It
  did not test a stateful service target, a monorepo with multiple independent
  gates, or a target on a Windows filesystem.
- The pilot worker was Grok and the cold diff reviewer was Codex. Other worker
  and reviewer combinations were not part of this release proof.

## Orchestration residuals

- Pueue can report its socket as ready and then reject an immediate enqueue
  with `connection refused`. The Council dogfood run reproduced this condition
  and used direct Foreman round ownership. Queue admission needs a separate
  readiness fix.
- A Foreman target worktree can receive `.harness` and `FOREMAN_REPORT.*`
  artifacts. The Gobox product commit excluded them, but artifact placement and
  changed-file telemetry still need a cleaner target boundary.
- The pilot used one bounded cold audit and two rework rounds. This proves the
  hard-stop policy for that workload; it does not prove automatic enforcement
  for every lane entry point.
- External support still depends on an explicit target check. Foreman detects
  Make and Go gates, but an unfamiliar repository can require an operator
  check override.

## Provider residuals

- The local Grok CLI is stable `0.2.118`. The existing Foreman adapter still
  records `0.2.114` as its verified version. Do not update that declaration
  until a real canary passes on the newer CLI.
- Council v0.3 work is on separate draft pull requests. Its ACE preflight and
  TypeScript Grok transport are not part of v0.2.8.2 and do not change this
  release's supported interface.

## Platform and gate residuals

- The Linux workflow runs the full Bats gate. The Windows workflow is required
  to be green, but its Bats coverage remains a non-gating probe. A green
  Windows workflow is not a claim that all Bats tests ran on Windows.
- The Linux workflow now installs checksum-pinned NATS Server 2.14.4 and NATS
  CLI 0.4.0 binaries. Foreman PR #10 passed all 12 NATS integration tests.
  Windows does not make the same NATS integration claim.
- WSL can fall back from an unavailable process namespace to `setsid` and a
  process group. That fallback does not provide the same kernel cascade
  guarantee as a process namespace.
- The repository still contains shell and Python implementation modules. The
  Node.js and TypeScript migration is a separate roadmap and is not complete
  in this release. New Council executable code follows the Node.js and
  TypeScript rule.

## Scope and cleanup residuals

- The withdrawn v0.2.9 work is preserved at `v0.2.9-preserve`. Formal, graph,
  Tier 2, and wrong-premise package cuts were not executed in this release.
- Historical research, evidence, archived OpenSpec packages, and SessionDB
  facts can name v0.2.9. They are retained as dated evidence and are not
  current guidance.
- Dirty worktrees were not removed in bulk. Each worktree still requires an
  ownership and recovery check before removal.
- The `dev/foreman-v1` session-transport branch was not merged or evaluated as
  part of v0.2.8.2.
- The stale generated knowledge graph must not be promoted. A fresh graph must
  record its source commit and pass graph queries before it replaces the old
  output.

## Commands to re-verify release claims

```bash
FOREMAN_CI_BATS=1 bash tools/ci-local.sh
gh run list --workflow gates-linux.yml --branch main
gh run list --workflow gates-windows.yml --branch main
git rev-parse main origin/main
git rev-list -n 1 v0.2.9-preserve
git -C /home/charl/gobox rev-parse main origin/main
git -C /home/charl/gobox status --short
```

The release notes must record the exact commit used for final verification.
