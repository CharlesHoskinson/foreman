# Native ChatGPT authentication

The host owns account selection, credential reads, refresh, and account identity checks.
The isolated Codex app-server receives external access tokens through private JSON-RPC messages.
The worker does not receive the host profile directory or its refresh token.

Credential reads reject links, unsafe permissions, invalid JSON, duplicate keys, and oversized input.
Each run retains its original account identifier.
Refresh uses the host's Codex process and stops within the caller's deadline.
The transport accepts at most two refresh requests.

The existing Bubblewrap boundary controls mounts and writes.
Codex 0.154 rejects the obsolete `workspaceWrite.readOnlyAccess` field.
The transport omits that field and retains workspace-write mode, disabled tool networking, temporary-directory exclusions, and untrusted approvals.
Tools can read the runtime files visible inside Bubblewrap.
This change does not promise workspace-only reads.

Codex treats `environments: []` as an instruction to disable environment tools.
The transport omits this field to select the default local environment inside Bubblewrap.
The host still validates every tool approval and the exact changed bytes.

API-key routes remain available.
Grok native authentication and keyring-only Codex storage are outside this change.
Live qualification remains necessary before this credential route can qualify a product account.
