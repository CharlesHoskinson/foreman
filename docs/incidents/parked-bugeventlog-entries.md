
## 2026-07-29 — Setup gate told the operator to re-login to a vendor that was authenticated

- **Phase:** Foreman Setup stage, `foreman-setup.sh --profile soft`, before an S1
  implement round.
- **What happened:** Setup printed `grok not_authenticated (run: grok login
  --device-code)`, `MUST_FAIL: grok:not_authenticated`, `SETUP: NOT-READY`, and
  blocked the round. `grok -p "reply with the single word READY"` answered
  `READY` immediately afterward, and `grok models` returned exit 0 with the
  signed-in banner in 2.4 s.
- **Evidence:** probe timed three consecutive runs at 2412 / 2411 / 2410 ms
  against the shipped 10 s bound, and once more from `/root/foreman` at 2311 ms,
  all rc=0. `grok models` output begins `You are logged in with grok.com.`, so
  the positive signal the checker requires was present when re-measured. Two
  interactive `codex` sessions (started 07:52 and 08:04) were saturating the box
  at the time of the failing run.
- **Root cause:** `env/tool-check.sh`'s `vendor_authed` grok branch is
  two-state. `out="$("$tmo" 10 grok models 2>&1)" || rc=$?` followed by
  `(( rc != 0 )) && return 1`, under a comment that states the intent outright:
  *"Timeout (rc=124) or any other nonzero exit: never authenticated."* Four
  distinct world-states — genuinely signed out, bound expired, leader-socket or
  network failure, and output matching neither signal — all map onto the single
  answer `not_authenticated`. Only the first is fixed by the login instruction
  the caller then prints.
- **Impact:** medium. A working vendor lane was gated off and the operator was
  handed a remediation that could not fix the actual condition. The failure is
  loud rather than silent, so no work was lost — but it is *fail-closed with a
  wrong diagnosis*, which costs an operator a re-authentication cycle chasing a
  cause that was not there. Worse, the same shape would report a genuinely
  signed-out vendor identically, so the message carries no information.
- **The class:** this is the release's own checker-soundness thesis appearing in
  the Setup stage — a checker that cannot distinguish *disproved* from *could
  not be determined* reports the wrong one, loudly. It is structurally identical
  to the distinction `lock-primitive-hardening` draws between
  `FM_LOCK_NO_ATOMIC_PRIMITIVE` (a trusted verdict exists and is negative) and
  `FM_LOCK_PROBE_UNTRUSTED` (no trusted verdict exists). That spec is explicit
  that offering the implementer a choice between the two was itself the defect;
  `vendor_authed` has the second state missing entirely.
- **Second finding, from the same investigation:** there is no uniform vendor
  auth contract, so one predicate cannot serve four lanes. `claude auth status`
  emits JSON carrying `loggedIn`; `codex login status` gives exit 0 plus prose;
  `grok` publishes only `login`/`logout`/`update`/`version` and ships no status
  verb at all; `agy` signs in silently from the OS keyring and exposes
  disconnect only as an in-session `/logout` slash command. Verified per CLI on
  this host and against each vendor's published documentation.
- **Third finding — a live hazard, not just a gap:** `claude update` is
  documented as *"Check for updates and install if available"* and has no
  dry-run; `codex update` exposes only `--enable`/`--disable`/`--config`. A
  preflight that called them to answer "are we current?" would upgrade a vendor
  CLI underneath a running release gate, after that gate's evidence was
  collected. Only `grok update --check --json` is non-mutating.
- **Enhancement:** `openspec/changes/vendor-preflight/` (authored 2026-07-29,
  validates strict, slotted first in S5 ahead of `agy-lane-activation`). Reports
  discoverable / authenticated / current as three independent facts each with an
  evidence class; makes the auth fact three-state with `unknown` never rendered
  as a login instruction; declares per-vendor evidence class (`declared` where a
  status verb exists, `probed` where it does not); decides currency by comparing
  against a version floor pinned in `env/reference-manifest.toml` and forbids
  invoking any mutating `update` verb, with a static check so a later edit
  cannot reintroduce one; and requires every reportable state to be demonstrated
  reachable against a stub CLI before the gate trusts it — this defect was a
  checker nobody had watched fail correctly.
