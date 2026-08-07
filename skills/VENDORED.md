# Vendored reference skills

Third-party skills vendored for a self-contained Foreman install.

**Policy.** Do not modify a vendored skill locally, with one declared
exception: a skill that documents its own append-target owns that file. Today
that is `skills/scrapling/references/site-patterns.md`, which
`skills/scrapling/SKILL.md` marks 必做 (mandatory) to append a de-sensitised
site pattern to, and instructs the agent to read before every scrape. Appending
there follows the vendored contract rather than breaking it. Everything else in
these trees is replaced wholesale, never edited.

**What the content hash means.** It records the maintained state of this fork,
not agreement with an upstream. There is no live merge path: the re-vendor
command below reads from `~/.claude/skills/<name>`, and `install.sh` makes that
a symlink back into this repo. Re-record the hash in the same commit as any
change to these trees, so drift means "changed without being recorded" rather
than "changed at all".

| Skill | Upstream | Vendored | License | Content hash |
|---|---|---|---|---|
| scrapling | <https://github.com/D4Vinci/Scrapling> (skill wrapper) | 2026-07-15 | see skills/scrapling | ecab906204228f783d2172e0e2e7b322d9f6630c5b9984396a5acac8358d4588 |
| graphify | local skill (charl) | 2026-07-15 | see skills/graphify | b3b7db87aeff8418351a8d10ecbd85f2d4d0f81cdb9df147ac111a4c2e58fa80 |
| superpowers | <https://github.com/obra/superpowers> | 2026-07-15 | MIT (skills/superpowers/LICENSE) | 673a3da0a64e4eb585ee4e083091197e88da19e6e70348a9355587d72d597d44 |

Local-overlay files (`*.local.md`, cookie vaults) are excluded at vendor time
and must never be committed.

Re-vendor: `cp -r ~/.claude/skills/<name> skills/ && rm -rf skills/<name>/.git && find skills/<name> -name '*.local.md' -delete`

Content hash command: `find skills/NAME -type f -print0 | sort -z | while IFS= read -r -d '' f; do printf '%s\0' "$f"; tr -d '\r' < "$f"; done | sha256sum | cut -d' ' -f1`
