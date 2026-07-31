# REPORT — decision-lineage-emission (S4a)

**Scope:** BRIEF.md tasks T1–T6 only (D6 emission half). No commit. No graphify.
**Library claim:** `skills/foreman/scripts/lib/eventlog.sh` is **unmodified**.

---

## T1 — additivity premise (verified before code)

| Claim | Evidence | Verdict |
|---|---|---|
| `el_emit` treats `type` opaquely | `el_emit` signature is free string `$2`; no type allow-list (`lib/eventlog.sh:63–64`, `111–113`) | **TRUE** |
| `el_read` type-agnostic | Validates JSON only; never inspects `.type` (`146–177`) | **TRUE** |
| `el_read_after` type optional filter only | Optional `$3` type filter; otherwise attempt-only (`262–285`) | **TRUE** |
| `el_compact` only collapses heartbeat | `is_collapsible: .type == "heartbeat" and (.payload.state // null) == null and .ts < $cutoff` (`374`) | **TRUE** |
| `payload` is parseable JSON only | `--argjson payload "$payload"` — jq parse, no key whitelist (`111–114`) | **TRUE** |
| Cursor is line-number based, type-agnostic | `el_cursor_get` / `el_cursor_commit` store integer line counts; `el_read` uses physical line index `n` (`179–191`, `149–167`) | **TRUE** |

**Premise holds.** Change is additive event types + payload keys. Not a signature migration.

Known-bad for T1: `el_emit run gate_decision lane 'not-json'` → non-zero, no line written
(`tests/decision-events.bats` "T1 known-bad: payload that is not JSON…").

---

## What landed (T2–T6)

### New
- `skills/foreman/scripts/lib/telemetry.sh` — usage blocks, model identity, finding ids, file sha256, `finding_outcome` helper.
- `tests/decision-events.bats` (9 tests)
- `tests/telemetry.bats` (9 tests)

### Modified
- `skills/foreman/scripts/audit-run.sh` — sources eventlog+telemetry; emits `audit_verdict` + per-finding `finding` for success and post-invoke failure paths (`UNVERIFIED` + reason); duration_s; usage; evidence by content hash only.
- `skills/foreman/scripts/gate-eval.sh` — sources eventlog+telemetry; emits `gate_decision` with pass/reasons/base/head/inputs_evaluated; on emit failure sets `emission_failed:true` in `gate-decision.json` without changing pass/fail.
- `skills/foreman/scripts/lane-run.sh` — model identity on `prompt`/`round_done`; usage on `round_done`; phases `{queue_wait_s?, implement_s, gate_s?}`; audit duration stays on audit stage only.
- `skills/foreman/references/durable-lanes.md` — vocabulary for new types.
- `skills/foreman/references/orchestration-hardening.md` §11 — per-vendor usage reporting facts.

### Not in scope (D6)
- T7 metrics.json rollup
- Verdict lineage bound to diff hash / three-outcome vocabulary (4b)
- Changes to `lib/eventlog.sh`

---

## Captured live output

### Gate decision recorded (PASS)

```text
$ bash skills/foreman/scripts/gate-eval.sh demo1
[foreman] GATE PASS (demo1)
gate exit=0

events.jsonl:
{"seq":1,"ts":"2026-07-29T19:19:18Z","type":"gate_decision","lane":"demo",
 "payload":{"pass":true,"reasons":[],"base":"3dc765b3…","head":"3dc765b3…",
            "inputs_evaluated":["forbidden_paths","hash_paths","checks_result",
                                "audit_verdict","docs_check"]}}
```

`el_read` consumes the line (well-formed JSON, type `gate_decision`).

### Gate still passes when emission fails

Known-bad log target: `events.jsonl` as a directory (append fails).

```text
el_emit: append failed for demo2 (seq 1 skipped)
gate-eval: el_emit gate_decision failed
[foreman] GATE PASS (demo2)
gate-emitfail exit=0
gate-decision.json:
{"pass": true, "reasons": [], "emission_failed": true}
```

### Audit verdict + finding recorded

Fake `codex` on PATH writing one WARNING + one finding:

