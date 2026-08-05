# Spec delta: profile-use leasing

## ADDED Requirements

### Requirement: profile use is exclusive across worktrees

Foreman SHALL allow at most one live Grok or Codex lane to use one credential
profile id. Different profile ids SHALL remain independent.

#### Scenario: second worktree uses the same profile

- WHEN one lane holds profile `grok-default`
- AND another worktree requests profile `grok-default`
- THEN the second lane refuses with `busy`
- AND the first lane continues.

#### Scenario: worktrees use different profiles

- WHEN two lanes request different ready profile ids
- THEN both leases can be held at the same time.

### Requirement: lease binds admission to use

The Node.js holder SHALL perform R7B2 admission before lease creation. It SHALL
re-resolve the profile immediately before acquisition. It SHALL require exact
profile id, vendor, profile identity, and config root equality.

#### Scenario: profile changes after admission

- WHEN profile authority changes before lease acquisition
- THEN acquisition refuses with a closed reason
- AND no vendor process starts.

### Requirement: scoped holder spans the complete lane lifecycle

The holder SHALL acquire through `Effect.acquireRelease`. It SHALL remain in
the same scope until its stdin reaches EOF or the process receives a handled
termination signal. The live lane SHALL keep the holder input open through
command, gate, checkpoint, timeout, and failure handling.

#### Scenario: lane finishes normally

- WHEN the vendor command and all lane work finish
- THEN cleanup closes the holder input
- AND the lease is released
- AND a later lane can acquire the same profile.

#### Scenario: parent process dies

- WHEN the parent lane process dies
- THEN the kernel closes the holder pipe
- AND the holder scope releases the lease.

### Requirement: lease refusal precedes existing durable lane effects

The holder SHALL report admission or lease refusal before `lane-run.sh` creates
the worktree lane lock, emits an event, runs a secret scan, or starts a vendor
process.

#### Scenario: profile is busy

- WHEN the selected profile already has a lease
- THEN the lane refuses
- AND it creates no worktree lane lock or lane event
- AND it starts no vendor process.

### Requirement: lease authority is external and fail closed

The lease path SHALL be
`<state-root>/credential-profile-leases/<profile-id>.lock`. Lease directories
SHALL be created exclusively and non-recursively. Links, files, unsafe modes,
unreadable components, and identity changes SHALL be refusals.

The implementation SHALL NOT reclaim an existing lease automatically. Release
SHALL remove only the directory identity created by the current holder.

#### Scenario: holder is killed before finalization

- WHEN the holder cannot run its finalizer
- THEN the lease remains busy
- AND a later lane does not infer that it is safe to reclaim.

### Requirement: holder is a tracked Node.js runtime

Foreman SHALL provide this command:

```text
credential-profile-use-lease hold --state-root ABS --worktree ABS --profile ID --vendor grok|codex
```

On success it SHALL write the verified config root with exactly one trailing
LF and no later stdout bytes. It SHALL NOT read or inspect vendor credential
files. The existing `credential-profile-lane admit` contract SHALL remain
compatible.

#### Scenario: invalid holder arguments

- WHEN the command receives missing, duplicate, reordered, relative, or
  unsupported arguments
- THEN it exits with a closed configuration failure
- AND its diagnostic contains no path or credential value.
