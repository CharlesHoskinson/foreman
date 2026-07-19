# foreman v0.2.9 — WSL compatibility (design)

**Status:** design for planning (2026-07-19). **Method:** four parallel research
lanes — two internal (harness WSL-fragility surface; WSL failure history) and two
external via scrapling (WSL2 system SOTA; WSL2 dev-toolchain SOTA, cited from
Microsoft Learn / git-scm / Docker / GitHub Actions / microsoft/WSL). Raw external
findings cached under `scratchpad/research/`.

## The reframe (the single most important finding)

**v0.2.9 is NOT about fixing broken WSL-native code — most of it is already
correct.** The internal surface audit confirmed: platform detection lands WSL in
the `posix` branch everywhere; `taskkill` sites are all gated behind
`LANE_PLATFORM==windows` / a Cygwin-only `/proc/<pid>/winpid` check; the
`MSYS_NO_PATHCONV` container guard is a documented no-op on WSL; tool resolution
(bats/pueue/jq/bun) is `$HOME`-relative and correct; docs already frame WSL as
co-equal. None of that should consume v0.2.9 budget.

The real gaps are **(1) already-built WSL protections that were never shipped,
wired, or verified**, and **(2) the Windows↔WSL *seam*** (auth callbacks,
filesystem boundary, tool PATH, daemon lifecycle). v0.2.9's job is to **make the
built protections actually run for a fresh WSL operator, keep them verified in
CI, and harden the seam** — plus close two concrete CRLF/exec-bit traps.

Also load-bearing from the SOTA research: the **severe WSL2 sleep/resume clock
drift was fixed upstream in WSL 2.1.1 (Jan 2024)** — so foreman's v0.2.7.5
clock-preflight + resync Scheduled Task were built for a now-fixed bug and must
**pivot** to version-currency + the residual dual-NTP jitter.

## Evidence base (per theme, with the load-bearing citations)

- **Launcher never shipped on WSL** (internal): `launcher/dist/` is gitignored
  (`.gitignore:26`); `build:posix` exists (`launcher/package.json:11`) but nothing
  runs it — not `bootstrap-wsl.sh`, not `foreman-setup.sh`, not CI. Neither
  `tool-check.sh` nor `reference-manifest.toml` has a `foreman-launch` entry. So
  `fl_resolve_launcher`
  (`lib/launch.sh:18-45`) / `lane_resolve_launcher` (`lane-run.sh:542-564`) fail on a
  fresh WSL clone → `lane-run.sh:962-969` emits `{kind:degraded, reason:launcher_absent}`
  and runs WITHOUT the pidns kill-cascade — the entire v0.2.7.5 posix-cascade-parity
  guarantee — silently, with no readiness signal.
- **Extensionless scripts lack the `eol=lf` attribute (CRLF on autocrlf checkouts)**
  (internal, corrected by Opus audit): `skills/superpowers/skills/
  subagent-driven-development/scripts/{review-package,sdd-workspace,task-brief}` are
  `#!/usr/bin/env bash` + `set -euo pipefail`. Their git INDEX blobs are LF
  (`git ls-files --eol` → `i/lf`), but they carry NO `eol=lf` attribute
  (`git check-attr eol` → unspecified) because the `.gitattributes` fix keys on
  `*.sh/*.bash/*.bats` extensions. So on a checkout with `core.autocrlf=true`
  (Git-Bash's default, and a shared `/mnt/c` Windows checkout read from WSL —
  exactly the 2026-07-16 scenario, `bugeventlog.md:17`), they get CRLF in the
  working tree (`w/crlf`) and WSL bash rejects `pipefail\r`. A fresh ext4 clone
  (`autocrlf=false`) checks them out LF → no bug — so this is a **shared-checkout /
  autocrlf-seam** hardening, NOT a fresh-clone blocker. The durable fix is
  extending `eol=lf` attribute coverage (which forces LF working-tree even under
  autocrlf=true, exactly as `*.sh` already are `w/lf` here); `git add --renormalize`
  is a no-op (index already LF).
- **Those same 3 scripts are a live exec-bit trap** (internal, Opus audit): they are
  git-mode `100644` and invoked by **direct exec** (`scripts/review-package BASE
  HEAD` from `SKILL.md`/the SDD prompts — the sub-skill this plan itself mandates),
  never `bash …`; `install.sh`'s chmod glob (`:62-63`) only touches
  `skills/foreman/scripts/*.sh` + `lib/*.sh`, never `skills/superpowers/**`. So on a
  fresh ext4 clone they are `0644` → `Permission denied`. This is CURRENT, not
  hypothetical.
