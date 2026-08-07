# Architecture Policy Deadlock on PR #27 (v0.3.0) — Remediation Options

Prepared in `/root/fm-wt/w0-archpolicy` (detached worktree at `4af8690`, release branch tip).
All findings below were reproduced by running `node skills/foreman/runtime/dist/architecture-policy.js check --base origin/main` directly (not inferred from CI logs), and by committing/reverting small experimental diffs in this worktree to test the code paths empirically. `origin/main` resolved to `2dc52fe`; merge-base `e298d29`.

## 1. Reproduction

Real result of the check as CI runs it:

```
FAIL
  added    skills/foreman/scripts/execution-guard.sh   prohibited_posix_shell
  modified skills/foreman/scripts/wt-new.sh            legacy_adapter_domain_logic
  modified tests/docs-check.bats                       prohibited_extensionless_executable
  modified tests/wt-new.bats                            prohibited_extensionless_executable
```

Note: the task brief also listed `docs/releases/v0.3.0-stale-log.md` as a violating path. That file does not exist anywhere in this worktree's history (`git log --all` for it returns nothing), and no `.md` path can trigger any of the three closed reasons in this tool (they require specific executable extensions or shell/adapter content). This looks like a transcription artifact from a different gate, not an architecture-policy finding — I am not carrying it into the options below. Everything else in the brief reproduced exactly.

## 2. Claim-by-claim verification

### Claim 1 — "No `bats` shebang interpreter is recognized, so any edit to any real `.bats` file trips it." **Overstated — refuted experimentally.**

Code path (`architecture-executable.ts` `shebangReason`): `#!/usr/bin/env bats` resolves interpreter `bats`, which matches none of the recognized cases (python/sh-family/powershell/cmd/deno/bun/node) and falls through to `prohibited_extensionless_executable`. That part of the claim is correct.

But `architecture-evaluate.ts` already contains a tested, closed exception (`isModifiedBatsTestData`, with five dedicated test cases in `architecture-evaluate.test.ts`): a **modified** file under `tests/*.bats` whose exact first line is
`# bats test data (run via \`bats\`, not as a product executable)`
bypasses exec/shebang classification entirely. Seven files in the repo already use this pattern today (`tests/vendor-isolation.bats`, `tests/lane-run.bats`, `tests/lifecycle-gate.bats`, etc.).

More importantly, the exemption isn't even necessary for the general case: shebang detection only fires when the first two bytes are literally `#!`. A `.bats` file is *never* directly executed in this codebase — every call site (`gates-windows.yml`, `tests/run.sh`, `tests/selftest-test-infrastructure.sh`) invokes it as `bats path/to/file.bats`, never `./file.bats`. Dropping the `#!/usr/bin/env bats` line costs nothing functionally.

**I verified this directly**: in this worktree I replaced the first line of `tests/docs-check.bats` and `tests/wt-new.bats` with the exact exemption header, added a new `.bats` file with the header and no shebang, and added a new `.bats` file that kept the shebang. Re-running the checker:
- both modified files: **finding disappeared**
- new file without shebang: **passed** (added-kind bats files aren't extension-banned at all — `.bats` isn't in the prohibited-extension list; classification only triggers on exec-mode or shebang, and this file had neither)
- new file with shebang: **failed**, `prohibited_extensionless_executable` (confirms the mechanism, not blanket-bats-hostility)

All experimental commits were reverted (`git reset --hard 4af8690`); the worktree is clean.

**Correction to the claim**: the two `.bats` findings in this PR are fixable today, with a one-line change per file, no tool changes, no test debt. The "unpassable by construction" framing does not hold for the bats findings.

### Claim 2 — "No path to add a brand-new compliant thin-adapter `.sh` file — new files are extension-banned before the grammar check is reachable." **Confirmed exactly as stated.**

`architecture-extensions.ts`'s `prohibitedExtensionReason` bans `.sh` unconditionally. In `architecture-evaluate.ts` `checkPath`, the **added/renamed** branch calls `classifyExecutableSource` — which checks `prohibitedExtensionReason` first — before it would ever reach `isTypeScriptPath` or fall through to the modified-only `isLegacyExecutablePath` → `inspectLegacyAdapter` grammar path. The thin-adapter grammar (`inspectPosixShellAdapter` in `architecture-adapter.ts`) is only reachable from the **modified** branch of `checkPath`, for a path that already existed at the base commit.

