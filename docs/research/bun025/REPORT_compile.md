# REPORT_compile — Lane B: `bun build --compile` for foreman-launch (Windows)

VERDICT: **GO-WITH-CAUTIONS** — ship foreman-launch as a `bun build --compile` Windows x64 exe. The critical path (bun:ffi dlopen of SYSTEM DLLs inside a compiled binary) was **verified live on this machine with Bun 1.3.14** and works. Cautions: ~94 MB binary, non-reproducible bit-for-bit builds, unsigned-exe SmartScreen friction, and pin Bun exactly to 1.3.14+ (post-Rust-rewrite fixes).

Research date: 2026-07-16. Latest stable Bun: **v1.3.14 (released 2026-07-08)** [https://bun.com/blog/bun-v1.3.14, accessed 2026-07-16].

---

## 1. Current `--compile` capabilities

Source: [https://bun.com/docs/bundler/executables, accessed 2026-07-16]

- **Targets**: `bun-windows-x64` (+ `-baseline`/`-modern` CPU variants), **Windows ARM64**, `bun-linux-x64/arm64` (+musl), `bun-darwin-x64/arm64`. v1.3.14 also added FreeBSD/Android builds of Bun itself.
- **Cross-compilation**: fully supported in both directions via `--target=` — you can build Windows exes from Linux/macOS CI and Linux binaries from Windows. Verified compile-on-Windows-for-Windows locally.
- **Binary size**: **93.9 MB measured** for a trivial FFI script with `--minify`, Bun 1.3.14, windows-x64 (local experiment). Docs/community reports cite ~100–105 MB previously; v1.3.14 shrank windows-x64 by 17.66 MB [https://bun.com/blog/bun-v1.3.14]. A minimal-runtime option is a long-standing OPEN request: #14546 (https://github.com/oven-sh/bun/issues/14546) — do not expect a small exe.
- **Startup latency**: **measured 47–70 ms** total process lifetime for the compiled test exe on this machine (Windows 11, warm: 47 ms). `--bytecode` skips parse work for faster startup ("2x" claim for large inputs, docs) but see risk R4 on cross-compiled bytecode.
- **Options**: `--minify`, `--sourcemap` (embedded, compressed), `--bytecode`, `--windows-icon=...`, `--windows-hide-console`, `--windows-title/-publisher/-version/-description/-copyright`, `--compile-exec-argv="..."` (bakes `process.execArgv`, e.g. `--smol`), `--compile-autoload-*` toggles for runtime `.env`/`bunfig.toml` loading.
- **Embedding files**: `import x from "./f" with { type: "file" }` -> exposed under `/$bunfs/`; `Bun.embeddedFiles`; SQLite `embed: "true"`; `.node` addons supported. `Bun.isStandaloneExecutable` exists in docs, but **returned undefined in my 1.3.14 test** (UNVERIFIED whether renamed/not-yet-shipped — use a `Bun.main.includes("$bunfs")` fallback).
- Not supported with `--compile`: `--outdir`, `--public-path`, `--target=node`, `--no-bundle`.

## 2. CRITICAL — bun:ffi dlopen of system DLLs inside a compiled binary: **WORKS (verified locally)**

Live experiment on this machine, 2026-07-16, Bun v1.3.14 stable (downloaded from GitHub releases):

- Script dlopen-ed `C:\Windows\System32\kernel32.dll` (absolute path) and `user32.dll` (bare name) via `bun:ffi`, called `GetTickCount64`, `GetCurrentProcessId`, `GetSystemMetrics`; compiled with `bun build --compile --minify --target=bun-windows-x64`; the resulting exe printed correct values and `FFI_OK`. This is exactly foreman-launch's use case (system DLLs only).
- The scary search hits concern a *different* path — dlopen of a **bundled/embedded** (`/$bunfs/...`) library: #30717 (https://github.com/oven-sh/bun/issues/30717, regression from the Rust rewrite that broke 1.3.14-canary; **CLOSED**, fixed by PR #30720 https://github.com/oven-sh/bun/pull/30720, merged 2026-05-15, before the 1.3.14 stable cut of 2026-07-08). #30717's own analysis confirms dlopen of pre-existing on-disk/system paths (`libc.so.6` etc.) was never affected. Related historical: #11598 (closed via same PR), #5680 (2023 "bun:ffi can't be bundled" — closed; affected plain `bun build` without `--compile`).
- UNVERIFIED corner: whether stable 1.3.14 contains PR #30720 (dates strongly imply yes; irrelevant for us since we don't embed DLLs, and my system-DLL test passed on stable 1.3.14 anyway).

**Conclusion: system-DLL FFI inside `--compile` output is production-usable today.**

## 3. Code signing (Windows Authenticode)

- **Fixed since Bun v1.2.23**: Bun strips its original signature from the compiled exe so you can Authenticode-sign it post-build with standard `signtool.exe` [https://bun.com/blog/bun-v1.2.23, accessed 2026-07-16]. Signing is **post-build via signtool**, not built into `bun build`.
- The two "signing breaks the exe" issues are both **CLOSED 2025-09-27** (checked via GitHub API 2026-07-16): #20109 (https://github.com/oven-sh/bun/issues/20109), #10574 (https://github.com/oven-sh/bun/issues/10574).
- macOS: `codesign --deep --force` with JIT entitlements documented [https://bun.com/docs/bundler/executables]. macOS truncated-signature bug #29120 existed in 1.3.12 (not our platform).
- **Defender/SmartScreen track record**: Bun itself was flagged as a trojan (#16981 https://github.com/oven-sh/bun/issues/16981, closed 2026-02-11); large unsigned bun-compiled exes have a known false-positive/SmartScreen-friction history typical of unsigned, low-reputation binaries. My unsigned test exe ran without Defender interference on this Windows 11 machine (anecdotal, n=1). Mitigation: Authenticode-sign with a timestamp; reputation accrues per-cert. [https://textslashplain.com/2026/01/27/microsoft-defender-false-positives/, accessed 2026-07-16]

## 4. Version pinning / reproducibility

- The compiled exe **embeds the entire Bun runtime of the compiling Bun**; `Bun.version` inside my compiled exe reported `1.3.14` (verified). Runtime behavior is frozen at build time.
- **Pinning**: `.bun-version` file and/or `"packageManager": "bun@1.3.14"` in package.json — both honored by `oven-sh/setup-bun` in CI [https://github.com/oven-sh/setup-bun, accessed 2026-07-16]. Commit `bun.lock` and use `bun ci` / `--frozen-lockfile` [https://bun.com/docs/pm/cli/install].
- **Bit-for-bit reproducibility: NO (verified)** — two back-to-back identical builds on this machine produced different SHA256 hashes (75673CF7... vs CB3D2E3D...). No official determinism guarantee exists. Two developers will NOT produce identical binaries. Practice: build once in CI, publish the artifact + hash; treat the CI artifact as canonical.

## 5. Runtime flags / memory footprint (measured, Bun 1.3.14, Win11)

- `.env` + `bunfig.toml` still load at runtime by default (deployment config); disable with `--no-compile-autoload-dotenv` / `--no-compile-autoload-bunfig` for determinism. `BUN_OPTIONS` env var injects runtime flags into a compiled exe post-ship; `--compile-exec-argv="--smol"` bakes flags in. [https://bun.com/docs/bundler/executables]
- **RSS ballpark for a tiny always-running supervisor**: **~46–49 MB measured** (idle exe with a timer loop: 46.5 MB; with `BUN_OPTIONS=--smol`: 45.7 MB — `--smol` mainly slows heap *growth*, barely changes the floor). Caution: #21560 (https://github.com/oven-sh/bun/issues/21560) reports slow idle RSS drift over hours in some spawn scenarios — worth a 24 h soak test for a 24/7 supervisor.
- Startup: 47–70 ms measured (above).

## 6. Known open blockers (Windows + `--compile`), statuses checked via GitHub API 2026-07-16

| Issue | Title | Status / note |
|---|---|---|
| #19916 | `--windows-icon` / `--windows-hide-console` not working on Win11 | OPEN — cosmetic; relevant if launcher must be windowless |
| #20013 | Import of dynamically created scripts fails in single-file exe on Windows | OPEN — avoid dynamic `import()` of generated files |
| #12970 | Compiled exe strips `\\` from an env var on Windows | OPEN — relevant for path-bearing env vars |
| #18193 | Symlink to compiled exe fails to run on Windows | OPEN — install a real file, not a symlink |
| #18416 | Cross-compiled `--bytecode` exes segfault on target OS | OPEN — use `--bytecode` only when host==target (or skip it) |
| #14546 | Minimal runtime for smaller binaries | OPEN — ~94 MB floor stands |
| #12623 | Some compiled Windows builds cannot execute | OPEN (edge cases) |
| #17406 | Standalone Windows exe crashes intermittently with `--env=inline` | avoid `--env=inline` |

Closed/fixed (context): #20109/#10574 signing (fixed v1.2.23, closed 2025-09-27), #30717/#11598 embedded-FFI dlopen (PR #30720), #16981 Defender-trojan on bun.exe (closed 2026-02-11).

## RISKS (ranked)

1. **R1 — SmartScreen/AV friction on unsigned exe** (likelihood high, impact medium): unsigned ~94 MB novel exe will trip SmartScreen on end-user machines. Mitigate: Authenticode sign + RFC3161 timestamp (works since v1.2.23).
2. **R2 — Bun version drift** (medium/medium): behavior is baked at compile time; a `bun upgrade` on a dev machine silently changes the shipped runtime. Mitigate: pin via `.bun-version` + `packageManager` + CI-only builds.
3. **R3 — non-reproducible builds** (certain/low-medium): cannot diff-verify two builds. Mitigate: single CI build artifact + published SHA256.
4. **R4 — `--bytecode` cross-compile segfault (#18416)** (medium if used / high impact): build for Windows ON Windows CI, or drop `--bytecode` (launcher is tiny; parse time negligible).
5. **R5 — Windows cosmetic flags broken (#19916)** (medium/low): hidden-console/icon may not apply; verify on Win11, fall back to a tiny shim or shortcut settings.
6. **R6 — idle RSS drift (#21560)** (low/medium for a 24/7 supervisor): soak-test 24 h; ~46 MB floor is the expected baseline either way.

## Build recipe (windows-x64)

```powershell
# Pin: .bun-version -> 1.3.14 ; package.json -> "packageManager": "bun@1.3.14"
bun ci   # frozen lockfile

# Build (on Windows CI; add --bytecode ONLY when host==target, see #18416)
bun build --compile --minify --sourcemap `
  --target=bun-windows-x64 `
  --compile-exec-argv="--smol" `
  --windows-title="Foreman Launch" --windows-publisher="<org>" `
  --windows-version="0.2.5" --windows-icon=./assets/foreman.ico `
  ./src/launch.ts --outfile dist/foreman-launch.exe

# Sign (post-build; supported since Bun v1.2.23)
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 `
  /f cert.pfx /p $env:SIGN_PASS dist/foreman-launch.exe
signtool verify /pa dist/foreman-launch.exe

# Publish artifact + hash (builds are NOT bit-reproducible)
Get-FileHash dist/foreman-launch.exe
```

Smoke test to keep in CI (verified locally 2026-07-16): compiled exe dlopens `kernel32.dll` + `user32.dll` via bun:ffi, calls `GetTickCount64`/`GetSystemMetrics`, prints `FFI_OK`; assert exit 0.