- **CRLF policy (SOTA)** (R4): Microsoft/VS Code's exact recommendation is a
  repo-root `.gitattributes` with `* text=auto eol=lf` + `*.bat/*.cmd eol=crlf`
  carve-outs; `git add --renormalize`. foreman has the `*.sh` rules but NOT the
  `* text=auto` catch-all — hence the extensionless gap.
- **Clock kernel-fixed** (R3): WSL 2.1.1 (2024-01-22, microsoft/WSL#10006) fixed the
  severe drift; residual is a ~1-2s dual-NTP jitter (WSL `systemd-timesyncd` vs
  Hyper-V host sync) — fix = `timedatectl set-ntp false` inside WSL. foreman's
  `wsl-clock-preflight.sh` + `wsl-clock-resync-task.xml` are BUILT but wired into
  NOTHING (`lane-run.sh`/`foreman-setup.sh` never reference them) — R2's "single
  largest built-but-not-connected gap."
- **Filesystem boundary** (R2/R3): `/mnt/c` (9P/DrvFs) is 2-20× slower and lacks the
  fsync guarantees the event-log crash-safety model needs (`durable-lanes.md:106-108`);
  no runtime guard warns if `FOREMAN_HOME`/a worktree resolves under `/mnt/*`.
- **Tool PATH persistence** (R2/R4): grok needs a manual `export PATH="/c/root/.local:$PATH"`
  (a Git-Bash-only path, wrong on WSL); WSL codex once resolved the Windows npm shim
  via `appendWindowsPath` (fixed in bootstrap but per-machine, not repo-tracked);
  non-interactive lane shells do NOT source `~/.bashrc`, so tool dirs must be
  persisted for lanes explicitly, not via profile. The `timeout 10 grok models`
  readiness probe couples unit tests to live network/PATH.
- **Auth callbacks / networking** (R2/R3): codex `--device-auth` falls back to a
  localhost:1455 browser flow that dies across the WSL boundary (fixed by doctrine in
  v0.2.8.1). SOTA: `localhostForwarding` (default true) makes the callback work under
  NAT, but `::1` is NOT forwarded (bind IPv4); mirrored mode shares `127.0.0.1` but is
  still receiving port-tracking fixes (2.9.3/2.9.4, mid-2026). NATS `localhost:4222`
  needs same-side or mirrored (`durable-lanes.md:99-105`).
- **Daemon lifecycle** (R3): `systemd=true` does NOT keep the WSL VM alive — a
  `pueue`/docker daemon dies with the VM unless a Windows-side handle holds it open.
- **CI void** (internal): the bats suite (incl. the real `tests/launcher.bats` pidns
  family) runs on NO CI platform; `install.sh` has no smoke test; only
  `windows-smoke.yml` (install.ps1) exists. WSL protections are verified by hand, once.
- **Exec-bit trap** (internal): all 445 tracked files are git mode `100644`; works
  only because scripts are called `bash foo.sh` + `install.sh`'s narrow chmod glob —
  one direct-exec new script away from a WSL-only "Permission denied" Windows can
  never surface.
- **CI SOTA** (R4): `ubuntu-latest` (LF/bash) is the WSL proxy; add `windows-latest`
  with `shell: bash` for the Git-Bash half; explicit `bash` enables `pipefail`
  (the implicit non-Windows shell does not); `--noprofile --norc` means no `~/.bashrc`.

## The six v0.2.9 packages

Ordered by dependency + severity. P1-P3 are the blockers (ship the built
protections + close the live CRLF bug); P4-P6 harden the seam and keep it verified.

### P1 — wsl-launcher-shipped (BLOCKER; capability `launcher-dist`)

Make the POSIX launcher a real, present, checked artifact on WSL so the pidns
kill-cascade guarantee is not silently absent.

- `env/bootstrap-wsl.sh` (and/or `foreman-setup.sh`) gains an idempotent
  build-if-absent step: `(cd launcher && bun run build:posix)` producing
  `launcher/dist/foreman-launch`, skip-if-present + skip-if-bun-absent (logged).
- `env/tool-check.sh` + `env/reference-manifest.toml` gain a `foreman-launch` entry.
  On WSL (`posix`) hard/full: WHERE `bun` is present but the launcher is absent, the
  verdict is NOT-READY (the build is available — cite `bun run build:posix`); WHERE
  `bun` itself is absent (bun is only `should_full`, `tool-check.sh:279`), it is a
  loud DEGRADED warning, NOT hard NOT-READY (else readiness is permanently blocked on
  a should-tool). Either way the operator is told.
- `lane-run.sh`'s existing `launcher_absent` degraded alert gains a Setup-actionable
  hint (build command); no behavior change to the frozen degraded path itself.
- Docs (`docs/INSTALL.md`, `docs/USAGE.md` POSIX-cascade troubleshooting,
  `launcher/README.md`) state the build step + that Setup performs it.
- **EARS:** WHEN `foreman-setup`/`bootstrap-wsl` runs on WSL, it SHALL ensure
  `launcher/dist/foreman-launch` exists, building it when bun is present and it is
  absent. WHEN a Use lane starts on WSL WHERE the launcher is absent AND `bun` is
  present, tool-check SHALL report NOT-READY (hard/full) naming the build step;
  WHERE `bun` is also absent, it SHALL emit a loud DEGRADED warning instead of a
  hard NOT-READY. The frozen launcher-absent degraded fallback SHALL remain
  byte-unchanged.

### P2 — crlf-extensionless-hardening (BLOCKER; capability `line-endings`)

Harden the autocrlf-seam so a shared `/mnt/c`/Git-Bash (`autocrlf=true`) checkout
never gets CRLF in a bash script, AND fix the same 3 scripts' exec-bit trap.

- `.gitattributes`: add `* text=auto eol=lf` catch-all + a binary carve-out
  (`*.png *.jpg *.jpeg *.ico *.pdf *.exe binary`, insurance against `text=auto`
  mis-detecting a NUL-free binary); explicit `eol=lf` rules for the three
  extensionless shebang scripts (mirroring the vendored `hooks/session-start` rule);
  `*.bat *.cmd *.ps1 text eol=crlf` carve-out. This forces LF working-tree on
  `autocrlf=true` checkouts (as `*.sh` already are `w/lf`). `git add --renormalize`
  is NOT needed for line endings (the index blobs are already LF) — it may run to
  pick up the newly-attributed files but is expected to be a near-no-op.
- **Exec-bit fix:** `git update-index --chmod=+x` the three scripts (committed mode
  `100644` → `100755`) so a fresh ext4 clone can direct-exec them (they are the SDD
  skill's own `scripts/review-package` etc., invoked without `bash`). This is the
  P6 exec-bit concern's concrete instance and is fixed HERE (the two defects share
  the same 3 files).
- A regression test (`tests/line-endings.bats`) that asserts, for EVERY tracked file
  with a `#!.../bash` shebang (any extension), that its git INDEX is LF
  (`git ls-files --eol` → `i/lf`) — non-vacuous on every host, including ext4 where
  the working tree is already LF — AND (on an `autocrlf=true` checkout) that the
  working tree has no `\r`. The red-first proof runs on a Git-Bash/`windows-latest`
  (`autocrlf=true`) checkout — the only place the 3 are `w/crlf` today.
- **EARS:** Every tracked file that bash executes SHALL be LF in its git index on
  every platform, and SHALL be LF in the working tree on an `autocrlf=true` checkout.
  WHERE a file is a genuine Windows script (`.bat/.cmd/.ps1`), it SHALL be CRLF.

### P3 — wsl-preflight (BLOCKER/MAJOR; capability `wsl-preflight`)

A single WSL preflight, run at Setup AND lane-start, that verifies the environment
invariants the harness silently depends on — and wire the (now-lightweight) clock
check into it (the pivot).

- New `skills/foreman/scripts/wsl-preflight.sh` (detects WSL via
  `grep -qi microsoft /proc/version`; a no-op off WSL). On WSL it checks:
  - **Filesystem:** IF `FOREMAN_HOME` (where the event log lives — NOT the worktree)
    resolves under `/mnt/*`, THEN refuse (fsync integrity), UNLESS
    `FOREMAN_ALLOW_MNT_HOME=1` is set (then loud-warn and proceed). Resolve the path
    with `realpath -m` (handles a not-yet-created dir + symlinks). A `/mnt` WORKTREE
    is only WARNed (perf), never refused — the event log is under FOREMAN_HOME, and a
    worktree refusal would ban the documented `/mnt/c`-clone-inspected-from-Windows
    workflow (`bugeventlog.md`).
  - **Clock:** WSL build ≥ 2.1.1 (warn to `wsl --update` if older); detect the
    dual-NTP jitter condition and recommend `timedatectl set-ntp false` (the
    v0.2.7.5 `wsl-clock-preflight.sh` drift check folds in here as the residual-jitter
    guard; the heavy `wsl-clock-resync-task.xml` is retired to an OPTIONAL documented
    operator step, no longer the primary mechanism).
  - **Networking (conditional):** WHERE a cross-boundary `localhost` dependency is
    configured (NATS `nats.url`, or an interactive login expected), verify mirrored
    mode OR NAT-with-localhostForwarding is active, and warn about `::1`.
  - **Tool resolution:** `command -v grok/codex/bun/node` SHALL resolve to a
    non-`/mnt/c` path (else warn: Windows shim shadowing the WSL-native binary).
- Wire the preflight into `foreman-setup.sh` (Setup) and `lane-run.sh`'s lane-start
  (Use) — non-fatal warnings except the `/mnt/*` FOREMAN_HOME refusal.
- **EARS:** WHEN a lane starts on WSL, the preflight SHALL run before any timestamped
  event is written. IF `FOREMAN_HOME` resolves under `/mnt/*` AND
  `FOREMAN_ALLOW_MNT_HOME` is not set, THEN foreman SHALL refuse the run citing fsync
  integrity; WHERE `FOREMAN_ALLOW_MNT_HOME=1`, THEN it SHALL loud-warn and proceed.
  The refusal SHALL NOT fire for the Windows Git-Bash default (`/c/...`), only WSL
  `/mnt/*`. IF the WSL build is < 2.1.1, THEN it SHALL warn to `wsl --update`. WHERE a
  cross-boundary localhost dependency is configured AND neither mirrored nor
  localhostForwarding is active, THEN it SHALL warn.

### P4 — wsl-tool-path-persistence (MAJOR; capability `environment`)

Make correct tool resolution a Setup guarantee for non-interactive lanes, not an
operator-remembered `export`.

- `foreman-setup.sh`/`bootstrap-wsl.sh` writes a foreman-owned env file (e.g.
  `~/.foreman/env.sh`) that prepends the WSL-native tool dirs (grok, codex, bun, node,
  `/usr/local/bin`) — and lanes source it (since non-interactive shells skip
  `~/.bashrc`). On WSL, `appendWindowsPath=false` is the documented recommendation;
  foreman does not require it but its PATH ordering SHALL win regardless.
- Stub/decouple the `timeout 10 grok models` readiness probe so grok-lane /
  vendor-isolation UNIT tests do not depend on live grok reachability (a mock/seam).
- Fix the `/c/root/.local` doc snippet across ROADMAP/specs to give the WSL analog
  (grok resolved via foreman's env file / `/usr/local/bin`, not `/c/root/.local`).
- **EARS:** WHEN a Use lane spawns a vendor CLI on WSL, foreman SHALL resolve it to a
  WSL-native binary (not a `/mnt/c` Windows shim) without depending on `~/.bashrc`
  being sourced. The grok-readiness UNIT tests SHALL NOT depend on live grok network
  reachability.

### P5 — wsl-ci-parity (MAJOR; capability `ci`)

Keep every WSL protection verified automatically.

- `.github/workflows/ci.yml`: an `ubuntu-latest` job that checks out, builds the
  POSIX launcher (`bun run build:posix`), runs `shellcheck`, the bats suite (incl. the
  `tests/launcher.bats` pidns family and `tests/line-endings.bats`), and smoke-tests
  `install.sh`; a `windows-latest` job with `defaults.run.shell: bash` running
  `shellcheck` + the LF/line-endings check (the Git-Bash half). Explicit `bash`
  everywhere (pipefail); tool paths sourced explicitly (no `~/.bashrc` in CI).
- **EARS:** The repository SHALL run `shellcheck` + the bats suite on `ubuntu-latest`
  in CI on every PR that touches shell scripts or the launcher. WHEN CI runs on
  `windows-latest`, it SHALL use `shell: bash`. The `install.sh` path SHALL have a
  CI smoke test analogous to the existing `windows-smoke.yml`.

### P6 — wsl-seam-doctrine (doctrine + minor code; capability `wsl-seam`)

Codify the Windows↔WSL seam rules the field runs surfaced, and close the exec-bit
trap.

- **Auth callbacks:** a single uniform rule — any browser/`localhost`-callback auth
  flow touching a WSL-hosted process SHALL run operator-foreground (`! <login>`),
  never orchestrator-launched-and-detached (codex done; extend to grok `--device-code`
  and any future vendor); note the `::1`-not-forwarded gotcha (bind IPv4).
- **Daemon lifecycle:** doctrine that `systemd=true` does NOT keep the WSL VM alive —
  foreman's pueue daemon on WSL needs a Windows-side keep-alive handle OR
  restart-on-demand; `lane-queue.sh ensure` already re-spawns pueued, so document +
  verify the restart-on-demand path is the supported model on WSL.
- **Docker:** doctrine that the container hard-mode host on WSL is Docker Desktop's
  WSL2 backend (detect via `command -v docker && docker info`; the uninstall-native-
  `docker-ce` warning); document WSL Docker as the supported/verified container host.
- **Exec-bit hygiene:** the three direct-exec'd extensionless scripts are chmod'd +x
  in P2 (they share those files). P6 adds `tests/exec-bit.bats` that asserts every
  script invoked by DIRECT exec (not `bash foo.sh`) — **including extensionless
  shebang scripts, not just `*.sh`** (the class that hid this) — is git-mode `100755`
  or has an `[[ -x ]]` guard; document the "call via `bash` or add +x" rule.
- **Platform detection:** consolidate the drift — add the missing `*NT*` clause to
  `lane_platform()` (`lane-run.sh:129-134`) OR extract a single shared `platform()`
  helper the three call sites use (low-risk, optional).
- **EARS:** A browser-callback auth flow on WSL SHALL be operator-foreground, never
  orchestrator-detached. WHERE the pueue daemon is used on WSL, foreman SHALL treat it
  as restart-on-demand (not persistent across VM idle-shutdown). Every directly-exec'd
  tracked script SHALL be executable-or-guarded.

## Sequencing, execution, testing

- **Order:** P1 (launcher shipped) and P2 (CRLF) first — they are live blockers a
  fresh WSL operator hits. P3 (preflight) next (depends on nothing but touches
  foreman-setup + lane-run). P4 (tool path) and P6 (seam/exec-bit) in parallel-ish.
  P5 (CI) LAST — it consumes P1's build step + P2's line-endings test + the launcher
  bats family, so it should encode the finished surface.
- **Execution:** Sonnet 5 implements per package, Opus 4.8 audits; each gated on a
  QUIET host with grok on PATH (`export PATH="/c/root/.local:$PATH"`), and — where it
  matters — verified LIVE on the WSL2 host (launcher build + pidns kill-shot;
  wsl-preflight against a real `/mnt/*` FOREMAN_HOME; the CRLF regression on a real
  fresh clone).
- **Testing bias:** every package ships a bats test; the WSL-specific behaviors are
  proven on the real WSL2 host (as v0.2.8 proved the container profile live), not just
  by shims — because the whole class of these bugs is "passes on Windows/shims,
  breaks on real WSL."

## Risks / open questions

- **Launcher build in CI/Setup needs bun** — bootstrap-wsl already installs bun; the
  build-if-absent step must skip-and-warn (not fail) when bun is missing, and CI must
  install bun before `build:posix`.
- **CRLF is an attribute/exec-bit fix, NOT a fresh-clone content change** — the index
  blobs are already LF, so `git add --renormalize` is a near-no-op; the durable change
  is the `.gitattributes eol=lf` attribute coverage + the `git update-index --chmod=+x`
  on the 3 scripts. The line-endings test must assert the INDEX (`i/lf`) to be
  non-vacuous on ext4, and be red-proven on an `autocrlf=true` checkout.
- **The `/mnt/*` FOREMAN_HOME refusal** is a behavior change — it MUST be a clear,
  actionable error (how to relocate FOREMAN_HOME) with a `FOREMAN_ALLOW_MNT_HOME=1`
  escape hatch (loud-warn) for operators who intentionally keep runs on `/mnt` for
  Windows inspection; it refuses FOREMAN_HOME only (never the worktree), and never
  fires for the Windows Git-Bash `/c/...` default (only WSL `/mnt/*`).
- **Mirrored networking is still being patched upstream (2.9.3/2.9.4)** — the preflight
  should recommend, not require, mirrored; NAT + localhostForwarding remains valid.
- **Non-root WSL Setup path (R2 item 5)** is intentionally OUT of v0.2.9 scope
  (inventoried in v0.2.7.5; a separate migration) — noted as a documented residual.

## Acceptance

A fresh `git clone` into a WSL2 distro, after `bootstrap-wsl.sh` + `foreman-setup`,
has: the POSIX launcher built and readiness-checked (pidns kill-cascade active, not
silently degraded); every tracked bash script LF (no `\r`), verified by a test;
the wsl-preflight refusing a `/mnt/*` FOREMAN_HOME and warning on stale WSL/clock;
vendor CLIs resolving WSL-native without `~/.bashrc`; CI running the bats suite +
shellcheck + launcher build on ubuntu-latest and the line-endings/shellcheck check on
windows-latest (`shell: bash`); and the seam doctrine (auth-foreground, daemon
restart-on-demand, Docker-Desktop-WSL2, exec-bit) documented and guarded. Tagged
v0.2.9.
