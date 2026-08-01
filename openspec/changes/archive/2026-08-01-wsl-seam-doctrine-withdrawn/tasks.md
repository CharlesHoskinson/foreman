# Tasks — wsl-seam-doctrine

Implementer: Sonnet 5 · Audit: Opus 4.8.

- [ ] **1. Auth-callback doctrine** — generalize the existing codex
  operator-foreground rule (`lanes.md:97-102`,
  `reference-environment.md:84-92`) into a single vendor-agnostic statement
  covering any browser/`localhost`-callback auth flow on WSL; explicitly
  name grok `--device-code` and future vendors; note the `::1`-not-forwarded
  gotcha.
- [ ] **2. Daemon-lifecycle doctrine** — document that `systemd=true` does
  NOT keep the WSL VM alive and that `lane-queue.sh ensure`'s
  restart-on-demand respawn is the supported model on WSL; verify (not
  change) that `ensure` already respawns `pueued` correctly.
- [ ] **3. Docker doctrine** — document Docker Desktop's WSL2 backend as the
  supported/verified hard-mode container host next to
  `worker-run.sh:316`'s `require_cmd docker` check, including the
  native-`docker-ce`-on-WSL conflict warning.
- [ ] **4. `tests/exec-bit.bats`** — assert every tracked script invoked by
  direct exec (not `bash foo.sh`) is git mode `100755` or `[[ -x ]]`-guarded;
  the scan SHALL explicitly cover EXTENSIONLESS shebang scripts, not just
  `*.sh` — the class that hid the crlf-extensionless-hardening exec-bit trap
  (`skills/superpowers/skills/subagent-driven-development/scripts/
  {review-package,sdd-workspace,task-brief}`, chmod'd +x in that change) —
  so this test would have caught it; document the "call via `bash` or add
  `+x`" rule.
- [ ] **5. Platform-detection consolidation (optional)** — add the missing
  `*NT*` case arm to `lane_platform()` (`lane-run.sh:129-134`) to match
  `lib/launch.sh:30` and `worker-run.sh:296`, OR extract one shared
  `platform()` helper for all three call sites.
- [ ] **6. Live WSL verification** — kill `pueued` on the WSL2 host, run a
  lane, confirm `lane-queue.sh ensure` respawns it; paste evidence.
- [ ] **7. Verify** — `bash -n`; `tests/exec-bit.bats` passes under the
  mutex; existing bats suite unaffected by the platform-detection change (if
  made); `docs-check.sh`.

Acceptance: auth-callback, daemon-lifecycle, and Docker doctrine documented
uniformly and vendor-agnostically; `tests/exec-bit.bats` guards every
directly-exec'd script, including extensionless shebang scripts;
`lane_platform()`'s `*NT*` drift is closed (or a shared helper is
extracted); live respawn evidence attached.
