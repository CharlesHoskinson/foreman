# Install

`foreman-qa` is a Claude Code plugin. The plugin root is this directory,
`plugins/foreman-qa/`, inside the Foreman repo checkout. The repo is the
source of truth: an installed copy is derived from this directory and
should be refreshed on every release, not edited in place.

## Local marketplace install

Claude Code's plugin system installs from a marketplace: a directory or
repo that declares one or more plugins in a `.claude-plugin/marketplace.json`
manifest. From a Claude Code session:

```text
/plugin marketplace add /path/to/foreman
/plugin install foreman-qa@<marketplace-name>
```

Point `marketplace add` at the Foreman repo checkout, or at a directory
that declares `foreman-qa` in its `marketplace.json`. The marketplace name
to use in the second command is printed by the first. This repo does not
yet ship a root-level `marketplace.json`; adding one is a prerequisite for
this path until that lands.

## Symlink or copy into ~/.claude/plugins/

Alternatively, link or copy this directory directly into Claude Code's
plugin home so a session picks it up without a marketplace entry.

Windows (PowerShell):

```powershell
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.claude\plugins\foreman-qa" `
  -Target "C:\path\to\foreman\plugins\foreman-qa"
```

WSL / macOS / Linux:

```bash
ln -s /path/to/foreman/plugins/foreman-qa ~/.claude/plugins/foreman-qa
```

A copy behaves the same as a link but does not pick up future changes;
re-copy it after every release. A link stays current as long as the repo
checkout is not moved.

## Source of truth

Edit skills, commands, and the manifest only inside this repo checkout,
under `plugins/foreman-qa/`. Treat any installed copy — linked or copied —
as disposable, and regenerate it from the repo rather than patching it in
place.
