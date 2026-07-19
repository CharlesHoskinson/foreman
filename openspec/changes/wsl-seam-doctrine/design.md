# Design — wsl-seam-doctrine

Parent design: `docs/superpowers/specs/2026-07-19-v029-wsl-compat-design.md`
(package P6).

## Citations (load-bearing)

- **Codex auth doctrine (already correct, the pattern to generalize):**
  `skills/foreman/references/lanes.md:97-102` — `codex login --device-auth`
  falls back to a `localhost:1455` browser callback whose local server dies
  the moment the launching shell detaches, so it must be operator-run in a
  persistent foreground shell (`! codex login`), never
  orchestrator-launched-and-detached.
  `skills/foreman/references/reference-environment.md:84-92` repeats this
  for the v0.2.8.1 headless-vs-interactive doctrine.
- **Grok's device-code flow (currently documented as browser-free, but
  in-scope for the uniform rule):**
  `skills/foreman/scripts/foreman-setup.sh:65` (`grok login --device-code`);
  `skills/foreman/references/lanes.md:61-66` — "Auth doctrine: grok
  authentication is a Setup-stage responsibility... `grok login
  --device-code` (browser-free; alias of `--device-auth`)". The parent
  design's P6 bullet explicitly says "extend to grok `--device-code` and any
  future vendor" — i.e. state the rule once, vendor-agnostically, so it
  automatically covers grok (or any vendor) if/when its auth flow gains a
  browser/localhost-callback shape, rather than re-deriving the doctrine
  per vendor after the fact.
- **`::1` gotcha (SOTA, R2/R3):** `localhostForwarding` (default true) makes
  a NAT-mode callback reachable, but `::1` is NOT forwarded — only IPv4
  `127.0.0.1` binds work across the boundary.
- **Daemon lifecycle (R3):** `systemd=true` does NOT keep the WSL VM alive.
  `skills/foreman/scripts/lane-queue.sh`'s `ensure` subcommand (around
  lines 372-392, `cmd_ensure`) already resolves `pueued` and spawns it
  on-demand if not running — this is the mechanism that must be documented
  as the supported restart-on-demand model, not a persistent daemon.
- **Docker doctrine:** `skills/foreman/scripts/worker-run.sh:316`
  (`require_cmd docker "hard mode container profile requires Docker
  Desktop/WSL2"`) is the existing detection point; doctrine should state
  Docker Desktop's WSL2 backend as the supported/verified container host and
  warn against a native `docker-ce` install on WSL (which Docker Desktop's
  own docs warn conflicts with the Desktop-managed daemon).
- **Exec-bit trap (internal, confirmed live):** `git ls-files -s` shows all
  445 tracked files at git mode `100644` — none are `100755`. This is
  harmless only because every script is invoked `bash foo.sh` and
  `install.sh:62-63`'s chmod is a narrow glob (`chmod +x
  "$SKILL_SRC/scripts/"*.sh`, `chmod +x "$SKILL_SRC/scripts/lib/"*.sh`) that
  happens to cover today's scripts but would silently miss a new
  directly-exec'd script.
- **Platform-detection drift (confirmed live via grep):** three `case
  "$(uname -s)"` sites exist. `skills/foreman/scripts/lane-run.sh:129-134`'s
  `lane_platform()` case arms are `MINGW*|MSYS*|CYGWIN*` only (no `*NT*`).
  `skills/foreman/scripts/lib/launch.sh:30` and
  `skills/foreman/scripts/worker-run.sh:296` both already include `*NT*` in
  their case arms — confirming `lane_platform()` is the one site with the
  drift, not a repo-wide inconsistency.

## Approach

This package is mostly doctrine (documentation), a small optional code
consolidation, and one new guard test:

1. **Auth-callback doctrine, generalized.** Add a vendor-agnostic statement
   to `lanes.md`/`reference-environment.md`: any browser/`localhost`-callback
   auth flow on WSL SHALL run operator-foreground, never
   orchestrator-detached — stated as the general rule the existing codex
   text is an instance of, and explicitly naming grok `--device-code` (and
   "any future vendor") as covered, plus the `::1`-not-forwarded gotcha.
   No code changes: codex's flow is already correct; grok's is currently
   browser-free per existing doctrine, so this is forward-covering
   documentation, not a behavior change.
2. **Daemon-lifecycle doctrine.** Document, next to `lane-queue.sh`'s
   `ensure` subcommand and in the relevant reference doc, that
   `systemd=true` does not keep the WSL VM alive and that
   restart-on-demand (via `ensure`) is the supported model — verify this
   path already works (it should, since `ensure` already re-spawns
   unconditionally when the daemon isn't reachable) rather than change it.
3. **Docker doctrine.** Document Docker Desktop's WSL2 backend as the
   supported/verified container host next to `worker-run.sh`'s
   `require_cmd docker` check, including the native-`docker-ce` conflict
   warning.
4. **Exec-bit guard.** New `tests/exec-bit.bats`: enumerate every tracked
   script that is invoked by direct exec elsewhere in the codebase (as
   opposed to `bash foo.sh`), and assert each is either git mode `100755` or
   guarded by an `[[ -x ]]` check before exec. Document the "call via `bash`
   or add `+x`" rule so new scripts don't reintroduce the trap.
5. **Platform-detection consolidation (optional, low-risk).** Either add the
   missing `*NT*` arm to `lane_platform()` (`lane-run.sh:129-134`) to match
   the other two call sites, or extract one shared `platform()` helper all
   three call sites use. The implementer picks whichever is lower-diff;
   the parent design explicitly marks this sub-item optional.

## Key decision

Treat this package as doctrine-first: three of its four sub-areas (auth
callbacks, daemon lifecycle, Docker) require no code changes because the
underlying mechanisms (codex's operator-foreground flow, `lane-queue.sh
ensure`'s respawn, `worker-run.sh`'s docker detection) are already correct —
the gap is that the doctrine was never written down as a uniform,
vendor-agnostic rule. Only the exec-bit guard (new test) and the optional
platform-detection consolidation touch code.

## Verification

`tests/exec-bit.bats` is the executable proof for the exec-bit sub-area,
run against the full tracked-file set. The doctrine additions are verified
by review (they are documentation), and, per the parent design's testing
bias, the daemon-lifecycle restart-on-demand claim is re-confirmed live on
the WSL2 host (kill `pueued`, run a lane, confirm `ensure` respawns it).
