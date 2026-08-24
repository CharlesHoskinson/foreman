# Change: Stable project registry

## Why

Foreman keeps one session store per Git common directory. It does not record a
stable project identifier. Recovery can use the wrong repository when an
operator selects a store explicitly.

## What Changes

- Add one machine-local registry under `FOREMAN_HOME`.
- Bind one project UUID to one physical Git common directory and SessionStore.
- Make linked worktrees resolve to the same project.
- Add explicit `fm-session project register`, `status`, and `list` commands.
- Make cross-repository freshness fail as `unknown`.
- Add `project_id` to external projection references.
- Keep all existing session commands available without registration.

## Capabilities

### New Capabilities

- `project-registry`: Stable local project identity and exact store resolution.

### Modified Capabilities

- `session-store`: Bind external projection references to one project UUID.

## Impact

- Adds a canonical registry file under external Foreman state.
- Extends SessionStore metadata without changing existing entity rows.
- Adds project commands to the existing `fm-session` runtime.
- Uses no custom keys or signatures.
