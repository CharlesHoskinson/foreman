# Vendor concurrency results (T5b)

STATUS: **verdict recorded, 2026-07-18 — NO GREEN**. This package built and
ran the destructive concurrency-matrix protocol (`vendor-concurrency-test.sh`,
`tests/vendor-concurrency-test.bats`). The AUTHENTICATED, real-quota N=2/N=3
matrix could **not** be safely executed for either codex or grok on this
host in this session (see "Task 2 execution log" below) — this is an
environment/tooling constraint, not a judgment call, and no verdict is
faked to paper over it. grok/codex pueue caps stay at **1** (default-on-
doubt); grok's default-implementer doctrine is unchanged (remains
optional). Claude Code is ruled `REQUIRES-SEPARATE-HOME` from the public
record (no local destructive run needed or attempted for Claude).

## Protocol (run manually, per vendor)

1. Cut N=2 (then N=3 if N=2 is clean) throwaway-spec lane worktrees (or, as
   implemented, throwaway per-lane workdirs via `vendor-concurrency-test.sh`
   directly) for the **same** vendor, each with its own isolated config dir
   (`GROK_HOME` / `CODEX_HOME`).
2. Seed each lane's isolated config dir from a real, already-authenticated
   copy of the vendor's config (never the live production dir itself, and
   never shared across simultaneous lanes) so the run exercises real auth
   and real shared quota, not a fresh login.
3. Run the lanes concurrently and watch the EARS abort signals: config-file
   corruption, lock-acquisition freeze (>2 min), cross-lane auth
   invalidation, 429 behavior versus the shared-quota model.
4. Repeat at N=3 only if N=2 came back clean.
5. Pueue caps (`grok`/`codex` parallel) are raised **only** on a green,
   reproducible row below. Until then, the standing doctrine (grok=1,
   codex=1) holds unconditionally.

## Harness (`vendor-concurrency-test.sh`)

`vendor-concurrency-test.sh VENDOR N` spins N same-vendor lanes, each with
its own isolated config dir (`GROK_HOME`/`CODEX_HOME`), throwaway workdir,
and **own `$HOME`** (also exported as `$USERPROFILE`, for cross-platform
CLI runtimes that resolve "home" via the Windows API rather than honoring
`$HOME`), runs them concurrently, and checks all four EARS-mandated abort
monitors before printing a verdict:

1. **Containment** — a before/after recursive snapshot of the containment
   root; any write landing outside every lane's own subtree (including via
   its `$HOME`) is a leak.
2. **Config-JSON validity** — every lane's own config dir must still parse.
3. **Lock-acquisition freeze / forced kill** — a `timeout -k`-bounded main
   task; exceeding the bound (and needing `SIGKILL`) is an abort.
4. **Cross-lane auth invalidation** — a pre/post auth re-probe per lane
   (the SAME non-billing commands `env/tool-check.sh`'s own `vendor_authed`
   uses: grok → `grok models` with its fail-closed positive-signal check;
   codex → `codex login status`); a lane authenticated before the run and
   not after is an abort.

**Rework round 1** (Opus audit, post-initial-cut): the first version shared
the real ambient `$HOME` across every lane and never re-probed auth, so
monitors 1 and 4 above were incomplete — a vendor writing `$HOME`-relative
state (exactly the shape of Claude's own `~/.claude.json`, see the Task 3
ruling below) would have been invisible to the containment scan, and a
sibling lane's auth getting invalidated by concurrent use would never have
been observed. Both are now first-class, shim-tested
(`tests/vendor-concurrency-test.bats`): a per-lane `$HOME` positive control
and an escape-via-`$HOME` negative control, and an auth-stays-valid
positive control and a shared-state auth-invalidation negative control.
This closes the harness gap **before** any future session runs it
authenticated — the outcome recorded in this document (no green, caps
unchanged) is unaffected by this rework.

## Constraints

- Destructive and real-CLI-only: this is explicitly NOT the fake-shim
  coverage in `tests/vendor-isolation.bats` or
  `tests/vendor-concurrency-test.bats` (both prove plumbing/harness LOGIC
  wires through correctly, not that isolation actually holds under a real,
  authenticated vendor process). Never run this protocol in CI or any
  automated gate.
- Both codex and grok CLIs are present and signed in on this host as of
  2026-07-18 (`codex login status` → "Logged in using ChatGPT"; `grok
  models` → "You are logged in with grok.com."; grok resolved via
  `/c/root/.local` on `PATH`). Step 2 of the protocol above (seeding an
  isolated config dir from the real, authenticated one) is what actually
  blocked the run — see below.

## Task 2 execution log (2026-07-18)

### Credential-staging blocker (both vendors — no authenticated matrix run)

Step 2 of the protocol requires copying real credential material
(`auth.json`) into each lane's isolated config dir so the run exercises
real auth and real shared quota. Two independent attempts to do this were
both denied by this host's own Claude Code auto-mode safety classifier:

1. `cp ~/.codex/auth.json <isolated-dir>/config/` (and the `~/.grok`
   equivalent) — denied outright.
2. A direct real-CLI invocation with `GROK_HOME`/`CODEX_HOME` pointed at a
   fresh directory (`grok models`, `codex login status` — the documented
   non-billing auth probes) — also denied.

No alternate lower-tier credential (an `XAI_API_KEY` / `OPENAI_API_KEY`
distinct from the interactive OAuth login) is configured in this
environment, so there was no way to give an isolated, empty config dir its
own independent authenticated identity without touching the live
credential file.

Per this task's explicit instruction ("if a vendor errors or you can't
safely run it, record the exact result — do NOT fake a verdict") and the
classifier's own guidance ("if you believe this capability is essential…
stop and explain… let the user decide how to proceed"), **the
authenticated, real-quota N=2/N=3 matrix was not executed for either
vendor** in this session. Running it for real would need either an
explicit Bash permission grant for this action pattern, or a session where
the user performs the credential staging themselves. This is recorded here
rather than silently retried or routed around.

