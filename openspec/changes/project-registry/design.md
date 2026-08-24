# Design: Stable project registry

## Decisions

Keep one SessionStore per project. Store only project bindings in the global
registry. This choice contains store corruption and preserves offline use.

Identify a project by a port-minted UUID. Bind that UUID to the physical Git
common directory and store location. Treat a display name as metadata only.

Return records for the current project only. Do not add a cross-project record
query in v0.4. Run each freshness command in the registered repository.

Keep the unregistered workflow compatible. An existing store remains usable.
Registration adds metadata and does not rewrite entity rows.

## Registry file

Use `FOREMAN_HOME/projects.json`. Use canonical JSON with one trailing LF.
Reject duplicate keys, unknown fields, invalid UUIDs, relative paths, linked
files, oversized input, and duplicate project or store bindings.

Each active record contains:

- `project_id`
- `operation_id`
- `generation`
- `git_common_dir`
- `worktree_paths`
- `store_backend`
- `store_location`
- `state`

Sort records by project UUID. Sort worktree paths by UTF-8 bytes.

## Registration

Resolve the physical Git common directory before any write. Resolve the
SessionStore selection before registry mutation. Mint the project and operation
UUIDs in the host process.

Publish the matching project marker before registry finalization. Treat an
identical retry as success. Refuse a second project UUID for the same Git common
directory or store.

## Recovery

Resolve freshness from the current store binding. Return `unknown` when no
registered repository can be used. Never run Git in a different project.

## Migration

Add project metadata without changing entity rows or ID counters. Keep
read-only commands read-only. Compare the complete snapshot before and after
migration.

## Excluded scope

Do not add transfer keys, signatures, approval authorities, or recovery keys.
Do not add a network service. Do not combine every project into one database.
