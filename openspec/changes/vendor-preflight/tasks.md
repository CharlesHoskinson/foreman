# Tasks — vendor-preflight

Ordering: T1 is the data model and gates the rest. T2-T5 are the adapters and
may run in parallel once T1 lands. T6 is tests. T7 is the gate.

## T1 — the result model and the capability table

- [ ] Define the three facts (`discoverable`, `authenticated`, `current`) and
      their value domains. `authenticated` is exactly `authenticated` /
      `not-authenticated` / `unknown`. No caller may collapse them before
      reporting.
- [ ] Define the two evidence classes: `declared` (vendor ships a
      non-interactive status verb with a real contract) and `probed` (it does
      not; readiness inferred from a bounded minimal call).
- [ ] Add a vendor capability table to `env/reference-manifest.toml`: per
      vendor, the CLI name, the auth-status command or `none`, the evidence
      class, the version command, the pinned version floor, whether the
      vendor's `update` verb mutates, and the documented login instruction.
- [ ] Record in that table that `claude update` and `codex update` install and
      SHALL NOT be invoked by the preflight, and that `grok update --check` is
      the only non-mutating currency check available.
- [ ] Create `env/vendor-preflight.sh` emitting the JSON record: resolved
      absolute path, reported version, floor, the three facts with evidence
      classes, the probe executed, and a UTC timestamp.

## T2 — declared adapters: claude, codex

- [ ] `claude`: parse `claude auth status` as JSON and read `loggedIn`. Do not
      grep its prose. Treat unparsable JSON as `unknown`, never as either
      verdict.
- [ ] `codex`: use `codex login status`. Its contract is an exit code plus
      prose; bind to the exit code, and treat a non-zero exit carrying no
      recognised signed-out signal as `unknown` rather than
      `not-authenticated`.
- [ ] Both adapters bounded. A bound expiring yields `unknown`.

## T3 — probed adapters: grok, agy

- [ ] `grok`: there is no status verb. Probe with a bounded `grok models` and
      require the **positive** signed-in signal. Absence of the negative string
      SHALL NOT be read as authenticated.
- [ ] `grok`: a bound expiring, a socket failure, or output matching neither
      the positive nor a recognised negative signal yields `unknown` with the
      reason named. Remove the current `(( rc != 0 )) && return 1` collapse
      from `env/tool-check.sh` — it is the defect this package exists to fix.
- [ ] `agy`: there is no status verb and no login subcommand; it signs in
      silently from the OS keyring. Probe with a bounded minimal call and
      classify on the same three-state rule.
- [ ] Record for each probed adapter the exact command executed, so the report
      names the probe rather than asserting a conclusion.
- [ ] Treat every positive banner as a presentation detail: a banner that stops
      matching produces `unknown`, and the suite has a test that proves it.

## T4 — currency without mutation

- [ ] Compare the reported version against the pinned floor. Use a version
      comparison that handles pre-release suffixes, not a string compare.
- [ ] Do NOT invoke `claude update`, `codex update`, or any `agy` update verb.
      Assert this with a static check over `env/vendor-preflight.sh` so a later
      edit cannot reintroduce it.
- [ ] `grok update --check --json` MAY be used, and only with `--check`.
- [ ] An unparsable or absent version yields `unknown` for the current fact,
      never `current`.

## T5 — wire the callers

- [x] **Partial (Sprint 3 R4B Setup adapter):** `env/tool-check.sh` invokes the
      tracked TypeScript runtime
      `skills/foreman/runtime/dist/vendor-preflight.js tool-check-row <grok|codex>`
      and parses exactly three TSV fields. Shell `vendor_authed` and direct
      `grok models` / `codex login status` / vendor `--version` probes are
      deleted. Projection maps missing → `missing`, signed-out →
      `not_authenticated` (login detail only), auth/currency unknown →
      `degraded` (diagnose, never login), outdated → `outdated`, ready → `ok`.
      `foreman-setup.sh` still composes tool-check and emits login instructions
      only from `NOT_AUTHENTICATED` (positive signed-out). Full per-fact three-
      line rendering and lane-run JSON record consumption remain open.
