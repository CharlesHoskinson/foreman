# Vendored reference skills

Third-party skills vendored for a self-contained Foreman install. Do not
modify locally — update by re-vendoring from upstream.

| Skill | Upstream | Vendored | License | Content hash |
|---|---|---|---|---|
| scrapling | <https://github.com/D4Vinci/Scrapling> (skill wrapper) | 2026-07-15 | see skills/scrapling | 60ebe93d2740bf7db4fd2e827b0b0283236dbeafb717e14fbc8853a8c53caa02 |
| graphify | local skill (charl) | 2026-07-15 | see skills/graphify | d69aac55eb316acb1d0f3109538c7453e5dc0c21ca040551385a1d733a6aa282 |
| superpowers | <https://github.com/obra/superpowers> | 2026-07-15 | MIT (skills/superpowers/LICENSE) | 4a9b217dc5e08ddfa9f39bef966dbb446c15c7796d6b6eec61aff5afafa02f50 |

Local-overlay files (`*.local.md`, cookie vaults) are excluded at vendor time
and must never be committed.

Re-vendor: `cp -r ~/.claude/skills/<name> skills/ && rm -rf skills/<name>/.git && find skills/<name> -name '*.local.md' -delete`

Content hash command: `find skills/NAME -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1`
