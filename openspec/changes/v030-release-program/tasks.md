# Tasks: v0.3.0 release program

## 0. Authority and program baseline

- [ ] 0.1 Publish the canonical v0.2.8.2 and v0.2.9.0 accomplishment ledger.
      The tracked candidate is complete. GitHub publication is pending.
- [ ] 0.2 Correct README, ROADMAP, checklist, residuals, and release metadata.
      Tracked authority is current. GitHub release metadata still needs the
      merged notes.
- [x] 0.3 Reconcile implemented, partial, absent, parked, and stale OpenSpec
      tasks. The bounded 2026-08-04 reconciliation corrected four stale task
      boxes and one completed 10-of-10 Tier 1 evidence statement. It kept
      gate-dependent and parked tasks open. The shipped v0.2.9 preflight
      package remains a protected `released_reference`; `DST-0061` registers
      its later archive relocation. All 32 tracked non-archive packages pass
      strict OpenSpec validation.
- [x] 0.4 Freeze `coverage-matrix.md` and its SHA-256 digest. The matrix,
      strict `SpecCorrectnessV1` evaluator, and Effect admission command are
      tracked. The first exact live activation record is in
      `docs/evidence/v0.3.0/spec-correctness-round-001/`.
- [ ] 0.5 Ship the Effect admission command, then run a ledger-bound Council
      review with `SpecCorrectnessV1` on one exact candidate.
      Landed evidence: specification-correctness core and admission at
      `a45b0a2c5fb4c95bdc67caef678c51c278c7f314` and
      `71b6fbdee5887f123891433266064db3d50b5def`. Live activation record at
      `b193ffdd97fbeb428fce0d410fe1405612843a6b` for head `71b6fbd`. One live
      Grok verdict is admitted. The default three-verdict, two-model-family
      Council quorum remains pending. Keep this task open.
- [ ] 0.6 Record every cleanup candidate before any destructive action. The
      register exists. The `DST-0052` historical-process incident mitigation
      remains unfinished. Destruction-admission code landed at
      `d360fbec540a3c99d1eba50ac5712c50e838b5b0` with review record
      `e8f9686cf8ae77145d7812a65f8fc573a521bca9`
      (`docs/evidence/v0.3.0/destruction-guard-spec-correctness-round-001/`).
      R2 slice: `@foreman/core` plus `@foreman/policy` with one canonical
      sentinel register (no projection table), pure evaluator with closed
      approval facts, committed-HEAD authority binding, DST-0060 denial
      (`state_blocked` when clean; `authority_dirty` when uncommitted), and
      live relocate fail-closed (`platform_invariant_unproven`). Keep open
      until DST-0059 register disposition and incident mitigation finish.
- [ ] 0.7 Reconcile the TypeScript migration package inventory to nine families
      that include `@foreman/policy` as its own package family (CW-023).
      Acceptance evidence: `typescriptmigration.md` states nine package
      families, lists `@foreman/policy` as its own family, and uses the Sprint
      0-through-17 order from `sprints.md` by exact reference without a
      contradictory 0-through-9 table. The file states that this package owns
      cross-package sprint order and that `node-typescript-runtime` retains
      detailed module contracts. Do not mark this task complete before the
      reviewed candidate is published and verified.
- [ ] 0.8 Assign `graph-project` ownership to `@foreman/knowledge` with typed
      `@foreman/event-log` input contracts (CW-024).
      Acceptance evidence: `design.md`, `specs/release-program/spec.md`,
      `sprints.md`, and `typescriptmigration.md` state that ownership. They
      state that `graph-project` consumes typed `@foreman/event-log` inputs
      and does not become the event-log system of record. Do not mark this
      task complete before the reviewed candidate is published and verified.

## 1. Program execution

