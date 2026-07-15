# Vendored reference skills

Third-party skills vendored for a self-contained Foreman install. Do not
modify locally — update by re-vendoring from upstream.

| Skill | Upstream | Vendored | License | Content hash |
|---|---|---|---|---|
| scrapling | <https://github.com/D4Vinci/Scrapling> (skill wrapper) | 2026-07-15 | see skills/scrapling | 629b5c5208ceadf998821bd79a556ad6dd9787b7cbb13b65ca2393dfc027a994 |
| graphify | local skill (charl) | 2026-07-15 | see skills/graphify | 55c25534d00c64b65892735aa1b06c3439a96acfc98163da73d0c414a1cc1593 |
| superpowers | <https://github.com/obra/superpowers> | 2026-07-15 | MIT (skills/superpowers/LICENSE) | fc08da087bc71c0077a663c07fb47f2455600840b27ac89dca308cab9ef7c517 |

Local-overlay files (`*.local.md`, cookie vaults) are excluded at vendor time
and must never be committed.

Re-vendor: `cp -r ~/.claude/skills/<name> skills/ && rm -rf skills/<name>/.git && find skills/<name> -name '*.local.md' -delete`

Content hash command: `find skills/NAME -type f -print0 | sort -z | while IFS= read -r -d '' f; do printf '%s\0' "$f"; tr -d '\r' < "$f"; done | sha256sum | cut -d' ' -f1`
