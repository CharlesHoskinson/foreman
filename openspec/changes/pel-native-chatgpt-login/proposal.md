# Reuse a selected ChatGPT login in Pel

## Why

Codex supports a native ChatGPT login. Pel resolves that login but rejects it before isolated coding qualification.
The user approved host-managed authentication on 2026-09-15. A new API key must not be necessary for this route.

## What Changes

- Add a host-owned Codex credential broker for an explicitly selected native account.
- Authenticate the isolated app-server through its external-token protocol.
- Refresh through the host's managed Codex account. Keep refresh tokens and profile files outside the worker.
- Preserve exact model selection, permission enforcement, deadlines, and independent qualification.

## Scope

This change covers Codex ChatGPT login, including Astra and Sol. API-key routes remain supported.
Grok account authentication uses a different protocol and is not changed by this patch.
No publication or Moriarty product campaign is authorized by authentication support.