- [x] **Partial (R4B cold-audit boundary correction):** CLI binds
      `decoded.vendor === parsed.vendor` before JSON/TSV emission (mismatch →
      exit 3, no stdout). Shell `fm_tc_vendor_preflight_row` requires runtime
      exit 0, exactly one line, exactly three TSV fields, requested vendor,
      closed status, nonempty detail; wrong vendor / fourth field / second
      line / nonzero exit all map to one `degraded` row. Focused package
      tests 20/20; bats tool-check-auth + foreman-setup 26/26; full verify
      554 pass + 1 skip. Live dogfood grok/codex `ok` at floors.
- [x] **Partial (R4B detail-byte boundary):** Shell `fm_tc_vendor_preflight_row`
      rejects detail whose UTF-8 byte length exceeds
      `MAX_TOOL_CHECK_DETAIL_BYTES` (512); exactly 512 accepted; 513+ emits one
      `degraded` row (no `ok`, `LANE_READY: grok=no`). RED observed before fix
      (`LANE_READY: grok=yes` on 513-byte spoof). Acceptance: Bats fixture is
      shell-native (`head -c N /dev/zero | tr`) — no Python; explicit lower
      bound test for exactly 512 → `ok` / `LANE_READY: grok=yes`. Bats
      tool-check-auth + foreman-setup 28/28; focused package 20/20; full
      verify 554 pass + 1 skip.
- [x] **Partial (R4B LF framing residual):** Shell capture no longer uses bare
      `out="$(node ...)"` (strips trailing LFs). Runtime stdout is written to a
      temp file and rehydrated with a sentinel so framing is preserved.
      Accept only exactly one row ending in exactly one LF. Missing final LF
      and extra trailing blank line both map to one `degraded` row (no
      `LANE_READY: grok=yes`). RED observed before fix on both shapes. Bats
      tool-check-auth + foreman-setup 30/30; focused package 20/20; full
      verify 554 pass + 1 skip.
- [ ] `lane-run.sh`'s readiness gate reads the JSON record rather than
      re-probing, and reproduces the recorded reason verbatim in its refusal.
- [x] **Partial (R4B):** A vendor whose auth fact is `unknown` projects to
      tool-check `degraded` (not `not_authenticated`); Setup does not print a
      login instruction for that case. Bats: unmatched banner, auth timeout,
      codex unrecognized nonzero.

## T6 — tests, red-first

- [ ] New `tests/vendor-preflight.bats` driven by stub CLIs on `PATH`, so every
      state is reachable without touching real credentials.
- [ ] Prove `not-authenticated` reachable: stub emits the vendor's documented
      signed-out response; assert the verdict and that the instruction is that
      vendor's login command.
- [ ] Prove `unknown` reachable three ways: bound expires; exit non-zero with
      an unrecognised banner; output matches neither positive nor negative.
      Assert no login instruction is emitted in any of them.
- [ ] Prove `outdated` reachable and that it does not report as signed out.
- [ ] Prove `missing` reachable with the CLI absent from `PATH`.
- [ ] Regression test for the originating defect: a stub that sleeps past the
      bound SHALL yield `unknown`, and the suite SHALL fail if it yields
      `not-authenticated`.
- [ ] Static check: the suite fails if `env/vendor-preflight.sh` gains a call
      to a mutating `update` verb.
- [ ] Every one of these tests SHALL be observed failing against a deliberately
      wrong implementation before it is trusted; record the observation.

## T7 — gate

- [ ] `shellcheck` clean on `env/vendor-preflight.sh` and every modified caller.
- [ ] Full suite green on WSL/Ubuntu 26.04.
- [ ] Re-run the originating scenario on a loaded box and confirm Setup no
      longer instructs a re-login for a working vendor.
- [ ] `bugeventlog.md` entry recording the false negative, its evidence, root
      cause, impact and this enhancement.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [ ] `openspec validate vendor-preflight --strict`.