**I verified this directly**: I hand-wrote a byte-for-byte compliant six-production thin adapter (shebang, `set -euo pipefail`, `ASSIGN_ROOT`, `ASSIGN_NODE_HARD`, `ASSIGN_BUNDLE_REPO`, `exec "$NODE" "$BUNDLE" "$@"` — matching every regex in `architecture-adapter.ts` exactly) and committed it as a new file. It still failed with `prohibited_posix_shell`, never reaching the grammar check. Confirmed and reverted.

This is a real, load-bearing gap for this PR specifically: `skills/foreman/scripts/execution-guard.sh` is not incidental shell debt, it is a **deliberately minimal, already-compliant-looking thin adapter** for a capability (`execution-guard` / "Endstop") whose Node bundle (`skills/foreman/runtime/dist/execution-guard.js`) is **already built, manifest-registered, and tested** (`packages/orchestration/src/execution-guard-*.ts`, `scripts/build-runtime.ts`, `scripts/verify-runtime.ts` all reference it). `skills/foreman/SKILL.md:237` documents `execution-guard.sh create --state-root ABS --contract-file ABS` as the intended CLI surface. So the tool is blocking exactly the kind of file it says it wants people to write, purely because it is new.

### Claim 3 — "It blanket-denies any edit at all to the legacy `wt-new.sh`." **Confirmed in effect.**

`inspectPosixShellAdapter` requires the modified file's **entire current body** to reduce to exactly 6 or 8 non-comment code lines matching the closed grammar. `wt-new.sh` is 257 lines of real worktree-provisioning logic (locking, git worktree add, report scaffolding, vendor-dir handling). No partial edit changes that fact.

**I verified this directly**: I made a single trivial comment-only insertion (`# trivial comment only`) into `wt-new.sh`, leaving 100% of the real logic untouched, and reran the check. It still failed with `legacy_adapter_domain_logic`. Reverted.

