# Tasks — wsl-launcher-shipped

Implementer: Sonnet 5 · Audit: Opus 4.8.

- [ ] **1. Build-if-absent step** — add an idempotent
  `(cd launcher && bun run build:posix)` step to `env/bootstrap-wsl.sh`
  and/or `skills/foreman/scripts/foreman-setup.sh`: skip if
  `launcher/dist/foreman-launch` already exists and is executable; skip with
  a logged warning (not a hard failure) if `bun` is absent.
- [ ] **2. `foreman-launch` readiness entry** — add the tool entry to
  `env/reference-manifest.toml`; add a probe to `env/tool-check.sh` that, on
  `posix`/WSL hard/full profile: WHERE `bun` is present AND
  `launcher/dist/foreman-launch` is absent, reports NOT-READY naming the
  `bun run build:posix` build command; WHERE `bun` is ALSO absent (`bun` is
  only `should_full`, `env/tool-check.sh:279`, not a `must` tool), reports a
  loud DEGRADED warning instead of NOT-READY, so readiness is never
  permanently blocked on a should-tier tool.
- [ ] **3. Degraded-alert hint** — add a Setup-actionable hint (the build
  command) to the human-facing log line accompanying
  `lane-run.sh`'s `{kind:"degraded",reason:"launcher_absent"}` alert;
  verify the alert's JSON payload and control flow are byte-unchanged.
- [ ] **4. Docs** — update `docs/INSTALL.md`, the POSIX-cascade
  troubleshooting section of `docs/USAGE.md`, and `launcher/README.md` to
  state that Setup builds the launcher automatically, plus the manual
  fallback command.
- [ ] **5. Bats** — a fixture simulating a fresh WSL clone: build-if-absent
  produces the binary and is a no-op on a second run; bun-absent skips
  without failing Setup; tool-check verdict is NOT-READY when the binary is
  missing AND bun is present, and a DEGRADED warning (not NOT-READY) when
  the binary is missing AND bun is also absent; the `launcher_absent` alert
  payload is unchanged.
- [ ] **6. Verify** — `bash -n` on touched scripts; the new bats file passes
  under the mutex; `docs-check.sh`.

Acceptance: a fresh WSL clone's Setup stage builds `foreman-launch` when bun
is present, tool-check surfaces its absence loudly (never silently), the
existing degraded fallback event is untouched byte-for-byte, and docs +
bats confirm it.
