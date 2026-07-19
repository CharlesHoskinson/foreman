# Spec delta — documentation + README refresh

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirement: README describes the current product and both platforms

README.md SHALL describe foreman as it currently ships: the three-stage
lifecycle (Setup & Environment → Use → Cleanup), soft/hard modes as shipped,
the vendor lanes including grok, and a quickstart for BOTH Windows and
WSL/Linux (full-WSL setup).

- Every command, flag, path, and env var shown SHALL be verified against the
  shipped code — the implementer SHALL NOT show an invented flag or a stale
  path.
- README SHALL include an honest capabilities-and-limits section (e.g. T5b
  UNVERIFIED vendors capped at 1; hard-mode container profile as the upgrade
  path; POSIX asymmetry closed via pidns).

#### Scenario: a new user follows the quickstart on WSL

- WHEN a reader follows the README WSL quickstart on a fresh WSL distro
- THEN `bootstrap-wsl.sh` → `foreman-setup` → a trivial Use round → Cleanup
  all run as documented, with no undocumented step required.

## ADDED Requirement: USAGE documents the lifecycle end-to-end

`docs/USAGE.md` SHALL document running Setup (incl. model authentication),
driving a Use round, and Cleanup; the vendor lane recipes; the pueue/`gate`
mutex doctrine; and troubleshooting covering the worktree + WSL guard bundle.

- The guide SHALL be consistent with `references/orchestration-hardening.md`
  and `references/reference-environment.md` (no contradicting instructions).

## MODIFIED Requirement: CLAUDE.md doctrine matches the shipped lifecycle

`CLAUDE.md` SHALL reconcile the architect doctrine with the shipped
three-stage lifecycle and lanes: grok is live, the Setup readiness gate
precedes Use, Cleanup closes every run, and the current-era model routing is
stated accurately.

## ADDED Requirement: the blader/humanizer skill runs over user-facing prose

WHEN the user-facing prose (README, USAGE, INSTALL) is finalized, the
implementer SHALL run the `blader/humanizer` skill over it (install
`/plugin marketplace add blader/humanizer` + `/plugin install
humanizer@humanizer`; invoke `/humanizer`) so the prose reads naturally and
passes the docs-check AI-slop bar.

- The humanizer pass SHALL NOT change technical content (commands, flags,
  paths) — only phrasing/readability; WHERE it would alter a technical claim,
  the implementer SHALL keep the claim and adjust only the surrounding prose.
- IF the skill cannot be installed on the implementing host, THEN the
  implementer SHALL state that blocker explicitly and apply the closest
  available prose skill, naming the substitution — never silently skip the
  humanizer pass.

## ADDED Requirement: the doc set is internally consistent and link-clean

The refreshed docs SHALL pass `docs-check.sh` (markdownlint/codespell/lychee)
and SHALL contain no broken internal links or references to removed/renamed
files.

#### Scenario: docs-check is green on the refreshed set

- WHEN `docs-check.sh` runs after the refresh
- THEN markdownlint, codespell, and lychee all pass with no broken links.
