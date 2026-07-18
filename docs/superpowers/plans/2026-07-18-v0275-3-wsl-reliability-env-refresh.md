# wsl-reliability-env-refresh Implementation Plan (v0.2.7.5 · package 3/7)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> or superpowers:executing-plans. **Implementer: Sonnet 5. Auditor: Opus 4.8.**
> EARS: `openspec/changes/wsl-reliability-env-refresh/specs/environment/spec.md`.
> Much of this is host/WSL config — verify by RE-PROBE and paste evidence in
> the change's FOREMAN_REPORT; not everything is bats-testable.

**Goal:** Make WSL a co-equal, fully-provisioned foreman environment (the
three stages run there identically to Windows), fix two live bugs, tune
`.wslconfig`, add a clock-sync hook, and reconcile dependency versions.

**Architecture:** `env/bootstrap-wsl.sh` becomes a complete native provisioner;
`.wslconfig`/`wsl.conf` are tuned; `env/reference-manifest.toml` is truthed-up;
a resume clock-sync hook protects the event log. Bun held at 1.3.14 (1.4
canary). Root→non-root migration is INVENTORIED only.

**Tech Stack:** bash, WSL2 Ubuntu-26.04, fnm, winget/apt, `wsl.exe`,
`env/tool-check.sh` (package 1's readiness verdict).

## Global constraints

Strict mode + portability checklist + gate mutex per bats run. Host/WSL edits
must be RE-PROBED after applying (paste `--version`/`mount`/`wsl --status`
output). Do not flip the WSL default user. Bun stays 1.3.14.

## File structure

- Modify `env/bootstrap-wsl.sh` — full native provisioner.
- Modify `C:\Users\charl\.wslconfig` — tuning (mirrored net, autoMemoryReclaim,
  sparseVhd, processors→20).
- Modify `/etc/wsl.conf` (WSL) — `appendWindowsPath=false`.
- Modify `env/reference-manifest.toml` + `env/tool-check.sh` — truth-up.
- Create a resume clock-sync hook artifact + a lane-start preflight guard.
- Modify `skills/foreman/references/reference-environment.md` — doctrine +
  migration inventory.

---

### Task 1: full WSL native provisioner (bootstrap-wsl.sh)

- [ ] **Step 1** — Extend `env/bootstrap-wsl.sh` to install WSL-native:
  bats-core (git clone into `$HOME/.foreman/tools/bats-core`), shellcheck
  (`apt-get install shellcheck`), bun (`curl -fsSL https://bun.sh/install |
  bash -s "bun-v1.3.14"`), pueue (GitHub release binary), codex + grok
  (npm-native inside WSL), node/npm via fnm, jq. Each install idempotent
  (skip-if-present).
- [ ] **Step 2 (proof, not bats)** — In WSL: run `bash env/bootstrap-wsl.sh
  --profile full` then `bash env/tool-check.sh --profile full`; assert
  `READY: yes` (or the package-1 verdict READY) with bats + shellcheck +
  codex resolving WSL-native. Paste the transcript.
- [ ] **Step 3** — A minimal Setup→trivial-Use→Cleanup pass runs entirely
  inside WSL invoking no Windows-side tool (paste evidence).
- [ ] **Step 4: Commit** `git commit -m "feat(wsl): bootstrap-wsl full native provisioner"`.

---

### Task 2: fix the WSL codex PATH-leak (live bug)

- [ ] **Step 1 (proof)** — Confirm the bug: `wsl codex --version` currently
  resolves the Windows npm shim and errors "Missing optional dependency
  @openai/codex-linux-x64" (paste).
- [ ] **Step 2** — Set `appendWindowsPath=false` in the foreman WSL distro's
  `/etc/wsl.conf` `[interop]` (or reorder PATH in the foreman WSL profile so
  the native codex wins); ensure Task 1 installed codex WSL-native. Document
  any Windows tool the WSL path must retain.
- [ ] **Step 3 (proof)** — `wsl --shutdown` then `wsl codex --version` prints a
  version, exit 0 (paste before/after).
- [ ] **Step 4: Commit** `git commit -m "fix(wsl): codex resolves native, not the Windows shim (appendWindowsPath=false)"`.

---

### Task 3: .wslconfig tuning

- [ ] **Step 1** — Add to `.wslconfig`: `networkingMode=mirrored`,
  `dnsTunneling=true`, `autoMemoryReclaim=gradual`, `sparseVhd=true`; change
  `processors=24`→`20` (reserve host headroom — the wall-clock-flake class);
  keep `memory=64GB`. Do NOT enable virtiofs (still buggy).
- [ ] **Step 2 (proof)** — `wsl --shutdown`; re-probe `wsl.exe --status`,
  `cat /etc/resolv.conf` (mirrored → no NAT nameserver), `nproc` inside WSL.
- [ ] **Step 3: Commit** `git commit -m "chore(wsl): .wslconfig agent-host tuning; processors 24->20"`.

---

### Task 4: clock-sync hook (protects the event log)

- [ ] **Step 1: Write the failing test** — a lane-start preflight
  (`scripts/wsl-clock-preflight.sh` or a check inside foreman-setup) SHALL,
  when WSL time differs from host time beyond a threshold, re-sync (or refuse +
  alert) before any timestamped event is written. Test by mocking a skewed
  clock reading and asserting the re-sync/refuse path fires.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3** — Implement the preflight + a resume-triggered `hwclock -s`
  hook (a Windows Scheduled Task template + a documented install step).
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** `git commit -m "feat(wsl): sleep-resume clock-sync hook + lane-start drift preflight"`.

---

### Task 5: manifest + dependency reconciliation

- [ ] **Step 1** — Correct `env/reference-manifest.toml` so every entry
  reflects a probe-verified reality (shellcheck now present, grok npm install,
  WSL bats present) with a probe-verified date. Apply the dependency table:
  hold Bun 1.3.14; hold pueue/jq/python3/lychee/codespell/markdownlint;
  upgrade gh (security) + WSL docker (minor); reprovision WSL node/npm via fnm.
- [ ] **Step 2 (proof)** — `tool-check --profile full` on BOTH sides; paste;
  assert no claimed-but-absent tool remains.
- [ ] **Step 3: docs-check + Commit** `git commit -m "chore(env): manifest reconciled to probe-verified reality; deps refreshed"`.

---

### Task 6: root→non-root migration inventory (inventory only)

- [ ] **Step 1** — Enumerate every `/root/...`-hardcoded path + root-owned
  install a non-root migration would break; document in
  `references/reference-environment.md` as a follow-up change. Do NOT flip
  `[user] default=`.
- [ ] **Step 2: docs-check + Commit** `git commit -m "docs(wsl): root->non-root migration inventory (deferred)"`.

## Self-review

- Coverage: R(full WSL)→T1; R(codex fix)→T2; R(.wslconfig)→T3; R(clock)→T4;
  R(shellcheck/bats/deps)→T1,T5; R(migration inventory)→T6. All covered.
- Non-bats tasks are proof-by-probe with pasted evidence (stated up front).
- Bun explicitly HELD at 1.3.14 in T5.

## Acceptance

WSL fully provisions + reports READY; codex live bug fixed; `.wslconfig` +
manifest reconciled; clock-sync hook present; migration inventoried not
executed; probes pasted; suite + docs-check green. Archive on ship.
