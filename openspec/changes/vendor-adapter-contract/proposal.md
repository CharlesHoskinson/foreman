# Change: vendor-adapter-contract

## Why

Foreman invokes four vendor CLIs and has **one argv builder, covering two of
them, for one of the two verbs**.

`skills/foreman/scripts/lib/worker-cmd.sh` is 76 lines. `wc_build_argv VENDOR
PROMPT_FILE WORKDIR` has exactly two branches — grok at `:46-57`, codex at
`:58-66` — and a default branch at `:67-74` that dies `unknown worker vendor`.
Its own header states the scope honestly: *"v1 covers the two live worker
vendors (grok, codex); claude is out of scope (REQUIRES-SEPARATE-HOME)"*
(`worker-cmd.sh:6-7`). It is implement-only and reached only from hard mode
(`worker-run.sh:116-122`).

**The audit verb has no argv builder at all.** `audit-run.sh:78-86` hard-codes
one `codex exec … --sandbox read-only --output-schema … --output-last-message
… - < "$PROMPT"` block, and `agents/codex-auditor.md` restates a second copy of
the same invocation in prose for the soft-mode lane. Two hand-maintained
copies, one vendor, no contract.

**`claude` is already half-wired, and that is the warning this package exists
to heed.** R5 §8.2 puts it plainly: the claude lane is plumbed at
`wt-new.sh:106-109` (a `vendor-home/claude` directory in every worktree),
`lane-run.sh:210` (`claude) echo CLAUDE_CONFIG_DIR`), `lane-queue.sh:422`
(`claude:3`) and `env/tool-check.sh:83` (`claude auth status`) — four sites
that all say "claude is a supported lane" — and then **there is no `claude`
branch in `wc_build_argv`**. A `LANE_VENDOR=claude` lane passes the vendor-map
check, passes the readiness gate, is given a vendor home, is admitted to a
pueue group, and dies at the argv builder. R5's conclusion is the instruction
for this release: a fourth vendor lane must not repeat this half-wiring.

Three further facts make a contract, rather than a fifth `case` arm, the right
shape.

**The prompt must never arrive on stdin.** `foreman-launch` nulls CMD's stdin
unconditionally (`worker-cmd.sh:2-6`, `launcher/README.md:32-33`), and
`lane-run.sh` redirects stdin from `/dev/null`. Today that invariant is
satisfied incidentally — grok has `--prompt-file`, codex takes a positional.
The fourth vendor, the Antigravity CLI (`agy` 1.1.8, the OAuth-authenticated
Google path actually installed on the reference box), has no prompt-file flag
at all: the prompt is the **value of `--print`**. Worse, argument order is
load-bearing and fails silently — `agy "some prompt" --print`, with the prompt
as a positional and a valueless trailing `--print`, **hangs indefinitely**
(observed live 2026-07-28: no output, no error, killed at 180 s). A lane in
that state sits in `RUNNING_IMPL` until the stall watchdog fires and the
failure is misattributed to the model. Argument order is exactly the kind of
fact that has to live in one place.

**"Did the worker actually write?" is a grok-specific script.**
`grok-multiround.sh:72` — `snap() { git -C "$WD" status --porcelain | sha256sum … }`
— is the only defence Foreman has against a vendor narrating success while
writing nothing. R3 §6.4 records that this failure class is not grok-specific:
grok's writes are prompt-cancelled unless `--allow Write --allow Edit`, and the
Google CLIs gate writes behind an approval mode that denies rather than asks
when there is no TTY. Both end `rc=0` with confident narration. The digest
"must be promoted from a grok-specific script to a contract point."

**Exit codes are not portable, and one vendor has no distinct auth code.**
Live on the reference box: `agy models` returns rc **0** when authenticated and
rc **1** with `Error: Please sign in to view available models` when the home
directory holds no credential. rc 1 is also agy's general error code, so
"nonzero" cannot distinguish a Setup problem from a round problem for this
vendor — the same fail-closed, positive-signal-required shape `vendor_authed`
already uses for grok (`env/tool-check.sh:60-81`). That per-vendor knowledge
belongs in the adapter, not replicated at every call site.

