# Spec delta — v0.3.0 session-transport re-port onto soft-mode

EARS-phrased. See `skills/foreman/references/five-part-spec.md`. Approved for
next-release execution.

## ADDED Requirement: the re-port preserves per-commit provenance

WHEN porting the session-transport surface from `dev/foreman-v1`, the
implementer SHALL use per-commit `git format-patch | git am -3` (three-way,
blob-aware — needs the referenced blobs present locally, not a common
ancestor), and each landed commit SHALL retain the original author/message and
carry a `Ports: dev/foreman-v1@<sha>` trailer.

- The implementer SHALL NOT use `git replace`/grafting (fabricates ancestry,
  misrepresents provenance) or a subtree merge (opaque per-file history) as
  the port mechanism.
- IF a `git am -3` hunk conflicts, THEN the implementer SHALL resolve it as an
  ordinary 3-way conflict against main's CURRENT shape and record the
  resolution, never force main back to the branch's architecture.

## ADDED Requirement: adapters spawn sessions through foreman-launch

WHERE a vendor adapter starts or continues a session, it SHALL spawn the
vendor process through foreman-launch (whole-tree ownership) and the session
SHALL run as a `lane-run --round` unit under the daemon.

- Codex adapters SHALL use `codex mcp-server` with the `codex` (start →
  `threadId`) and `codex-reply` (`threadId` + prompt) tools; Claude adapters
  SHALL use `claude -p` with `--resume <session-id>` / `--continue`.
- The `lib/common.sh` 3-way merge SHALL preserve main's current helpers AND
  the branch's `group_timeout`/watchdog-reap intent, reconciled (not one
  overwriting the other).

## ADDED Requirement: live acceptance gates the merge

The implementer SHALL execute the branch's live-acceptance step (its Task 11)
against a live `codex mcp-server` install, verifying the real MCP tool schema
(names, threadId/conversationId continuity, non-interactive output), and SHALL
record it in `docs/demo-log.md` before any merge to main.

- IF the live schema differs from what the ported adapters assume, THEN the
  implementer SHALL correct the adapters and re-run acceptance — the merge
  SHALL NOT proceed on an unverified schema.
- The grok headless-session-resume path (unverified against xAI docs on the
  branch) SHALL be verified or explicitly marked unsupported before merge.

#### Scenario: live acceptance catches a schema drift

- WHEN live acceptance finds `codex-reply` takes a differently-named param
  than the ported adapter sends
- THEN the adapter is corrected, acceptance re-run green, and only then is
  the merge allowed.

## ADDED Requirement: no v0.2.x behavior regresses

The re-port SHALL be additive to main's current soft-mode surface — the full
existing suite SHALL stay green, and the 11 new session-transport `.bats`
files SHALL be additive, not replacing any current test.
