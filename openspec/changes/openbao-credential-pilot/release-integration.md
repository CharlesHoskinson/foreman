# Return of the ForeDi integration requirements

The user requires credential management for AGY, Codex, Claude, and Grok in the final Return of the ForeDi release.
The public framework interface is credential-focused. OpenBao is its storage backend, not its provider authentication implementation.

## Framework boundary

Expose a typed credential manager to the framework.
Keep OpenBao HTTP details, token material, and provider-specific files behind that boundary.

The manager supports explicit provider and named-account selection.
Its metadata operations list accounts, inspect status, and report supported lifecycle capabilities without returning secret bytes.
Its host-only operations import, resolve, refresh or rotate, remove, and request provider revocation where supported.

Use separate capability results for each provider, credential type, and operation.
An unsupported operation returns an explicit unsupported result.
Do not simulate revocation by deleting the OpenBao record.
Do not call an externally stored native credential OpenBao-managed merely because its metadata is in OpenBao.

The OpenBao adapter supports verified HTTPS, explicit mount and namespace configuration, bounded requests, and compare-and-set writes.
Bootstrap token acquisition remains a separate host service.
Workers receive no OpenBao credentials or long-lived provider refresh material.

## Provider adapters

| Provider | Required qualification |
| --- | --- |
| AGY | Antigravity account selection, supported credential access, refresh ownership, and worker isolation. |
| Codex | Preserve the existing native login and external-token RPC. Qualify OpenBao storage and refresh ownership. |
| Claude | Qualify native credential access, selected account, token delivery, and refresh or rotation behavior. |
| Grok | Qualify native credential access, selected account, ACP delivery, and refresh or rotation behavior. |

API-key support cannot substitute for requested native-login management.
Each adapter must preserve provider identity across refresh and refuse account changes.

## Release gates

- [ ] Specify and review the credential manager contract and OpenBao backend interface.
- [ ] Implement framework imports and dependency injection with no pilot-only names in the public interface.
- [ ] Verify HTTPS validation, configuration errors, policy isolation, and token renewal failures.
- [ ] Run the synthetic pilot against the reusable storage implementation.
- [ ] Qualify every supported lifecycle operation for each of the four provider adapters.
- [ ] Verify import, cutover, concurrent refresh ownership, interrupted migration, and recovery.
- [ ] Document setup, status, account selection, outage recovery, revocation, and explicit unsupported capabilities.
- [ ] Include the implementation and evidence in the ForeDi release candidate without changing live credentials automatically.

The current synthetic pilot is preliminary evidence only.
It does not complete the release gates above or authorize publication.
