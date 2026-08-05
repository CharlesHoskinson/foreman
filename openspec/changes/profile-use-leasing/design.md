# Design: profile-use leasing

## Selected approach

Add a long-lived Node.js lease holder. It composes the accepted R7B2 admission
service with a scoped Effect lease. `lane-run.sh` starts the holder as a Bash
coprocess before any existing durable lane side effect. The holder writes the
verified config root with one trailing LF and then waits for stdin EOF.

The parent keeps the coprocess input descriptor open for the complete lane.
The existing cleanup trap closes the descriptor and performs a bounded wait.
Kernel pipe closure also releases the holder when the parent dies.

Do not add a shell lease implementation. Do not make the short-lived R7B2
`admit` command claim a lease. Do not make the lease holder spawn the vendor;
the existing launcher remains the process-lifecycle authority.

## TypeScript boundary

Create `credential-profile-use-lease.ts`. It exports:

```ts
export type CredentialProfileUseLeaseRequestV1 = {
  readonly input: CredentialProfileInput;
  readonly expectedProfileIdentity: string;
  readonly expectedConfigRoot: string;
};

export type CredentialProfileUseLeaseV1 = {
  readonly profileId: string;
  readonly vendor: CredentialVendor;
  readonly profileIdentity: string;
  readonly configRoot: string;
};

export class CredentialProfileUseLease extends Context.Tag(
  "CredentialProfileUseLease",
)<
  CredentialProfileUseLease,
  {
    readonly acquire: (
      request: CredentialProfileUseLeaseRequestV1,
    ) => Effect.Effect<
      CredentialProfileUseLeaseV1,
      CredentialProfileUseLeaseFailure,
      Scope.Scope
    >;
  }
>() {}
```

`acquire` uses `Effect.acquireRelease`. It re-resolves the profile immediately
before the exclusive directory create. It requires exact profile id, vendor,
profile identity, and config root equality with the admission result.

## Lease authority

Use this stable external namespace:

```text
<state-root>/credential-profile-leases/<profile-id>.lock
```

The lease root and lease directory must be real directories. On POSIX they
must have mode `0700`. Exclusive non-recursive `mkdir` creates the lease.
An existing directory returns `busy`. A link, file, unsafe mode, unreadable
component, or identity change returns a closed refusal.

Capture the state-root, lease-root, and created lease identities. Recheck them
after create and before release. Release removes only the lease directory with
the captured identity under the unchanged lease root. It never follows a link
and never removes a replacement.

Do not add TTL or automatic stale reclaim. If the holder is killed before its
Effect finalizer runs, the lease stays busy. An operator can remove it only
after independent proof that no vendor lane uses the profile.

## Holder protocol

Add this tracked command:

```text
credential-profile-use-lease hold --state-root ABS --worktree ABS --profile ID --vendor grok|codex
```

The command performs R7B2 admission first. It acquires a lease bound to the
admitted identity and config root. It writes the config root with exactly one
trailing LF. It then reads stdin until EOF inside the same Effect scope.

Diagnostics contain only a closed reason. They do not contain paths,
environment values, profile bytes, exception text, or credential content.

## Live adapter

For Grok and Codex lanes, `lane-run.sh` replaces the short-lived `admit` call
with the holder command. It installs temporary signal and exit cleanup before
the coprocess starts. It reads exactly one nonempty LF-terminated config-root
line with a bounded wait. A holder exit or protocol error refuses the lane
before worktree locks, events, secret scans, or vendor processes.

The parent preserves the coprocess input descriptor and holder PID. The main
cleanup closes the descriptor, waits with a fixed bound, and terminates the
holder if the bound expires. The lease remains held through command execution,
round gates, checkpoint work, launcher timeout, and launcher failure.

## Endstop package

Use one R7C implementation contract because the TypeScript holder and its thin
live adapter form one lifecycle invariant. Permit one Grok implementation,
one verification, one cold audit, one correction, one integration, and one
publication action. A new session or provider attempt does not reset limits.
