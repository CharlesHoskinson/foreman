# Reference development environment

The installed Return of the ForeDi package supports Linux x64 and Node.js 24. Use the [installation guide](../../../docs/guides/pel/install.md) for product prerequisites. An existing Windows/WSL development environment is not evidence that an installed release supports Windows.

The repository's `env/reference-manifest.toml` records development tools and original observed versions. Its inventory scripts can report missing or outdated tools:

```text
bash env/tool-check.sh --json
```

Windows development retains `env/tool-check.ps1`. Bootstrap, account authentication, and changes to the host environment remain explicit operator actions. Do not infer credential access from a binary's presence or let an inventory tool authenticate an account silently.

Before paid provider work, inspect `foreman providers list --json` and the exact selected transport's required qualification. Use registered credential references and supported controls. Missing enforced tool or process boundaries cause admission refusal. A launcher process-group fallback is not equivalent to a PID namespace and is not a network or filesystem sandbox.

Configure the existing repository, state root, authority, worktree grants, gate, roles, and immutable inputs once through `foreman project configure --settings project-settings.json`. Do not use an arbitrary state directory to bypass the project registry or transfer a legacy owner.

The optional historical WSL clock preflight is a development diagnostic. A clock warning does not extend an execution deadline or authorize work. Preserve the original wall-time and no-change limits in the run binding.

Current [quickstart](../../../docs/guides/pel/quickstart.md), [security controls](security-model.md), and [migration limits](../../../docs/guides/pel/migration.md) supersede historical controller launch recipes. Retained Windows, Docker, and unsupported workflow obligations stay open until their own evidence establishes them.
