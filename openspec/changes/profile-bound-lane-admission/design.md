# Design: profile-bound lane admission

## Selected approach

Add a dedicated `credential-profile-lane` runtime. The runtime owns profile
resolution, profile-bound preflight decoding, readiness evaluation, and the
admission result. The shell remains a narrow process adapter.

Do not extend the legacy unscoped `vendor-preflight lane-gate` command. That
command does not own profile identity. Do not derive profile authority only
in shell. The Node runtime must verify every forwarded value.

## Endstop execution packages

Use four execution packages. The admission core owns the TypeScript runtime.
The lane adapter owns the shell boundary. The obsolete-home package owns
worktree cleanup. The release-verification package owns final evidence.

Give each package one persistent Endstop contract. Use the strict default
limits. Permit one audit action, one Council action, and one correction action.
Do not reset limits for a new lane, round, session, or attempt.

Freeze a non-completed terminal package. Continue an independent package when
its dependency path does not include the frozen package. Do not start release
verification until the other three packages reach `Completed`.

## Admission input

The runtime command is:

```text
credential-profile-lane admit --state-root ABS --worktree ABS --profile ID --vendor grok|codex
```

Reject missing, duplicate, unknown, or reordered flag pairs. Reject relative
paths, invalid profile ids, unsupported vendors, NUL, CR, or LF in path
arguments, and a state root that equals or enters the worktree.

`lane-run.sh` selects `LANE_CREDENTIAL_PROFILE` when set. Otherwise, Grok uses
`grok-default` and Codex uses `codex-default`.

## Admission flow

1. Resolve the R7A profile with the supplied state root, worktree, profile id,
   and vendor.
2. Require a `Ready` result.
3. Read the R7B1 wrapper from the exact profile-scoped path.
4. Require the wrapper profile id, profile identity, and vendor to match the
   resolved profile.
5. Require all nested vendor-preflight facts to be ready.
6. Resolve the profile again.
7. Require the second result to match the first profile id, vendor, profile
   identity, and config root.
8. Emit the verified config root with exactly one trailing LF.

The runtime does not resolve a vendor executable. It does not run a process.
It does not run an auth or version probe. It does not authenticate. It does
not read vendor credential files.

## Live lane adapter

`lane-run.sh` calls `credential-profile-lane.js` before unowned dispatch,
harness creation, stale-lock cleanup, lock acquisition, secret scanning,
event emission, or command spawn.

The shell captures the runtime output in a temporary file. It requires exit
zero, exactly one nonempty LF-terminated line, and no second line. It removes
the temporary file on every exit path. The runtime has already rejected CR,
LF, and NUL in the verified config root.

After admission, the shell:

- sets `LANE_CONFIG_DIR` to the verified config root
- sets only the matching `GROK_HOME` or `CODEX_HOME`
- removes the nonmatching vendor-home variable
- ignores ambient vendor-home authority

An explicit `LANE_CONFIG_DIR` must equal the verified config root after the
existing platform normalization. Otherwise, the lane refuses.

## Worktree cleanup

`wt-new.sh` no longer creates or reports:

```text
<worktree>/.harness/vendor-home/grok
<worktree>/.harness/vendor-home/codex
```

The worktree can still contain `.harness` for lane-owned state. Credential
configuration remains only under the external profile authority.

## Failure behavior

Use closed failure reasons for invalid arguments, missing authority, invalid
authority, profile mismatch, not-ready preflight, linked path, identity
change, and unreadable state. Diagnostics do not contain paths, record bytes,
environment values, exception text, or credential content.

Any admission failure stops the lane before a durable side effect. The unset
`LANE_VENDOR` path remains unchanged.

## Out of scope

- R7C profile-use leasing and concurrent use controls
- vendor login or credential migration
- complete `lane-run.sh` migration
- removal of the legacy unscoped preflight compatibility record
