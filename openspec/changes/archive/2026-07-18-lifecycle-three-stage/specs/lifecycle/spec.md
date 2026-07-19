# Spec delta — foreman three-stage lifecycle (Setup / Use / Cleanup)

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirement: foreman operates in three ordered stages

Foreman SHALL define and document three ordered stages — **Setup &
Environment**, **Use**, **Cleanup** — and SHALL NOT begin Use until Setup has
reported READY.

- The stages SHALL be invocable independently (a Setup run, a Cleanup run) and
  SHALL compose the existing tool-check/bootstrap/wt-cleanup/lane-supervise
  scripts rather than replacing them.
- WHEN a Use action is requested WHILE Setup has not reported READY for the
  required lanes, the implementer SHALL refuse and point at Setup, rather than
  failing partway through a round.

## ADDED Requirement: Setup owns all model authentication

WHEN Setup runs, the implementer SHALL provision and authenticate every
configured vendor CLI — at minimum grok, codex, and claude — and SHALL emit a
per-vendor authenticated/not-authenticated verdict; authentication SHALL NOT
occur during Use.

- WHERE a vendor needs interactive/device auth (grok `login --device-code`),
  Setup SHALL either complete it or emit a clear, actionable "run this to
  authenticate" instruction and mark that vendor NOT-READY.
- WHERE a vendor accepts a key (`XAI_API_KEY`, etc.), Setup SHALL verify the
  key authenticates (a minimal probe), not merely that the variable is set.
- Setup SHALL be idempotent: a second run on an already-authenticated,
  already-provisioned host SHALL change nothing and re-report READY.
- IF a required vendor for a planned lane is NOT-READY at the end of Setup,
  THEN the readiness verdict SHALL be NOT-READY for that lane and Use SHALL
  refuse to route to it.

#### Scenario: grok unauthenticated blocks its lane at the door

- WHEN Setup runs on a host where grok is installed but not signed in
- THEN Setup reports grok NOT-READY with the device-code instruction
- AND a Use request to route a spec to grok is refused, citing Setup —
  never a mid-round grok auth failure.

#### Scenario: idempotent re-run

- WHEN Setup runs twice on a fully-provisioned, authenticated host
- THEN the second run makes no changes and re-reports READY.

## ADDED Requirement: Setup emits a machine-readable readiness verdict

Setup SHALL extend tool-check to emit a readiness verdict covering: required
tools present at acceptable versions, per-vendor auth state, and (where
applicable) WSL provisioning state, as structured output a caller can gate on.

- The verdict SHALL distinguish MISSING (tool absent), OUTDATED (present,
  wrong version), NOT-AUTHENTICATED (present, no valid auth), and READY.

## ADDED Requirement: Cleanup runs a deterministic teardown set

WHEN Cleanup runs, the implementer SHALL, in order: SIGINT lane subprocesses,
run wt-cleanup with the porcelain-check-before-delete + report-archive rules
(worktree-hardening), release the gate lock / stop any foreman-owned `pueued`
if this run started it, and sweep stale locks — and SHALL be safe to run more
than once.

- Cleanup SHALL NOT delete a worktree with uncommitted/untracked work unless
  forced (the worktree-hardening rule), and SHALL archive reports first.
- IF Cleanup is interrupted, THEN a re-run SHALL complete the remaining
  teardown without error (idempotent).

#### Scenario: Cleanup preserves dirty work

- WHEN Cleanup runs against a worktree with an uncommitted file
- THEN it archives reports and leaves the worktree, reporting what it skipped.

## MODIFIED Requirement: SKILL.md documents the lifecycle as the operating frame

`skills/foreman/SKILL.md` SHALL present Setup & Environment → Use → Cleanup as
the top-level operating model, with the Setup readiness gate stated as a hard
precondition to Use and Cleanup stated as the required close of every run.

- The doctrine SHALL state that auth is a Setup concern, that Use assumes a
  provisioned+authenticated environment, and that the same three stages run on
  both Windows and WSL (full-WSL setup).