```text
{"type":"audit_verdict","payload":{
  "vendor":"codex","model":"gpt-5.6-sol","effort":"high","verdict":"WARNING",
  "duration_s":0,
  "usage":{"vendor":"codex","model":"gpt-5.6-sol","source":"unavailable","effort":"high"},
  "evidence":{"diff_sha256":"1a059963…","base_sha":"…"},
  "model_identity":{"requested_alias":"gpt-5.6-sol","cli_version":null}}}
{"type":"finding","payload":{
  "id":"697660137d0fdc0a","source":"codex","severity":"high",
  "file":"a.sh","line":10,"upheld":null}}
```

Findings are **not** nested under `audit_verdict`. Diff body is absent from payloads.

### Round usage + phase timing

```text
{"type":"prompt","payload":{"cmd":"…","model":{…},"queue_wait_s":3}}
{"type":"round_done","payload":{
  "exit_code":0,
  "usage":{"vendor":"","model":"","source":"unavailable"},
  "phases":{"implement_s":1,"queue_wait_s":3}}}
```

`source:"unavailable"` has **no** numeric token/cost fields (never zero).

---

## Known-bad falsification (standing rule 2)

Every assertion class was observed failing against a known-bad input **before** trust:

| Assertion | Known-bad input | Observed failure | Then green |
|---|---|---|---|
| `gate_decision` present after gate | Pre-emission log with only `prompt` | `el_read \| jq select(gate_decision)` empty | After implement: present |
| Invalid payload rejected | `el_emit … 'not-json'` | non-zero status, no line | OK |
| Gate outcome independent of emit | `events.jsonl` as directory | emit fails **and** `pass:true` / `exit 0` | OK |
| FAIL path emit failure | same + BLOCKED verdict | `pass:false` + `emission_failed:true` | OK |
| `unavailable` never zeros | `tl_usage_block … unavailable 0 0 0 0` | would be red if zeros retained; helper strips them | OK |
| Vendor-reported only when stream has usage | empty/missing stream | `source:unavailable`, no numerics | OK |
| Phase `gate_s` recorded | pre-fix: built payload before gate finished | `gate_s` absent (test red once) | fixed fold-in; test green |
| Findings countable | nested-array design rejected | two separate `finding` events | OK |
| Finding outcome append-only | mutate original | original bytes unchanged after `finding_outcome` | OK |

---

## Verification commands (quoted)

```text
flock /tmp/foreman-bats.lock bats tests/decision-events.bats tests/telemetry.bats
# → 1..18, all ok

flock /tmp/foreman-bats.lock bats tests/gate-eval.bats
# → 1..1 ok

flock /tmp/foreman-bats.lock bats tests/lane-run.bats -f 'tees stream|round_done'
# → 1..9 ok (1 skip: real launcher binary absent)

bash -n skills/foreman/scripts/{gate-eval,audit-run,lane-run}.sh
bash -n skills/foreman/scripts/lib/telemetry.sh
# → all OK

git diff --stat skills/foreman/scripts/lib/eventlog.sh
# → empty (untouched)
```

Note: two `tests/eventlog.bats` cases (`append failure leaves a gap`, concurrent `el_attempt_new`) fail on this host with `mv: … .seq.tmp: No such file or directory` — lock-primitive contention class, **pre-existing**, unrelated to this change (eventlog.sh unmodified).

---

## Vendor usage facts (T5)

| vendor | reports usage in harness path? | recording |
|---|---|---|
| grok 0.2.114 | no stable per-round usage object | `source: unavailable` unless stream yields usage |
| codex 0.146.0 | partial (`exec --json` may; default argv does not guarantee) | stream parse, else unavailable |
| claude 2.1.x | no harness-facing channel | always unavailable |

Recorded in `references/orchestration-hardening.md` §11.

---

## Emission safety (D7 / D9 dogfood)

- Every new `el_emit` is guarded `if ! el_emit …; then echo … >&2; fi`
- Gate pass/fail never depends on emit
- Failed gate emit is visible as `emission_failed:true` in `gate-decision.json`
- Payloads carry hashes/ids/counts only (no diff/prompt/file bodies added)

Ready for dogfood on this project's next audit and implement lanes.
