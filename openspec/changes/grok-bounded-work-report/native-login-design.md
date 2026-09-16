# Grok native login for isolated Pel coding

The user approved access-token-only worker login on September 15, 2026.
This change extends the existing Grok ACP route. It does not change model routing.

## Requirements

- When a native Grok account is selected, the host shall read only its private `auth.json`.
- If the account is ambiguous, expired, replaced, malformed, or insecurely stored, the host shall refuse authentication.
- When a worker starts, the boundary shall expose only a filtered access-token login in its temporary home.
- The boundary shall not mount the host profile or expose refresh tokens, unrelated accounts, settings, or personal display fields.
- If the access token expires before the request deadline, the host shall refuse that request.
- When the worker stops, the host shall remove its temporary credential snapshot after process cleanup.
- The existing filesystem grants, permission journal, model checks, and resource limits shall remain enforced.

The first version does not refresh credentials. The user approved explicit failure on expiration or account change.
Worker tools can read the temporary access token. They cannot read the host refresh token.

## Design

Add a host-owned Grok credential capability beside the ChatGPT capability.
The capability returns redacted, filtered login bytes for one bounded request.
The Grok transport supplies those bytes through a private launch field.
Only the enforcing boundary consumes that field.
The ordinary process launcher rejects unconsumed credential fields.

The boundary creates an owner-only snapshot outside the workspace.
It mounts that snapshot read-only as the worker's `.grok/auth.json`.
The transport selects the existing `cached_token` ACP method.
No snapshot bytes enter arguments, environment variables, prompts, journals, or reports.

## Verification

Use synthetic credentials in unit and namespace tests.
Check exact field filtering, account changes, expiration, symlinks, hardlinks, permissions, malformed JSON, and cleanup.
Check the transport's authentication method and the actual namespace's denied host reads and Git writes.
Run a bounded live qualification only after those tests pass.
Live login and coding remain unverified until that qualification succeeds.
