# Design: bounded fixture-aware secret scan

## Selected approach

Move Grok worktree secret-scan domain logic into TypeScript Effect code.
Keep `lane-run.sh` as a thin adapter that calls the tracked Node bundle after
vendor readiness and before any Grok command spawn.

## Scan model

The live scanner accepts one preflighted absolute worktree root.
It never follows symbolic links and never leaves that root.
It prunes only the top-level `.git/` and `.harness/` directories, matching the
current shell guard.

Refusal classes stay the same:

- filename: `.env`, `.env.*` except `.env.example`, and common private-key names
- content: a PEM private-key header at the start of a line

## Descriptor-anchor traversal

The scanner binds the worktree root to a stable no-follow directory identity
before reading the fixture declaration or traversing any entry.
It binds each child directory before descent and traverses only through the
held descriptor-anchor chain (`O_DIRECTORY|O_NOFOLLOW` and
`/proc/self/fd/<fd>` where supported).

It does not validate a directory and later reopen it by the original pathname.
A root or nested-directory pathname swapped for a symlink after bind must not
change the verdict or expose outside content.

When the host cannot provide a secure directory anchor, the live scanner fails
closed with `unsupported_traversal`. There is no pathname fallback.
Every directory descriptor closes on Clean, SecretFound, Refused, and
thrown-seam paths.
Fixture declaration and regular-file reads use the same bound directory chain
and keep the existing file identity recheck.

Tests may inject a false capability only to prove fail-closed
`unsupported_traversal` on every platform. Production callers always use the
real probe. The suite does not emulate descriptor anchors on Windows; live
traversal cases skip when anchors are unavailable, while pure classifiers and
the injected fail-closed case always run.

## Bounds

Every traversal applies positive bounds for directory entries, files,
relative-path UTF-8 bytes, bytes per inspected file, total inspected bytes,
and line inspections.
Exact-bound inputs pass.
Bound plus one fails closed as `refused` with reason `bound_exceeded`.

Unreadable entries, identity changes, unsupported traversal, and malformed
fixture declarations also fail closed.
Public output never leaks paths, file content, environment values, stacks, or
exception text.

## Fixture exemptions

Exemptions use exact identity: repository-relative path plus lowercase SHA-256
of the complete regular-file bytes.
Declarations live at `tests/fixtures/secret-scan-exemptions.json`.
Only paths under `tests/fixtures/` are valid exemption targets.
A one-byte change invalidates the exemption and the normal scanner applies.
`.env` and private-key filenames outside that subtree are never exempt.

## CLI and shell seam

The CLI emits one canonical JSON line.
Exit 0 means clean only.
Any secret or fail-closed result is nonzero.
`lane_grok_secrets_scan` calls `runtime/dist/secret-scan.js` with the absolute
worktree root.
There is no direct-spawn fallback and no new runtime dependency.

## Boundaries

This change does not alter Codex or unset-vendor paths.
It does not provision credentials.
It does not replace the full lane-run ownership or lock model.
