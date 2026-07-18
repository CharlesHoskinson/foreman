# Empirical non-billing auth-probe commands (Task 0)

Determined empirically on this host (2026-07-18) by reading each CLI's own
`--help` tree and, where safe, exercising both the real signed-in state and a
simulated signed-out state via an isolated, empty vendor-home override
(`GROK_HOME`/`CODEX_HOME`/`CLAUDE_CONFIG_DIR` — the same three env vars
`lane-run.sh`'s `lane_vendor_env_var` already maps per vendor for T5a). The
override directories are throwaway temp dirs; the real `~/.grok`, `~/.codex`,
and Claude's real config were never touched, so the host's actual signed-in
state (grok, codex, and claude are all signed in here) is preserved
end-to-end. None of the three commands below ever invokes `-p`/`exec`/a
model turn — no billed inference occurs.

## grok — `grok models`

No `whoami`/`auth status` subcommand exists in `grok --help`'s command list
(`agent, completions, dashboard, export, help, inspect, leader, login,
logout, mcp, memory, models, plugin, sessions, setup, trace, update,
version, worktree, wrap`). `grok inspect --json` (config diagnostics) was
also checked and carries no auth field at all — not usable.

`grok models` ("List available models and exit") turned out to be the
CLI's own auth-status surface: it prints an explicit login-state banner
before the model list and **always exits 0** regardless of auth state — the
signal is in stdout text, not the exit code. Verified against the real
signed-in grok, then against grok pointed at an empty `GROK_HOME` (a fresh,
unauthenticated install, simulated non-destructively):

- Signed in (real `~/.grok`, exit 0, ~0.8s):
  ```
  You are logged in with grok.com.

  Default model: grok-4.5

  Available models:
    * grok-4.5 (default)
  ```
- Signed out (`GROK_HOME=<empty temp dir>`, exit 0, ~2.6s):
  ```
  You are not authenticated.

  Default model: grok-build

  Available models:
  ```

**Chosen probe (Rework Round 1, Opus audit — corrected):** run
`timeout 10 grok models` (bounded — see below), capture stdout+stderr, and
require ALL of: exit 0, non-empty output, the literal substring `logged in`
present (the positive signed-in signal, from the transcript above), AND
NONE of `not authenticated` / `sign in` / `log in` present. This replaces
the original Task 0 design (`[[ "$out" != *"not authenticated"* ]]` —
"absence of the negative string alone means authenticated"), which was
**fail-OPEN**: any output that happened not to contain the exact phrase
`not authenticated` — an unrelated error banner, a future grok version's
reworded message, a truncated/garbled capture — would have read as
authenticated, i.e. READY, which is precisely the mid-round auth failure
this whole gate exists to prevent. The corrected logic is fail-CLOSED: only
a recognized positive signal, with no negative wording present, counts as
authenticated; every other case (ambiguous banner, empty output, nonzero
exit, timeout) returns not-authenticated. Verified against a shim that
prints an unrelated error ("ERROR: something went wrong, please retry",
exit 0) — the corrected probe returns not-authenticated (rc=1); the
original probe would have returned authenticated (rc=0).

**Hang risk (Rework Round 1, Opus audit — corrected):** `grok models`
round-trips to a remote model-list endpoint with no bound of its own, and
this probe now runs on tool-check's default path AND inside every lane-run
Use-path readiness gate (Task 5) — a network stall there would hang Setup
and Use. Fixed by wrapping the call in `timeout 10` (`gtimeout 10` if only
that is present; if neither is resolvable, the probe refuses to make the
unbounded call at all and reports not-authenticated — fail closed rather
than risk a hang). Verified against a shim `grok` that `sleep 60`s
unconditionally: the wrapped probe returns not-authenticated after ~10s
(bounded), not after 60s.

This still deviates from the plan's illustrative `vendor_authed` template
(a bare `grok <SUBCMD> >/dev/null 2>&1` exit-code check) because grok's own
exit code never distinguishes signed-in from signed-out (confirmed above:
both cases exit 0) — see `env/tool-check.sh`'s `vendor_authed` for the
actual bounded, fail-closed implementation. Known limitation: this call
round-trips to a remote model-list endpoint (not a model turn, not billed,
but it does need network, now bounded to 10s) — acceptable since a
signed-in-checkable grok already implies network is expected to be
reachable for real use.

## codex — `codex login status`

`codex --help` lists `login` (Manage login) as a subcommand group;
`codex login --help` shows a `status` sub-subcommand ("Show login status").
Clean exit-code signal, verified both ways:

- Signed in (real `~/.codex`, exit 0):
  ```
  Logged in using ChatGPT
  ```
- Signed out (`CODEX_HOME=<empty temp dir>`, exit 1):
  ```
  WARNING: proceeding, even though we could not create PATH aliases: Refusing to create helper binaries under temporary dir ... (codex_home: ...)
  Not logged in
  ```

**Chosen probe:** `codex login status >/dev/null 2>&1` — exit 0
authenticated, nonzero not authenticated. Matches the plan's
`vendor_authed` template as-is.

## claude — `claude auth status`

`claude --help` lists `auth` (Manage authentication) as a subcommand group;
`claude auth --help` shows `status` ("Show authentication status"). Clean
exit-code signal, verified both ways:

- Signed in (real Claude config, exit 0):
  ```json
  {
    "loggedIn": true,
    "authMethod": "claude.ai",
    "apiProvider": "firstParty",
    "email": "charles.hoskinson@gmail.com",
    "orgId": "1f752646-2266-47cd-ac68-475341c9b08d",
    "orgName": "charles.hoskinson@gmail.com's Organization",
    "subscriptionType": "max"
  }
  ```
- Signed out (`CLAUDE_CONFIG_DIR=<empty temp dir>`, exit 1):
  ```json
  {
    "loggedIn": false,
    "authMethod": "none",
    "apiProvider": "firstParty"
  }
  ```

**Chosen probe:** `claude auth status >/dev/null 2>&1` — exit 0
authenticated, nonzero not authenticated. Matches the plan's
`vendor_authed` template as-is.

## Summary table

| vendor | probe command | signal | matches plan template |
|---|---|---|---|
| grok | `grok models` | stdout NOT containing `not authenticated` | no — grok's own exit code never distinguishes; grep-on-output required |
| codex | `codex login status` | exit code | yes |
| claude | `claude auth status` | exit code | yes |

`grok -p`/`grok agent` were never invoked at any point during this probe
(the forbidden billed-inference path).
