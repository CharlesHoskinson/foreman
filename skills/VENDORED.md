# Vendored reference skills

Third-party skills vendored for a self-contained Foreman install. Do not
modify locally — update by re-vendoring from upstream.

| Skill | Upstream | Vendored | License |
|---|---|---|---|
| scrapling | https://github.com/D4Vinci/Scrapling (skill wrapper) | 2026-07-15 | see skills/scrapling |
| graphify | local skill (charl) | 2026-07-15 | see skills/graphify |
| superpowers | https://github.com/obra/superpowers | 2026-07-15 | MIT (skills/superpowers/LICENSE) |

Local-overlay files (`*.local.md`, cookie vaults) are excluded at vendor time
and must never be committed.

Re-vendor: `cp -r ~/.claude/skills/<name> skills/ && rm -rf skills/<name>/.git && find skills/<name> -name '*.local.md' -delete`