## What changes

- **New `skills/foreman/scripts/adapters/<vendor>.sh`**, one per vendor
  (`grok`, `codex`, `agy`, `claude`), each defining the seven functions R3 §0
  specifies: `adapter_implement_argv`, `adapter_audit_argv`,
  `adapter_home_var`, `adapter_auth_probe`, `adapter_result_text`,
  `adapter_result_verdict`, `adapter_caps`. Array output (`ADAPTER_ARGV`)
  preserves `WC_ARGV`'s convention: callers spawn the argv directly with no
  shell re-interpretation.
- **Two verbs, four vendors, one place.** `lib/worker-cmd.sh` becomes a thin
  compatibility shim over the adapters (or is retired once its callers move);
  `audit-run.sh`'s inline `codex exec` block is replaced by
  `adapter_audit_argv`; `agents/codex-auditor.md` stops carrying a second copy
  of the invocation and points at the adapter.
- **The never-stdin invariant and argument order become structural.** The
  adapter is the only component that knows how a given vendor accepts a prompt,
  including any flag whose position changes its meaning. A contract test
  asserts both.
- **`adapter_caps` publishes machine-readable capabilities**, including the
  per-vendor `rc_unavailable` set and, where a vendor has no distinct
  unauthenticated exit code, the positive signal its auth probe requires — so
  `lane-run.sh` can distinguish `STATUS: unavailable` (a Setup problem) from
  `STATUS: fail` (a round problem) without vendor-specific code at the call
  site (R3 §6.6).
- **Result capture is separated from result interpretation.** Adapters capture
  stdout and stderr to distinct files and parse whichever carries the payload;
  no adapter may rely on a pipeline's exit status.
- **Verdict conformance is the adapter's job.** Where a vendor forces the
  schema (`codex --output-schema`, `grok --json-schema`, `agy --json-schema`)
  the adapter passes it through; where it cannot, the adapter validates the
  parsed object against `adapters/verdict.schema.json` itself and reports a
  non-conforming reply as a failure, never as a verdict.
- **`grok-multiround.sh` → `vendor-multiround.sh`** with `snap()` promoted into
  `lib/evidence.sh` and the `--prompt-file`-appending line routed through
  `adapter_implement_argv`. The git-status digest becomes a contract point for
  all four vendors.
- **The `claude` half-wiring is resolved, not inherited.** Either a working
  `adapters/claude.sh` lands with its `REQUIRES-SEPARATE-HOME` constraint
  honoured, or the four plumbing sites that advertise a claude lane are
  removed. Leaving the current state is explicitly out of scope.

## Impact

- Affected: `skills/foreman/scripts/lib/worker-cmd.sh`,
  `skills/foreman/scripts/audit-run.sh` (`:35-37`, `:78-86`),
  `skills/foreman/scripts/worker-run.sh` (`:116-122,141-144,149`),
  `skills/foreman/scripts/grok-multiround.sh`, `agents/codex-auditor.md`,
  `agents/grok-implementer.md`, `agents/codex-implementer.md`,
  `skills/foreman/references/lanes.md`.
- New: `skills/foreman/scripts/adapters/{grok,codex,agy,claude}.sh`,
  `skills/foreman/scripts/lib/evidence.sh`,
  `skills/foreman/scripts/vendor-multiround.sh`, `tests/adapters.bats`,
  `tests/vendor-multiround.bats`.
- Depends on nothing. **Every other multi-vendor package in this release
  depends on this one** — `agy-lane-activation` supplies `adapters/agy.sh`,
  `cross-vendor-audit-routing` selects which adapter's `audit` verb runs,
  `vendor-concurrency-and-quota` reads `adapter_caps`.
- Contends with `test-infrastructure-hardening` on `tests/` and with the WSL
  packages on `lane-run.sh`. R5 §7.1 already flags `lane-run.sh` as the
  release's real three-way contention point; this package touches it only
  through the callers listed above.
- Behaviour change: none intended for grok or codex. The existing argv for both
  vendors SHALL be reproduced byte-for-byte by their adapters, and a test
  SHALL assert that.
