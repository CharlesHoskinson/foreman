# OpenBao credential pilot

## Approval and scope

The user approved a local WSL pilot with synthetic credentials on 2026-09-15.
This document records the approved direction and defines its execution boundaries.
The user approved this written specification on 2026-09-15 with “looks good”.

The pilot covers credential storage and broker isolation for Codex, Grok, Claude, and AGY.
AGY means Antigravity CLI. It does not mean Gemini CLI.
The pilot does not import, refresh, revoke, or delete live provider credentials.

Source baseline: `c83b118b7a005fe74d53cc3d64c91f333c622095` in `/root/foreman-native-login-20260915`.
Preserve the native Codex implementation from this baseline.
Do not replace the installed Foreman runtime during the pilot.

## Architecture

OpenBao KV v2 stores versioned synthetic credential records.
A host-side broker resolves one explicit provider and account reference.
A fake worker receives only its synthetic access credential through a private channel.

| Component | Authority | Prohibited access |
| --- | --- | --- |
| Test controller | Configure the disposable server and create test policies. | Live provider profiles and external provider APIs. |
| Host broker | Read the selected test record through a restricted OpenBao token. | Administrative APIs, unrelated accounts, and implicit account discovery. |
| Fake worker | Receive the selected synthetic access credential. | OpenBao tokens, refresh credentials, and profile directories. |

The controller and broker use different OpenBao tokens.
The worker receives neither token.
The controller's administrative token exists only for the disposable test fixture.

The pilot demonstrates access control and credential delivery, not protection from a compromised host administrator.
The pilot does not prove isolation from an unrestricted process running as the broker's user.
Production deployment requires a separate operating-system identity and sandbox threat review.

## Local fixture

Run a disposable OpenBao development server bound to an available IPv4 loopback port.
Use development mode only because every stored value is synthetic and the fixture is disposable.
Do not enable a persistent service or expose a non-loopback listener.
Do not attach a live OpenBao instance to this harness.

Select an official OpenBao release during implementation.
Verify its published integrity evidence before execution.
Record the version, source URL, and binary digest in the report.
Do not replace a system installation or add an unverified binary to the default PATH.

The controller creates a private runtime directory with mode 0700.
Secret-bearing fixture files use mode 0600.
Use an allowlisted child environment without provider API keys or native profile paths.
Disable inherited proxy settings for loopback requests.

Use explicit five-second HTTP deadlines and a 120-second fixture deadline.
Cancellation closes the request scope and terminates fixture-owned processes.
Cleanup removes only the exact temporary directory created by this run.
Retain sanitized reports outside that directory.

Loopback HTTP is a synthetic-fixture exception, not a production transport recommendation.
Production requires authenticated TLS and an approved bootstrap and unseal design.

## Credential contract

Each reference has the form `bao:<provider>:<account>`.
The provider is exactly one of `codex`, `grok`, `claude`, or `agy`.
The account matches `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`.
Reject separators, percent escapes, whitespace, and unknown providers before sending a request.

The mount is `foreman-pilot`.
The logical secret path is `providers/<provider>/<account>`.
The KV v2 read endpoint adds the required `data/` segment.
Do not accept caller-supplied URLs or arbitrary mount paths.

The shared record contains `schemaVersion`, `provider`, `account`, and a `material` object.
Pilot material contains `accessToken` and `refreshToken`.
This envelope supports the user's subsequent framework-interface requirement without imposing one OAuth shape on all providers.
The fixture generates access and refresh values with distinct `foreman-synthetic-` prefixes.
The broker validates record identity against the selected reference.
Represent secret values with Effect Redacted values inside the host.
Never serialize the host credential object into a Pel artifact.

Limit an HTTP response to 64 KiB.
Reject duplicate JSON keys, malformed data, missing fields, and identity mismatches.
Reject redirects rather than forwarding an OpenBao token to another endpoint.
Do not include response bodies, tokens, or authorization headers in error messages.

The broker fails closed for a missing secret, denied read, revoked token, sealed server, timeout, or cancellation.
It never falls back to environment keys or native profiles.
Map failures to stable, sanitized categories with the original deadline intact.

## Refresh and migration boundaries

KV compare-and-set protects stored versions against stale writes.
It does not serialize redemption of a provider's rotating refresh token.
The pilot tests compare-and-set without calling a real refresh endpoint.

Production refresh needs one owner across all broker processes and ordinary vendor CLI sessions.
Do not copy a live refresh token into OpenBao while another writer remains authoritative.
An interrupted provider refresh can require reauthentication instead of replay or rollback.

OpenBao token revocation stops subsequent authorized reads.
It does not erase an access token already delivered to a worker.
The fixture separately tests cancellation and verifies that the broker performs no new reads after revocation.

Live migration needs verified import, explicit cutover, recovery procedures, and per-provider qualification.
Keep original live credentials unchanged until that later gate succeeds.
Do not restore an old rotating refresh token merely because KV retains its previous version.

## Provider rollout

| Provider | Pilot coverage | Later qualification gate |
| --- | --- | --- |
| Codex | Synthetic KV record and broker delivery. | Preserve external-token RPC and establish one native refresh owner. |
| Grok | Synthetic KV record and broker delivery. | Verify supported ACP authentication without exposing refresh credentials. |
| Claude | Synthetic KV record and broker delivery. | Verify supported token delivery, account selection, and refresh ownership. |
| AGY | Synthetic KV record and broker delivery. | Implement a distinct transport and prove account selection and isolation. |