So the claim is accurate in effect, though the mechanism is not "this path is special-cased to always fail" — it's "any modified `.sh` file must, in its entirety, already be a thin adapter." `wt-new.sh` is nowhere near that shape and can't get there without a real strangler migration (as `lane-run.sh` and `lane-supervise.sh` did — both needed **bespoke SHA-256-pinned exceptions** hardcoded into `architecture-adapter.ts` because even their final, human-approved thin-adapter bodies didn't fit the generic six/eight-production grammar exactly, e.g. `lane-supervise.sh` injects `--state-root "$FOREMAN_HOME"` before forwarding).

**Bottom line on the three claims**: 2 of 3 hold up exactly as stated (new `.sh` files, and `wt-new.sh` specifically). Claim 1 is real but overstated — it has a working, already-tested, low-cost escape hatch that the prior lane apparently didn't find or try.

## 3. Remediation options

### Option A — Fix what's actually fixable now, descope the rest (no tool changes)

- **What changes**: (1) Replace the first line of `tests/docs-check.bats` and `tests/wt-new.bats` with the existing `# bats test data (...)` exemption header — closes both bats findings, verified above. (2) Revert the substantive change to `wt-new.sh` in this PR (the vendor-home-directory removal) so the file matches `origin/main` byte-for-byte and is not in the delta at all — the policy only evaluates files that actually changed. (3) Drop `execution-guard.sh` from this PR; ship the `execution-guard` runtime bundle without its shell entry point, or gate the whole `bounded-execution-terminal-policy` feature to a follow-up release.
- **Cost**: near zero engineering. Two one-line edits, one revert, one feature deferral. No code review of policy internals needed.
- **Risk**: the `wt-new.sh` vendor-home removal and the `execution-guard.sh` CLI entry point are presumably both intentional v0.3.0 work (R7B2-C credential-authority hardening, and the bounded-execution-terminal-policy plan respectively) — deferring them may not be acceptable to the release owner, and SKILL.md already documents `execution-guard.sh` as the CLI surface, so deferring it either breaks that documentation or requires editing it too.
- **Governance**: fully preserves the policy, unchanged. No exception carved anywhere.
- **Proof / anti-regression**: rerun `node .../architecture-policy.js check --base origin/main`, confirm `Pass`. The existing `architecture-evaluate.test.ts` suite already has five tests locking the bats-exception behavior down (added/renamed/outside-tests/one-byte-drift all correctly still fail) — no test changes needed since nothing in the tool changes.

### Option B — Real migration: finish what `execution-guard.sh` and `wt-new.sh` are pointing at

- **What changes**: Port `wt-new.sh`'s remaining logic into a TypeScript CLI (mirroring how `lane-run.sh`/`lane-supervise.sh` were migrated — a Node entry under `packages/orchestration/src` or similar, built into `skills/foreman/runtime/dist/wt-new.js`, registered in `manifest.json` via `scripts/build-runtime.ts`), then reduce `wt-new.sh` itself to a thin forwarding shim. If the shim doesn't fit the generic six/eight-production grammar (likely, given it will need lock-acquisition ordering or env injection like `lane-supervise.sh` does), add a third bespoke path+SHA-256 pin to `architecture-adapter.ts` (`WT_NEW_MIGRATION_PATH` alongside `LANE_RUN_MIGRATION_PATH` / `LANE_SUPERVISE_MIGRATION_PATH`), following the exact precedent already in the file. For `execution-guard.sh`, since its bundle is already built and manifest-registered, this is much smaller: either shape the `.sh` wrapper to exactly match the six-production grammar (compare against `ASSIGN_ROOT`/`ASSIGN_NODE_HARD`/`ASSIGN_BUNDLE_SKILL`/`EXEC_VARS` regexes precisely) and land it as a **modified** file by first landing an empty/placeholder `.sh` at that path on `main` in a prior, unrelated PR — or add it via a pinned-hash exception like the other two.
- **Cost**: real engineering — for `wt-new.sh`, this is the largest lift of any option (a 257-line worktree-provisioning script has real edge-case behavior: locking, retry, report scaffolding; `lane-run.sh`'s equivalent migration produced a 1,460-line artifact). Medium for `execution-guard.sh` (small file, but writing it to satisfy either the exact regex grammar or getting a pin approved both need a deliberate, reviewed step, not just "make it look thin").
- **Risk**: schedule risk to the v0.3.0 date if `wt-new.sh` migration isn't already in flight; behavioral regression risk in the port (worktree provisioning has non-obvious atomicity requirements documented in the script's own comments — "mkdir is atomic on Git Bash/MSYS is FALSE on Ubuntu 26.04 hybrid coreutils").
- **Governance**: this is the option that actually satisfies the policy's intent — no exception, no weakening, real debt paid down. Adding a pinned-hash exception widens the allowlist by exactly one file, with the same audit trail as the two existing pins (visible in a diff, requires human approval, does not generalize to any other file).
- **Proof / anti-regression**: `architecture-adapter.test.ts` already has coverage patterns for the two existing pinned migrations (digest-exact-match, reject-any-byte-drift) — add analogous tests for the new pin before or alongside the migration PR. The pin itself is the regression guard: any future accidental edit to the adapter file fails closed by design (as `LANE_SUPERVISE_BODY_SHA256`'s own comment states: "A one-byte change or domain-logic edit fails").

### Option C — Bypass the `.sh` wrapper layer entirely for new capabilities

- **What changes**: Instead of writing `skills/foreman/scripts/execution-guard.sh`, ship `skills/foreman/runtime/dist/execution-guard.js` as the directly-invoked entry point: give the built bundle a `#!/usr/bin/env node` shebang and executable mode as part of `scripts/build-runtime.ts`'s output, and register that exact byte sequence's SHA-256 in `manifest.json` (the manifest digest check in `matchGeneratedBundle` doesn't care about shebang/mode, only content-hash). `checkPath`'s generated-bundle branch (`isRuntimeBundlePath`) applies before the special/symlink/executable-mode branch matters, so this is already a permitted shape for **added** files under `dist/`. `SKILL.md:237`'s documented CLI surface (`execution-guard.sh create ...`) would need to change to `execution-guard.js create ...` or `node runtime/dist/execution-guard.js create ...`.
- **Cost**: small — a build-script change plus one doc line. Applies only to genuinely new capabilities; does nothing for `wt-new.sh`, which already has a `.sh` identity contributors and docs depend on.
- **Risk**: interface change — anything (docs, muscle memory, other tooling) that expects a `.sh` entry point breaks unless updated everywhere in the same PR. Sets a precedent that "just don't use `.sh` for new things" is the intended pattern, which is arguably correct for the TypeScript migration's end state but not signposted anywhere today.
- **Governance**: preserves the policy's core intent (no new shell literally exists) even more strongly than Option B — it removes the shell layer, not just shrinks it.
- **Proof / anti-regression**: `scripts/verify-runtime.ts` and `scripts/verify-runtime-manifest.test.ts` already assert bundle byte-identity and drift-detection for `execution-guard.js`; extending those to also assert the shebang/exec-mode survives the build is a small, natural addition. Rerun the architecture-policy check to confirm Pass.

### Option D — Declared exemption (explicit, reviewed, time-boxed)

- **What changes**: No code in `packages/policy/src` changes. Add a maintainer-reviewed exemption record — e.g. `docs/releases/v0.3.0-architecture-policy-exemptions.md` — naming each finding, the reason it cannot be closed before the v0.3.0 cut, an owner, and a target release for real closure (Option B's migration). The CI step itself is **not** modified to consult this file automatically (that would let the tool "approve its own repair" by construction); instead, a human with merge authority reviews the exemption doc and the diff together, and merges past the still-red gate consciously (e.g., admin merge, or a manually-applied "exempted, see doc" label that a human — not the tool — attaches).
- **Cost**: lowest of any option that ships v0.3.0 without touching `wt-new.sh` or `execution-guard.sh` at all. Mostly a paperwork/review-process cost.
- **Risk**: the CI gate stays red on this PR permanently unless the merge process has a defined "merge past a declared-exempt red check" mechanism today — if it doesn't, this option requires inventing that mechanism, which is itself a governance change and needs its own scrutiny (a red required check that can be overridden by a human is a meaningfully different guarantee than a required check that must be green).
- **Governance**: this is the option the brief explicitly names as legitimate ("every finding fixed or declared"). It is honest about not fixing anything — the debt is named, owned, and dated, not hidden. It does **not** weaken the tool's logic for anyone else's future PR.
- **Proof / anti-regression**: the exemption doc itself is the audit trail. Anti-regression here isn't about the tool (which is unchanged) — it's about the exemption not silently becoming permanent: put a real target release in the doc and add it to whatever release-readiness checklist already exists (`tests/release-metrics.bats` / `docs/releases/` conventions in this repo suggest there already is one).

### Option E — Turn the gate off for this PR (named honestly, not recommended)

- **What changes**: remove or skip the "Architecture policy against pull request base" step in `gates-linux.yml`/`gates-windows.yml`, or exclude it from the required-checks list for PR #27.
- **Cost**: trivial.
- **Risk**: this is the one option that actually matches "the tool blocks its own repair" pessimism people default to — except it isn't forced, per the verification above. Taking it when Option A closes 3 of 4 findings for near-zero cost would be trading real governance for no real savings.
- **Governance**: this is **abandoning the constraint**, full stop, not weakening it at the margin. It removes the one mechanical guarantee that the codebase doesn't backslide into new shell/Python during exactly the release that is supposed to complete the TypeScript migration. Every other option in this document preserves the policy's ability to catch the *next* PR's violations; this one doesn't even preserve it for this PR's remaining 300+ lines of untouched legacy debt going forward, because it sets precedent that the gate is optional under schedule pressure.
- **Proof / anti-regression**: none possible — there is nothing left running to regress.

## 4. Recommendation

**Do Option A now, and open Option B as a tracked follow-up (not blocking v0.3.0), with a declared exemption (Option D) covering only the `wt-new.sh` gap in the interim if the vendor-home removal genuinely cannot wait for the next release.**

Reasoning: two of the four findings (`docs-check.bats`, `wt-new.bats`) are not real constraints at all — they are fixed by a one-line, already-tested, zero-risk edit per file, verified working in this worktree. Landing those costs nothing and shouldn't be bundled into a "the gate is broken" narrative. `execution-guard.sh` should not be force-fit into the generic thin-adapter grammar under release pressure; Option C (ship the bundle directly, drop the `.sh` layer, update the one SKILL.md line) is nearly as cheap as A and produces a *cleaner* result than adding a new file that only superficially resembles a thin adapter. That leaves `wt-new.sh` as the one genuinely hard case: it is real, non-trivial migration work (closer to `lane-run.sh`'s effort than `lane-supervise.sh`'s), and the honest choice is between deferring the specific line-item that touches it (Option A's revert) or declaring it exempt with a named owner and target release (Option D) if the vendor-home removal is release-blocking on its own merits. Either avoids inventing a new policy-tool exception under time pressure, which is exactly the situation that produces exceptions nobody re-examines later. Full migration (Option B) is the right end state for `wt-new.sh` and should be scheduled, not skipped — but it should not be done hastily inside a release-blocking PR.

Headline cost of the recommendation: near-zero to unblock the release (two file edits, one revert or one exemption doc), with the real cost — migrating `wt-new.sh`'s domain logic to TypeScript — pushed to a tracked, reviewed follow-up where it can be done correctly instead of rushed to satisfy a closed grammar checker.