### Auxiliary evidence collected (safe, real CLI, deliberately NOT authenticated)

As a substitute — never a replacement for the required authenticated
matrix — the REAL grok and codex binaries (not shims) were run through
`vendor-concurrency-test.sh` at N=2 and N=3, each lane given a completely
fresh, **empty, unauthenticated** config dir (no credential involved, so
no classifier objection). This exercises real containment/config-isolation
behavior under concurrency and real-CLI robustness, but it **cannot**
exercise cross-lane auth invalidation or 429-vs-shared-quota (there is no
auth, and no billed inference call ever completes) — so per EARS it does
**not** satisfy the green-verdict bar and **must not** be used to justify
any cap raise. Recorded here as supplementary evidence only.

| Run | Signals observed | Harness verdict | Notes |
|---|---|---|---|
| grok N=2, unauth | containment clean, config-JSON valid, no freeze, no rate-limit signal | GREEN (auxiliary) | both lanes: clean `{"type":"error","message":"Not signed in. ..."}`, rc=1, no billed call reached |
| grok N=3, unauth | same | GREEN (auxiliary) | same behavior, 3 lanes |
| codex N=2, unauth | containment clean, config-JSON valid, no freeze | GREEN (auxiliary) | both lanes: real `401 Unauthorized` reconnect-loop (WebSocket, then HTTPS fallback, both to `api.openai.com`), then clean exit rc=1; no crash, no hang |
| codex N=3, unauth | same | GREEN (auxiliary) | 3 lanes, same behavior |

Two genuine harness bugs were found and fixed via this real-CLI exercise
(both committed as Task 1 follow-up fixes, each with a bats regression —
see `tests/vendor-concurrency-test.bats`):

1. **False containment/JSON-corruption RED** — `vct_json_bad` passed each
   file to `jq` as a path argument. codex's own bundled-plugin cache
   (`.tmp/plugins/plugins/nvidia/skills/...`, materialized even without
   auth) nests deep enough under a long containment root to exceed
   Windows' 260-character `MAX_PATH`, so `jq.exe` failed to even open a
   perfectly valid JSON file (`jq` exit 2, "No such file or directory") —
   misreported as corruption. Fixed: `jq empty < "$f"` (stdin), never a
   path argument.
2. **False rate-limit signal** — the report-only 429 check
   bare-substring-matched `429`; a real codex `thread_id` UUID happened to
   contain the digits `9429`, a false positive. Fixed: word-bounded
   `\b429\b` (still catches genuine `status 429` / `429 Too Many
   Requests`).

## Task 3: Claude Code ruling

Claude Code is ruled **`REQUIRES-SEPARATE-HOME`** from the public issue
record — no local destructive run is needed or was attempted for Claude,
per the EARS requirement that this ruling come from the public evidence
base. `.claude.json` is written non-atomically and multiple concurrent
Claude Code instances on the same host race on it, producing truncated /
"Unexpected EOF" JSON:

- [anthropics/claude-code#28847](https://github.com/anthropics/claude-code/issues/28847) — "Race condition: .claude.json corruption when running multiple instances concurrently"
- [anthropics/claude-code#29004](https://github.com/anthropics/claude-code/issues/29004) — "Multiple Claude Code instances corrupt shared .claude.json config file on Windows"

Separately, `CLAUDE_CONFIG_DIR` does not cover top-level session state — it
does not fully substitute for a distinct `$HOME` per instance:

- [anthropics/claude-code#30230](https://github.com/anthropics/claude-code/issues/30230) — "CLAUDE_CONFIG_DIR does not replace ~/.claude — both CLAUDE.md files loaded"
- [anthropics/claude-code#15334](https://github.com/anthropics/claude-code/issues/15334) — "Feature: Support per-instance config directory for multi-agent environments" (filed as a still-open feature request, confirming the gap)

Conclusion: a safe Claude Code lane needs a genuinely distinct `$HOME` per
instance, not only `CLAUDE_CONFIG_DIR`. This ruling stands regardless of
grok/codex's own verdicts and is not gated on this host's credential-
staging blocker above (it never required a local run).

## Results

| Vendor | N | Date | Isolation clean? | Notes | Cap after |
|---|---|---|---|---|---|
| codex | 2 | 2026-07-18 | **UNVERIFIED** (authenticated run blocked) | credential-staging blocker (see above); auxiliary unauthenticated real-CLI probe GREEN, but that does not exercise auth/quota and is not a substitute | 1 (unchanged) |
| codex | 3 | 2026-07-18 | **UNVERIFIED** (authenticated run blocked) | same | 1 (unchanged) |
| grok | 2 | 2026-07-18 | **UNVERIFIED** (authenticated run blocked) | grok is signed in on this host; same credential-staging blocker applies | 1 (unchanged) |
| grok | 3 | 2026-07-18 | **UNVERIFIED** (authenticated run blocked) | same | 1 (unchanged) |
| claude | n/a | 2026-07-18 | `REQUIRES-SEPARATE-HOME` (ruled from public record, no local run) | see Task 3 above | n/a — Claude was never in the grok/codex pueue-cap conversation |

No authenticated GREEN row exists for any vendor. Per the EARS gate ("no
cap raised without a recorded green row; default-on-doubt is 1"), the
`grok`/`codex` pueue caps stay at **1**, and grok's default-implementer
doctrine is **unchanged** — it remains optional until a future session
records a genuine authenticated green row (see
`skills/foreman/references/lanes.md`). Do not raise either cap, and do not
flip the default-implementer doctrine, on the strength of the auxiliary
unauthenticated evidence above.