Synthetic tests cannot set a provider's live readiness state.
Do not report AGY as a qualified transport because its credential record passes storage tests.
Do not silently substitute a different provider, model, transport, or account.

## Pel and OpenSpec integration

Keep secret resolution at the existing host-owned `CredentialPort` boundary.
Pel source and journals contain references and sanitized evidence, never credential bytes.
The pilot uses an experimental harness backed by the shared framework credential store.
It does not modify the default resolver or installed runtime.

The OpenSpec change is `openbao-credential-pilot`.
Its EARS requirements define the acceptance contract.
No new Pel grammar is necessary for this pilot.
A later product change can admit OpenBao references after provider-specific qualification.

The user subsequently required a proper framework interface for the Return of the ForeDi release.
The implementation plan therefore adds `CredentialStorePort` and the reusable OpenBao backend before the real-server harness.
The backend supports named-account reads, compare-and-set writes, listing, and explicit-version soft deletion for all four provider identifiers.
Provider login, refresh, and revocation remain separate adapter operations.

## Experiments and acceptance

| Test | Action | Passing evidence |
| --- | --- | --- |
| P01 | Round-trip records for all four provider identifiers. | Exact schema and account identity match. |
| P02 | Read another provider and another account with a restricted token. | Both requests fail with access denial. |
| P03 | Submit two writes with the same expected KV version. | Exactly one succeeds. The other reports a conflict. |
| P04 | Use malformed references and mismatched record identities. | Rejection without alternate-account lookup. |
| P05 | Seal the disposable server, then test an unavailable endpoint. | Sanitized failures within five seconds per request. |
| P06 | Revoke the broker token before another read. | The new read fails. Existing delivered data is not claimed revoked. |
| P07 | Inspect worker inputs, environment, files, logs, and reports. | No OpenBao or refresh canary appears. Access canary uses only its declared channel. |
| P08 | Serve duplicate-key, oversized, malformed, and redirect responses through a local fake server. | Rejection without token forwarding or response-body leakage. |
| P09 | Cancel an active operation and stop the fixture. | No fixture-owned process or listener remains. |
| P10 | Repeat synthetic import with create-only version checks. | Existing data remains unchanged after duplicate import. |
| P11 | Validate sanitized evidence provenance. | Reports say synthetic and do not qualify live accounts. |

Run P01 and P04 for all four providers and two account identifiers.
Run P02 against both a cross-provider path and a same-provider, different-account path.
Run P07 after success, access denial, malformed response, timeout, and cancellation.

Use real OpenBao for storage, ACL, versioning, seal, and revocation tests.
Use local fake HTTP peers for malformed and redirect responses.
Use a fake worker for credential-channel inspection.
Do not send synthetic credentials to real provider endpoints.

Record test identifiers, outcomes, durations, source revision, dependency versions, and implementation hashes.
Record binary provenance and command exit statuses.
Do not record secret bytes, raw HTTP bodies, process environments, or hidden model reasoning.

## Delivery gates

The pilot is the first part of the earlier thirteen-experiment research agenda, not a replacement for that agenda.

| Research experiment | Pilot mapping or remaining work |
| --- | --- |
| BAO-01 | P01 covers synthetic storage. |
| BAO-02 | P02 covers account and provider ACLs. |
| BAO-03 | P03 covers KV version conflicts. |
| BAO-04 | Cross-process native refresh ownership remains separate. |
| BAO-05 | P05 covers sealing and connection failure. |
| BAO-06 | P06 covers broker token revocation. Auto-auth renewal remains separate. |
| BAO-07 | P07 and P08 cover the fake worker and malformed responses. Real transport leakage remains separate. |
| BAO-08 | Recovery between provider refresh and KV persistence remains separate. |
| BAO-09 | P10 covers repeated create-only import. Interrupted live migration remains separate. |
| BAO-10 | Native Grok and Claude protocol fixtures remain separate from the generic fake worker. |
| BAO-11 | AGY account selection and sandbox qualification remain separate. |
| BAO-12 | P09 covers cleanup. Audit failure, persistent restart, and backup restoration remain separate. |
| BAO-13 | Real account qualification remains separate. |

### Execution sequence

1. Review this written specification.
2. Write the implementation plan with exact TypeScript files and test commands.
3. Establish a clean baseline for the affected modules.
4. Implement the pilot with failing tests before production code.
5. Run P01 through P11 and strict type checks.
6. Review the code and evidence before selecting the first live provider migration.

All new executable repository code uses Node.js 24, TypeScript, and Effect for owned asynchronous resources.
Do not commit, publish, install a Foreman candidate, or change live credentials under this pilot approval.

## Evidence

The Scrapling corpus is `/root/research/openbao-docs-20260915-2zZfoB`.
The verified snapshot covers 1,729 in-scope sitemap pages with explicit exclusions and source hashes.
Versioned and next-version pages remain distinct from current documentation.

- [KV v2](https://openbao.org/docs/secrets/kv/kv-v2/)
- [KV v2 API](https://openbao.org/docs/api/secret/kv/kv-v2/)
- [Audit devices](https://openbao.org/docs/audit/)
- [Agent auto-auth](https://openbao.org/docs/agent-and-proxy/autoauth/)
- [Seal concepts](https://openbao.org/docs/concepts/seal/)
