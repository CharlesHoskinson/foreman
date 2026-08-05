# Spec delta: Grok secret scan TypeScript runtime

## ADDED Requirements

### Requirement: secret scan uses a closed typed result

`@foreman/orchestration` SHALL export a closed typed scan result and an Effect
service or Effect-returning API for the Grok worktree secret scan.

The result SHALL be one of `Clean`, `SecretFound`, or `Refused` with a closed
refusal reason set.

#### Scenario: a clean worktree is scanned

- WHEN the worktree has no refused filename or PEM private-key header
- AND no bound or boundary failure occurs
- THEN the result is `Clean`.

### Requirement: the live scanner stays inside one absolute root

The live scanner SHALL accept one preflighted absolute worktree root.
It SHALL NOT follow symbolic links.
It SHALL NOT leave that root.
It SHALL prune top-level `.git/` and `.harness/` exactly as the prior shell
guard did.

#### Scenario: a secret sits only under top-level .harness

- WHEN `.harness/vendor-home/grok/.env` exists
- AND no secret exists outside pruned roots
- THEN the scan result is `Clean`.

### Requirement: filename and PEM refusal classes are preserved

The scanner SHALL refuse `.env` and `.env.*` except `.env.example`.
It SHALL refuse the existing common private-key filename classes.
It SHALL refuse a PEM private-key header at the start of a line.
It SHALL accept documentation that mentions a private-key marker inline.

#### Scenario: an id_rsa file has no PEM banner

- WHEN a regular file named `id_rsa` exists in the worktree source tree
- THEN the scan result is `SecretFound`.

### Requirement: bounds fail closed

The scanner SHALL apply explicit positive bounds for directory entries, files,
relative-path UTF-8 bytes, bytes per inspected file, total inspected bytes, and
line inspections.
Exact-bound inputs SHALL pass.
Bound plus one SHALL fail closed as `Refused` with reason `bound_exceeded`.

Unreadable entries, identity changes, unsupported safe traversal, and malformed
fixture declarations SHALL fail closed without leaking paths, content,
environment values, stacks, or exception text.

#### Scenario: the file count is one above the bound

- WHEN the worktree has maxFiles plus one regular files
- THEN the scan result is `Refused`
- AND the reason is `bound_exceeded`.

### Requirement: fixture exemptions use exact identity

Fixture exemption SHALL use repository-relative path plus lowercase SHA-256 of
the complete regular-file bytes.
Exemptions SHALL be limited to the closed fixture subtree `tests/fixtures/`.
A changed byte SHALL invalidate the exemption and the normal scanner SHALL
apply.
The scanner SHALL never exempt `.env` or private-key filenames outside that
subtree.

#### Scenario: a declared fixture digest matches exactly

- WHEN a refused-class file under `tests/fixtures/` matches a declared path and
  SHA-256
- THEN the scan result is `Clean`.

#### Scenario: one byte of a declared fixture changes

- WHEN the path is declared
- AND the file bytes no longer match the declared SHA-256
- THEN the scan result is `SecretFound`.

### Requirement: the CLI is secret-safe and fail-closed

The CLI SHALL emit one canonical JSON line.
It SHALL use exit 0 only for a clean scan.
It SHALL use a nonzero exit for secret found or any indeterminate or fail-closed
result.
Stdout and stderr SHALL NOT include paths, secret content, environment values,
stacks, or exception text for those outcomes.

#### Scenario: a worktree contains .env

- WHEN the CLI scans that worktree
- THEN exit status is nonzero
- AND the JSON verdict is `secret_found`
- AND output does not include the path or file content.

### Requirement: lane-run uses a thin Node adapter

`lane_grok_secrets_scan` SHALL call the tracked Node runtime bundle and SHALL
contain no find or grep secret-scan business logic.
The Grok branch SHALL run the scan after vendor readiness and before any Grok
command spawn.
On refuse it SHALL emit `alert{kind:"grok_secrets_refused"}` and exit nonzero.
Codex and unset-vendor paths SHALL remain unaffected.
There SHALL be no direct-spawn fallback and no new runtime dependency.

#### Scenario: Grok meets a worktree with .env

- WHEN `LANE_VENDOR=grok` and the worktree contains `.env`
- THEN CMD is not spawned
- AND the event log contains `grok_secrets_refused`
- AND exit status is nonzero.

#### Scenario: Codex meets a worktree with .env

- WHEN `LANE_VENDOR=codex` and the worktree contains `.env`
- THEN the secrets scan does not block the lane
- AND CMD runs.
