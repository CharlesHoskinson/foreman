# Foreman v0.2.5 — Lane D: Bun ecosystem/ops research

**VERDICT: GO-WITH-CAUTIONS** — Bun is a sound stack bet for Foreman's tooling layer. The Anthropic acquisition materially *strengthens* the long-term viability case (Claude Code itself is a bun-compiled binary, so Anthropic has an existential incentive to keep `bun build --compile` working on Windows), but it introduces roadmap-capture risk, and the in-flight Zig-to-Rust rewrite means the stable channel is mid-transition right now. Pin a proven 1.3.x stable; do not adopt 1.4.x until it has weeks of post-GA soak.

Research date: 2026-07-16. All findings date-stamped; access date is 2026-07-16 unless noted.

---

## 1. Bun x Anthropic acquisition

**What/when.** Anthropic acquired Oven (the company behind Bun) — announced **December 2, 2025** — framed around Claude Code reaching $1B annual run-rate revenue. Claude Code ships as a single binary compiled with `bun build --compile` to millions of developers on macOS/Linux/Windows. [https://bun.com/blog/bun-joins-anthropic, accessed 2026-07-16] [https://www.anthropic.com/news/anthropic-acquires-bun-as-claude-code-reaches-usd1b-milestone, accessed 2026-07-16]

**Stated commitments** (from the Bun announcement post):
- Bun remains **open-source & MIT-licensed**.
- Continued public development on GitHub; existing team continues full-time on Bun.
- Node.js-compatibility / drop-in-replacement goals persist; roadmap stays "high performance JavaScript tooling" serving users beyond Anthropic.
- Jarred Sumner explicitly positioned single-file executables for AI CLI distribution as the strategic fit. [https://bun.com/blog/bun-joins-anthropic, accessed 2026-07-16]

**Community reaction** (HN thread, Dec 2025): mixed. Positives — "if Bun breaks, Claude Code breaks" alignment; removes VC monetization pressure from a startup that had no obvious revenue model. Concerns — what happens if Anthropic's and Bun's directions diverge; single-vendor consolidation; skepticism about AI-driven acquisitions generally. [https://news.ycombinator.com/item?id=46124258, accessed 2026-07-16] RedMonk's analysis treated it as a notable open-source/AI case study. [https://redmonk.com/sogrady/2026/06/04/bun-two-lessons/, listed 2026-07-16 — UNVERIFIED content, not fetched]

**Changes since the acquisition:**
- **License: unchanged** (MIT, confirmed below).
- **Release cadence:** v1.3.x stable releases continued ~every 2-4 weeks post-acquisition (v1.3.5 2025-12-17 through v1.3.14 2026-05-13, 10 releases). Comparable to pre-acquisition cadence — no slowdown through May. [https://github.com/oven-sh/bun/releases, accessed 2026-07-16]
- **Major post-acquisition event — the Rust rewrite:** the ~535k-line Zig core was rewritten in Rust in **11 days (May 3-14, 2026)** using 64 parallel Claude (Fable 5 pre-release) instances, 6,502 commits, one supervising engineer. Motivation: recurring memory-safety bugs (use-after-free, double-free, leaks) from Zig's manual memory management interacting with GC'd JavaScriptCore values. v1.4.0 (first Rust version) reportedly fixes 128 bugs reproducible in v1.3.14; binaries shrink ~20% on Linux/Windows. [https://bun.com/blog/bun-in-rust, published 2026-07-08, accessed 2026-07-16]
- **Current channel state (important):** as of 2026-07-16, **v1.3.14 (2026-05-13) is the latest stable; the Rust code (v1.4.0) ships only in canary** (`bun upgrade --canary`). ~99.8% pre-existing-test-suite pass rate on Linux x64 glibc at merge time. That means a ~2-month stable-release gap during the transition. [https://bun.com/blog/bun-in-rust, accessed 2026-07-16; https://news.ycombinator.com/item?id=48132488, listed 2026-07-16]
- **Governance:** no formal governance change found; Bun remains a company-controlled (now Anthropic-controlled) project under oven-sh, not foundation-governed. UNVERIFIED beyond absence of evidence.
- Community quality pushback exists: issue #27664 (2026-03-01) complains of 4.8k+ open issues, Windows/macOS/Linux segfaults, AI-generated PRs (`@robobun`) merged without resolving root causes, and feature velocity outpacing stability. [https://github.com/oven-sh/bun/issues/27664, accessed 2026-07-16]

## 2. License

- **Runtime: MIT.** Confirmed on the official license page post-acquisition. [https://bun.com/docs/project/licensing, accessed 2026-07-16]
- **Compiled-binary output — the nuance:** Bun statically links **JavaScriptCore/WebKit, which are LGPL-2** (also `tinycc` LGPL-2.1). A `bun build --compile` executable embeds the whole runtime, so **redistributing** the binary carries LGPL-2 obligations: recipients must be able to relink against a modified library (Bun's patched WebKit source is published at https://github.com/oven-sh/webkit for this purpose), plus attribution for esbuild-derived code. Other deps are MIT/Apache/BSD. [https://bun.com/docs/project/licensing, accessed 2026-07-16]
- **Practical read for Foreman:** if the Foreman launcher binary is compiled locally per-machine or distributed within the team, exposure is negligible; if we publicly redistribute the compiled .exe, include a THIRD_PARTY_LICENSES notice and a pointer to oven-sh/webkit. This is exactly what Anthropic already does for Claude Code, so the pattern is legally trodden. No restriction on *use* of compiled output; no royalty/field-of-use constraints found. (Not legal advice; UNVERIFIED against counsel.)

## 3. Windows stability track record

- **CI is first-class:** Bun's Buildkite pipeline (`.buildkite/ci.mjs`) runs macOS, Linux, and **Windows (x64 and arm64)** VMs as peers; debug and release builds support windows-x64/arm64; official docs include a "Building Windows" page. [https://bun.com/docs/project/building-windows, accessed 2026-07-16; https://alexanderop.github.io/aiBlog/robobun/, accessed 2026-07-16]
- **Trend:** native Windows support has matured through 1.x; windows-arm64 landed in v1.3.10 (2026-02). Release notes across v1.3.x consistently include Windows-specific fixes. [https://github.com/oven-sh/bun/releases, accessed 2026-07-16]
- **But Windows regressions do ship**, at a real if not alarming rate. Concrete recent examples, mostly surfaced via opencode (the largest third-party bun-compiled CLI):
  - GC-related crash in the Bun bundled inside opencode's Windows binary [https://github.com/oven-sh/bun/issues/26625, accessed 2026-07-16]
  - `bun` npm package non-functional on Windows ("This app can't run on your PC") while `@oven/bun-windows-x64` worked [https://github.com/oven-sh/bun/issues/18041, accessed 2026-07-16]
  - Slow `bun i` on Windows in CI [https://github.com/oven-sh/bun/issues/17011, accessed 2026-07-16]
  - Windows segfaults called out in the #27664 quality thread (2026-03-01).
- **Honest read:** Windows is genuinely first-class in CI and roadmap, but it remains the platform where regressions are most often reported first, and Bun's overall open-issue count (4.8k+) is high. The Rust rewrite is explicitly aimed at the crash/leak class of bugs that hit Windows hardest — positive medium-term, destabilizing short-term.

## 4. Version/installation ops for Foreman

**Install on Windows without admin** (all user-scoped, no elevation):
1. **Official PowerShell script (recommended):** `powershell -c "irm bun.sh/install.ps1 | iex"` — installs to `%USERPROFILE%\.bun`, user PATH only. [https://bun.com/docs/installation, accessed 2026-07-16]
2. **Scoop:** `scoop install bun` — Scoop itself installs to `~\scoop` with no admin; use `scoop update bun` to upgrade. [https://scoop.sh, https://bun.com/docs/installation, accessed 2026-07-16]
3. **npm:** `npm i -g bun` works but has a Windows track record of shipping a broken wrapper (issue #18041) — treat as fallback only.

**Pinning a version per-repo:**
- **`.bun-version` file** in repo root (plain version string) — respected by `setup-bun` GitHub Action, BunVM, bunenv. [https://bunvm.com/, accessed 2026-07-16]
- **`packageManager: "bun@1.3.x"` in package.json** — supported by setup-bun (reads it out of the box in current versions) and corepack-style tooling. [https://github.com/aklinker1/bunv, https://github.com/oven-sh/bun/discussions/10955, accessed 2026-07-16]
- `bunfig.toml` does **not** pin the runtime version (it pins install behavior, e.g. `install.exact = true`). Use `.bun-version` + `packageManager` together, and have the harness **assert `Bun.version` at startup** against the pin — that is the only enforcement that works for a *compiled* binary, since the runtime is baked in at compile time.

**Upgrade cadence policy recommendation (safety-critical harness):** see "Version policy recommendation" section below.

## 5. Prior art: process supervisors / CLI tools on Bun

- **Claude Code (Anthropic)** — the flagship: bun-compiled single binary to millions of users on all three OSes. Notably it **overrides the compiled binary's metadata** so `bun run` inside it doesn't mis-resolve — a trick Foreman should copy if we embed Bun. [https://github.com/anomalyco/opencode/issues/15880, accessed 2026-07-16]
- **opencode (anomalyco/SST)** — large OSS AI-coding CLI shipping bun-compiled binaries. Its issue tracker is the best field report on this exact architecture; problems reported:
  - **Frozen embedded runtime:** binary compiled with Bun 1.3.5 kept exhibiting 1.3.5 bugs (LSP crashes on Windows) even when users had newer system Bun — "every Bun bug becomes an opencode crash." [https://github.com/anomalyco/opencode/issues/11824, accessed 2026-07-16]
  - Stock compiled-binary metadata causing `bun run` to resolve tools to `opencode.exe` on Windows. [https://github.com/anomalyco/opencode/issues/15880]
  - musl-vs-glibc binary selection bug via `bunx` on WSL. [https://github.com/anomalyco/opencode/issues/8826]
  - NAPI panic on macOS with Bun v1.3.13. [https://github.com/anomalyco/opencode/issues/24148]
  - Community even proposed rewriting the launcher in Go to escape runtime coupling. [https://github.com/anomalyco/opencode/issues/26307]
- **BM2 (bun-bm2/bm2)** — pm2-like "Bun managing Bun" process orchestrator: daemonless-fast startup, `Bun.spawn`-based supervision, health probes, cron restarts, watch-restart. Young project; demonstrates `Bun.spawn` is adequate for supervision workloads. [https://github.com/bun-bm2/bm2, accessed 2026-07-16] Plus a dev.to writeup of building a custom Bun process manager after leaving pm2. [https://dev.to/zakpie/why-i-stopped-using-pm2-and-built-my-own-bun-process-manager-4ehe, accessed 2026-07-16]
- pm2 itself officially supports running Bun apps (interpreter mode), confirming the pattern is mainstream. [https://pm2.keymetrics.io/docs/usage/bun-deno/, accessed 2026-07-16]

**Lesson for Foreman:** the failure mode of bun-compiled supervisors is not "Bun can't do it" — it's **version coupling**: the runtime is frozen into the binary, so a Bun bug requires recompiling and re-shipping. Mitigations: pin a known-good version, assert it at startup, keep the launcher small (~500 lines means fast requalification), and recompile promptly when the pin moves.

## 6. Alternatives sanity check: Go

For a ~500-line launcher, Go is a genuinely cheap alternative and the fairest comparison point: single ~60MB toolchain install (also admin-free via zip/scoop), trivially reproducible builds, `GOOS`/`GOARCH` cross-compilation built in, and everything a supervisor needs — `os/exec`, Windows job objects via `golang.org/x/sys/windows` — with **zero CGO/FFI**, producing a ~2-8MB static .exe with no embedded JS runtime and no LGPL-linked components. Runtime maturity and Windows regression rate are clearly better than Bun's. The costs are: a second language in a TypeScript-centric repo (context-switch and review overhead), no code/type sharing with the rest of Foreman's TS tooling, and losing the "one runtime for harness + scripts + tests" story that Bun gives. Verdict: Go wins on pure binary-robustness grounds for the launcher in isolation; Bun wins on stack coherence and the fact that our whole tooling layer, and Claude Code itself, already lives there. If Bun's stable channel ever destabilizes badly (e.g. a rocky 1.4.x), porting a 500-line launcher to Go is a ~1-2 day escape hatch — that small escape cost is itself an argument that betting on Bun now is low-risk.

---

## RISKS (ranked)

1. **Rust-rewrite transition risk (HIGH, near-term).** The entire core was rewritten in 11 days, largely AI-generated, and v1.4.0 is still canary-only with stable frozen at v1.3.14 since 2026-05-13. First few 1.4.x stables will likely carry novel regressions; the 0.2% test-suite gap and Windows coverage of the rewrite are unproven. [bun.com/blog/bun-in-rust]
2. **Acquisition/roadmap-capture risk (MEDIUM).** Bun's roadmap now serves Anthropic's AI-tooling priorities first. Upside: Claude Code's needs (single-file executables, Windows, process spawning) are almost exactly Foreman's needs. Downside: features Anthropic doesn't need may stagnate, and a future strategy shift (or Anthropic deprioritizing Bun) has no foundation-governance backstop.
3. **Single-vendor risk (MEDIUM).** MIT license means a fork is always possible, but in practice maintainers are Anthropic employees; no independent governance, no LTS branch, no second implementation.
4. **Version-coupling risk in compiled binaries (MEDIUM, mitigable).** opencode's track record shows every embedded-runtime bug ships to users until recompile. Mitigate with pinning + startup version assertion + small launcher surface.
5. **Windows regression rate (MEDIUM-LOW, improving).** Windows is first-class in CI, but is still where crashes surface first (GC crash #26625, npm wrapper #18041); 4.8k+ open issues overall.
6. **LGPL-2 redistribution obligation (LOW).** Only bites on public redistribution of compiled binaries; satisfied with a license notice + pointer to oven-sh/webkit.
7. **No stable/LTS channel policy (LOW-MEDIUM).** Bun has no LTS; endoflife.date tracks it but there is no supported-versions guarantee — an old pin gets no backported fixes.

## Version policy recommendation

For a harness that compiles a safety-critical binary:

1. **Pin, don't float.** Pin **Bun 1.3.14** (last Zig stable, 2026-05-13) via `.bun-version` **and** `packageManager: "bun@1.3.14"` in package.json. If a late-1.3.x fix matters, qualify it explicitly; never use `latest`.
2. **Assert at runtime.** The launcher's first act: compare `Bun.version` (and ideally `Bun.revision`) against the repo pin; refuse to run the compiled binary if built from an unpinned version (embed the pin at compile time).
3. **Skip 1.4.0 entirely; adopt 1.4.x only after soak.** Treat the Rust rewrite as a new major. Criteria to move: at least 2 consecutive 1.4.x stable patch releases, at least 4 weeks on stable channel, no open P0/P1 Windows crash issues tagged against the release, and our own test suite green on Windows under the candidate.
4. **Upgrade cadence: deliberate, ~quarterly.** Review Bun releases quarterly (or on a CVE/crash-fix that affects us); each pin bump is a PR that recompiles the binary and runs the full Foreman verification suite on Windows before merge. Never bump the pin and the launcher's logic in the same PR.
5. **Never ship canary.** Canary is for reproducing upstream bugs only.
6. **Install path:** official `install.ps1` (user-scoped, no admin) or Scoop on dev machines; CI uses `oven-sh/setup-bun` which honors `.bun-version`/`packageManager`.
7. **Keep the Go escape hatch documented.** The launcher stays small and runtime-API-light (`Bun.spawn`, file I/O) so a 1-2 day Go port remains viable if the 1.4 transition goes badly.