- [ ] 1.1 Execute Sprints 1 through 17 in `sprints.md` order.
      Landed partial evidence through
      `04a310acd824d8dc06fe2b81dd19b8fa543e649b` (do not mark complete):
      - Architecture policy:
        `99accf3ba5d75c311aa9ede3460b4a4a49d9aa3e` (feat),
        `96d0f0750f415697985b4201f47b915734146d9b` (review record).
      - Installed-runtime integrity:
        `6a0bc5fdcfc6e06b9b56f52d7a3e9787ea99ae72` (feat),
        `524290f5f0a59c1f4ae05bcb4ceb8acf4fd15c88` (review record).
      - Windows path-seam:
        `aba8124d54ba35d34c1ffe973ea2031b6073ab8e` (memory install paths),
        `3164cfa5779b8aac8eebeea710c16f3f9688d56f` (delayed handle release).
      - Event-log foundation:
        `cbe27e831b3dcc95db8de248168374fe08e20350`.
      - Sprint 3 R1 queue admission:
        `a1e0dcf142eb02f5f198c0da730a51c11396a196`, corrected at
        `67ad311d831a150d3f91c327ba0b620232e3e9cb`.
      - Sprint 3 R2 attempt-bound round core:
        OpenSpec at `784b4a9`, `4f3287b`, and `238225c`; Node 24
        TypeScript and Effect implementation at
        `04a310acd824d8dc06fe2b81dd19b8fa543e649b`.
      - Sprint 3 R3 live round runtime: landed as the live Effect adapters,
        `lane-round` CLI/main, and tracked `dist/lane-round.js` runtime
        artifact under the same Node 24 TypeScript program; Setup and
        shell ownership seams remain open. Converged hosted evidence at
        exact commit `88cb164e462243e62c524b818e9bf7d00c7e8385` (Grok
        implementation + Windows correction; independent cold audit
        approved; Linux/Windows/formal workflows green).
      - Sprint 3 R4A typed vendor preflight (partial): closed contract,
        capability table from `env/reference-manifest.toml` only, pure
        classifier, Effect `VendorPreflight` + `ProcessExec`/`PathLookup`
        live adapter, `vendor-preflight` CLI, and embedded capability
        injection into `skills/foreman/runtime/dist/vendor-preflight.js`.
        First-pass host evidence: focused package tests 45/45 pass;
        typecheck fixed by aligning `PreflightCliEnv.layer` to
        `ProcessExec | PathLookup | PreflightClock` (CLI calls
        `inspectVendor` directly and must not require the unused
        `VendorPreflight` tag). R4A audit correction round 2: strict
        public-record decoder rejects non-`none` remediation with null
        instruction, `none` with non-null instruction,
        `not-authenticated` without `login` remediation, and `login`
        remediation without `not-authenticated`; vendor-bound mutating
        update guard allows exact `update --check --json` only when
        capability vendor is `grok` (CLI name/path alone never
        authorizes); live adapter refuses Claude/Codex poisoned vectors
        without spawn. Focused tests 53/53 pass after correction;
        `npm run typecheck`, `npm run build`, `npm run verify`,
        docs-check, and strict OpenSpec validation of `vendor-preflight`
        and `v030-release-program` all green. R4A gate correction round 3
        (candidate `f7185af39bd58ee0fe3789d790b177df34c8b3ce`): capability
        argv tails enforce public-probe UTF-8 bounds (per-entry 65_536,
        total 262_144) on `authArgv`/`versionArgv`/`updateCheckArgv`;
        capability-slice TOML array parser rejects missing/doubled/leading
        separators, trailing non-array content, and unterminated strings
        while accepting spaced and trailing commas; `parseFirstSemVer`
        accepts only one standalone SemVer token (rejects `1.2.3.4`,
        `1.2.3-01`, unsafe numeric prerelease); live adapter normalizes a
        relative `PathLookup.which` result to an absolute path before any
        probe and records/spawns that same absolute path. Focused tests
        58/58 pass; typecheck/build/verify/docs-check and strict OpenSpec
        validation of `vendor-preflight` and `v030-release-program` green;
        two builds of `dist/vendor-preflight.js` byte-identical
        (sha256 `bbc57443579139ec6b83b6b025b15fa423e2635ecd64f8941f4ba4304a66b92c`).
        R4A final correction round 4 (candidate
        `6bd57b722f7c8d9ff94468ce590612086017374a`): public-record consistency
        requires completed auth probe for `authenticated`/`not-authenticated`
        and completed version probe plus non-null `reportedVersion` for
        `current`/`outdated`; full probe argv
        `[resolvedExecutable, ...tail]` is bound-checked before any process
        (capability tails reserve one entry; invalid vectors return
        `capability_invalid` with zero spawns); `parseFirstSemVer` accepts
        only valid build metadata (rejects `1.2.3+foo..bar`, trailing/leading
        dots, bare `+`); live adapter preserves exact `PathLookup.which`
        bytes (`trim` only for all-whitespace detection). Focused tests
        65/65 pass; typecheck/build/verify/docs-check and strict OpenSpec
        validation of `vendor-preflight` and `v030-release-program` green;
        two builds of `dist/vendor-preflight.js` byte-identical
        (sha256 `a3f05637c2e64062edf81ebdccbf3a6faf0ba94671fd2e7f0bf2f18c44328ab9`).
        R4A closure correction round 5 (candidate
        `dd1578dd5aeacae7505eb9d608f21eb70ebf11eb`): public-record decoder
        rejects more than one probe of the same `kind` (completed-then-timeout
        and timeout-then-completed for auth and version); live adapter enforces
        `MAX_PATH_BYTES` (32_768 UTF-8) on the exact absolute resolved
        executable before full-argv validation or any process (oversize path
        returns `capability_invalid` with zero spawns; exact 32_768 accepted).
        Focused tests 67/67 pass; typecheck/build/verify/docs-check and strict
        OpenSpec validation of `vendor-preflight` and `v030-release-program`
        green; two builds of `dist/vendor-preflight.js` byte-identical
        (sha256 `7f102935a52b8d6152ff4e42ef32dfd06036012c47c03cfdd38a2ac38d204051`).
        Setup/`foreman-setup.sh` and lane callers are intentionally not
        wired in this slice.
      The remaining Sprint 3 work stays open (R4B+ shell migration,
        ownership, heartbeat, reaping, credential profiles, and other
        open Sprint 3 ports).
      - Sprint 3 R4B Setup vendor-preflight adapter (partial): pure
        `projectVendorPreflightToToolCheckRow` + `tool-check-row <grok|codex>`
        CLI command on the existing `vendor-preflight.js` artifact; shell
        `env/tool-check.sh` is a thin Node adapter (deleted `vendor_authed`
        and direct grok/codex auth/version probes). Unknown auth/currency
        maps to `degraded` with diagnose detail — never `not_authenticated`
        / login. Cold-audit boundary correction: CLI requires
        `decoded.vendor === parsed.vendor` before emit; shell requires exit
        0 + exactly one three-field TSV row bound to the requested vendor
        (wrong vendor, fourth field, second line, nonzero exit → degraded).
        Detail-byte boundary residual: shell rejects detail UTF-8 byte length
        > 512 (`MAX_TOOL_CHECK_DETAIL_BYTES`); exactly 512 accepted; 513+ →
        one `degraded` row. RED before fix: spoofed 513-byte ready row yielded
        `LANE_READY: grok=yes`. Acceptance correction: Bats spoof fixtures use
        shell-native byte generation (`head -c N /dev/zero | tr`), not
        Python; explicit 512-byte lower-bound case → `ok` /
        `LANE_READY: grok=yes`. LF framing residual: shell no longer uses bare
        `out="$(node ...)"` (strips trailing LFs); preserves exact framing via
        temp-file + sentinel and accepts only exactly one LF-terminated row.
        Missing final LF and extra trailing blank both → `degraded` / no lane
        ready (RED before fix). Raw-byte NUL residual: shell rejects any NUL
        in the capture file before Bash variable load (Bash strips NULs, so
        `gr<NUL>ok` → `grok` was accepted as ready before fix); one `degraded`
        row and no lane readiness; temp-file cleanup retained. Focused package
        tests 20/20; bats tool-check-auth + foreman-setup 31/31; shell adapter
        9/9; shellcheck clean; typecheck/build/verify-runtime/verify green
        (554 pass, 1 skip). Live dogfood: both lanes `ok` with floor versions
        on this host (prior residual). lane-run JSON consumption and full
        Sprint 3 close remain open.
      - Sprint 3 R4B2 tool-check TypeScript migration (partial, worktree):
        product logic in `packages/orchestration/src/tool-check*.ts`; generated
        `skills/foreman/runtime/dist/tool-check.js`; thin six-line
        `env/tool-check.sh` adapter; vendor authority is TypeScript
        inspect+project (no shell TSV/NUL parser). Focused tool-check 34/34;
        vendor-preflight 82/82; bats tool-check-auth + foreman-setup 24/24
        (mode 100644); full verify 588 pass + 1 skip. Live soft grok/codex
        LANE_READY=yes. Architecture Pass after host commits worktree
        (isolated sim empty findings); uncommitted HEAD still fails pre-
        migration findings. lane-run JSON consumption remains open.
      - Sprint 3 R4B3 dependency-drift TypeScript port (worktree, base
        `ee530cb0a2ee9567d3c077112bc1a416c0e85e5e`): readiness authority is
        `profileToolIds` (every profile x both WSL states); strict `[[tools]]`
        parse of `env/reference-manifest.toml` (rejects missing/duplicate id,
        missing required, invalid boolean, and a second `required` key in one
        record so overwrite cannot suppress tier drift); bounded bootstrap
        text rules (pseudo IDs, flock→util-linux, timeout→coreutils, nats
        unprovisioned INFO). Product logic in
        `packages/orchestration/src/dependency-drift.ts`; generated
        `skills/foreman/runtime/dist/dependency-drift.js`
        sha256 `c0fb3f43fd9f022aa8d1249784709a48718bfeb2bb2fec5e9fb96df2da7e2bb9`
        (two builds identical); thin six-production
        `dependencies/check-drift.sh` Node adapter (purpose-header comments
        only; no domain logic). Focused dependency-drift 35/35 after Codex
        cold-audit fix (duplicate `required` key → exit 2); tool-check +
        vendor-preflight 166/166; full verify 673 pass + 1 skip;
        typecheck/build/verify-runtime green; shellcheck clean; docs-check
        pass; openspec validate --changes --strict 32/32; architecture
        `check --base e298d29835a9ac93f8ef0313143a0f6bff7e2324` → Pass with
        zero findings. Authored `bash dependencies/check-drift.sh` → exit 0
        and `dependencies: no drift`. Base `ee530cb` had two conflicting
        `psscriptanalyzer` records; candidate retained soft/full
        `powershell` check from `0001bc0c` and removed full-only `pwsh`
        check from `c1d3f165` (Get-Module could succeed when the module was
        absent). Host commit + re-audit + hosted Windows residual.
- [ ] 1.2 Use Grok workers in isolated Foreman worktrees for implementation.
- [ ] 1.3 Run deterministic checks and a different-family Codex cold audit for
      every complete sprint diff.
- [ ] 1.4 Run Council at each immutable commitment boundary.
- [ ] 1.5 Rework every actionable finding before the next sprint starts.

## 2. Release convergence

- [ ] 2.1 Verify all coverage rows have shipped evidence or an
      `evidenced_defer` that names reason, owner, target release, blocking
      dependency, and acceptance evidence.
- [ ] 2.2 Verify the destruction log has no unknown recovery owner.
- [ ] 2.3 Verify zero in-scope Python and no new non-TypeScript product logic.
- [ ] 2.4 Rebuild Graphify as one current knowledge unit.
- [ ] 2.5 Pass all local and hosted gates on one unchanged pushed commit.
- [ ] 2.6 Complete cold audit, Council review, release record, tag, and
      publication verification.
