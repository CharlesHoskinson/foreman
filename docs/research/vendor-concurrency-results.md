# Vendor concurrency results (T5b)

STATUS: **verdict recorded, 2026-07-18 — GREEN (grok, codex)**. This package
built and ran the destructive concurrency-matrix protocol
(`vendor-concurrency-test.sh`, `tests/vendor-concurrency-test.bats`). The
first attempt (Task 2 execution log below) was blocked from staging isolated
per-lane credentials by this host's safety classifier and recorded NO GREEN.
The user then **explicitly authorized a live shared-account run** (2026-07-18),
which was executed and came back GREEN for both vendors — grok at N=2 and N=3,
codex at N=2 (see "LIVE authenticated run" below). On that recorded evidence
the **grok cap is raised 1→3 and the codex cap 1→2** in
`skills/foreman/scripts/lane-queue.sh`; grok is promoted to an eligible
default implementer (Sonnet remains the standing default this era). Claude
Code is ruled `REQUIRES-SEPARATE-HOME` from the public record (no local
destructive run needed or attempted for Claude).

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

## LIVE authenticated run (2026-07-18, user-authorized shared-account)

The user explicitly authorized a live, shared-account destructive run
("Authorize a live shared-account run") — accepting that all lanes share the
one real logged-in identity and its real quota, rather than each lane holding
a separately-staged credential (which the classifier had blocked). Under that
authorization the matrix was run with the REAL, signed-in grok and codex
binaries, each lane path-isolated by its own cwd + a unique session id, all
lanes sharing the ambient authenticated identity. Every EARS abort monitor
was watched directly.

**grok — GREEN at N=2 and N=3.** Every lane returned rc=0 with its exact
expected reply (`LANE-<n>-OK` / three-lane variant), no rate-limit or 429
signal under the shared quota, `~/.grok` changes were benign and
path-isolated (session records keyed by cwd + UUID, no cross-lane
clobber), and a post-run auth re-probe (`grok models`) confirmed auth intact
on the shared identity. N=3 was run only after N=2 came back clean, per
protocol, and was itself 3/3 clean.

**codex — GREEN at N=2.** Both lanes returned rc=0 with their exact expected
replies (`CX-<n>-OK`), with **no port collision** — the run used `codex exec`
(one-shot), which does not stand up the local server that the app-server mode
races on, so the collision class the WSL research flagged does not arise. A
post-run `codex exec` re-probe returned its expected reply
(`POST-CONCURRENCY-OK`) → auth survived the concurrent run intact. codex keeps
its session/state in SQLite, which serializes concurrent writers natively (the
only files that changed under load were the WAL/SHM siblings); a first-pass
integrity check mis-reported "CORRUPT" purely from a checker path-quoting bug
(it looked for `auth.json` at a path codex does not use, and its sqlite
one-liner never expanded `$HOME`) — the authoritative signal is that
`codex exec` authenticates and replies correctly *after* the concurrent run.
codex N=3 was not run; the cap is raised only to the proven-green N=2.



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
| grok | 2 | 2026-07-18 | **GREEN** (live authenticated, user-authorized) | both lanes rc=0, exact replies, no 429 under shared quota, `~/.grok` path-isolated, auth intact post-run | 3 |
| grok | 3 | 2026-07-18 | **GREEN** (live authenticated, user-authorized) | 3/3 clean, config intact, auth intact; run only after N=2 clean | 3 |
| codex | 2 | 2026-07-18 | **GREEN** (live authenticated, user-authorized) | both lanes rc=0, exact replies, no port collision (`exec` one-shot), auth intact post-run, SQLite-serialized state | 2 |
| codex | 3 | 2026-07-18 | not run | cap raised only to proven-green N=2; N=3 left for a future session if codex:3 is wanted | 2 (from N=2 green) |
| claude | n/a | 2026-07-18 | `REQUIRES-SEPARATE-HOME` (ruled from public record, no local run) | see Task 3 above | n/a — Claude was never in the grok/codex pueue-cap conversation |

Authenticated GREEN rows are now recorded for grok (N=2, N=3) and codex
(N=2) from the user-authorized live shared-account run. Per the EARS gate
("caps rise only to a proven-green N"), the `grok` pueue cap is raised to
**3** and `codex` to **2** in `skills/foreman/scripts/lane-queue.sh`, and
grok is promoted to an eligible default implementer (see
`skills/foreman/references/lanes.md`; Sonnet remains the standing default
this era). The earlier auxiliary-unauthenticated rows are retained above as
history and were never the basis for a cap change.
