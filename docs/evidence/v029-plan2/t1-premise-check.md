# Three-outcome-verdicts T1 premise check

Date: 2026-08-01 UTC

## Stop decision

T1 found two failed premises. Stop T2-T5 work for this package.

| Item | Verdict | Finding |
|---|---|---|
| Premise 1 | **FAIL** | `audit-run.sh` replaces a stale verdict before audit launch. `gate-eval.sh` checks four freshness bindings. |
| Premise 2 | **FAIL** | `gate-eval.sh` sources `lib/config.sh`. It reads four `[audit.policy]` values. |
| Premise 3 | **PASS** | The tracked-match inventory is complete. It contains 135 paths. |
| T2 | **IMPLEMENTED** | All tested success and failure paths publish complete atomic records. The required provenance fields are top-level fields. |
| T3 | **IMPLEMENTED** | The configured timeout bounds the audit. Timeout kills the process group and records `UNVERIFIED`. |
| T4 | **IMPLEMENTED** | The gate recomputes diff and tree identities. It checks diff, tree, attempt, and state separately. |

No product file changed during this check.

The initial worktree was not clean. It already contained `?? SPEC-plan2-t1.md`.
This check did not change that file.

## Shared behavioral probe

The probe used a throwaway Git repository under the Bats temporary directory.
It used a fake `codex` executable. The fake timeout descendant ignored `TERM`.

The stale-verdict test seeded an old `APPROVED` file. It started a blocked audit and ran the gate during that audit.

The policy test kept all evidence bindings current after each config change.
Thus, only the `[audit.policy].blocked` value changed the gate decision.

Command:

```text
bats --show-output-of-passing-tests /tmp/t1-premise-probe.bats
```

Verbatim output:

```text
1..5
ok 1 premise 1: stale approval is replaced and gate sees in-progress UNVERIFIED
# artifact={"verdict":"UNVERIFIED","state":"in_progress","reason":"audit_in_progress","evidence":{"diff_sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","base_sha":"e59f08efa3a3f7bcf78101225986e60752f1c89c","head_sha":"e59f08efa3a3f7bcf78101225986e60752f1c89c","attempt":1,"tree_sha256":"91b3079354cc3ee9c4112aff823fca116e958d68e6489d587fab989adb753f96"}}
# gate_status=1
# gate_reasons=["audit verdict incomplete (state is not complete)","audit verdict UNVERIFIED (reason: audit_in_progress; policy: retry)"]
ok 2 premise 2: audit policy changes BLOCKED gate behavior
# blocked_never_status=1
# blocked_never_reasons=["audit verdict BLOCKED (policy: never)"]
# blocked_merge_status=0
# blocked_merge_reasons=[]
ok 3 T2: success and failure publish complete atomic-shape records
# approved={"verdict":"APPROVED","state":"complete","vendor":"codex","model":"gpt-5.6-sol","effort":"high","started_at":"2026-08-01T03:16:10Z","ended_at":"2026-08-01T03:16:10Z","duration_s":0,"evidence":{"diff_sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","tree_sha256":"91b3079354cc3ee9c4112aff823fca116e958d68e6489d587fab989adb753f96","base_sha":"ef4c46618ad19108cfea07623e1f06dbf19918da","head_sha":"ef4c46618ad19108cfea07623e1f06dbf19918da","attempt":1},"has_provenance":false}
# nonzero={"verdict":"UNVERIFIED","state":"complete","reason":"nonzero_exit","vendor":"codex","model":"gpt-5.6-sol","effort":"high","started_at":"2026-08-01T03:16:11Z","ended_at":"2026-08-01T03:16:11Z","duration_s":0,"evidence":{"diff_sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","base_sha":"ef4c46618ad19108cfea07623e1f06dbf19918da","head_sha":"ef4c46618ad19108cfea07623e1f06dbf19918da","attempt":2,"tree_sha256":"91b3079354cc3ee9c4112aff823fca116e958d68e6489d587fab989adb753f96"},"has_provenance":false}
ok 4 T3: timeout kills descendant and records duration
# timeout={"verdict":"UNVERIFIED","state":"complete","reason":"timeout","duration_s":2,"evidence":{"diff_sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","base_sha":"f619385ec294a204524652b4f58e45168f33e830","head_sha":"f619385ec294a204524652b4f58e45168f33e830","attempt":1,"tree_sha256":"79191907f6b9f78a25e6095a2157f1bab4fae306714a0bebed913f00046b5d76"}}
# descendant_pid=1965 descendant_state=dead
ok 5 T4: four verdict bindings have distinct reasons
# baseline_status=0 baseline_reasons=[]
# diff_reason=audit verdict diff hash mismatch (stale verdict for a different diff)
# tree_reason=audit verdict evaluated-tree mismatch (worktree changed since the audit ran)
# attempt_reason=audit verdict attempt superseded or unfinished (a fresher or still-running audit exists)
# state_reason=audit verdict incomplete (state is not complete)
```

## Premise 1: stale-verdict hazard

**Verdict: FAIL.** The claimed hazard is absent in this checkout.

The required grep command follows.

```text
grep -nE 'audit-verdict\.json' skills/foreman/scripts/audit-run.sh skills/foreman/scripts/gate-eval.sh
```

Verbatim output:

```text
skills/foreman/scripts/audit-run.sh:3:# Full Docker isolation not required; writes audit-verdict.json for gate-eval.
skills/foreman/scripts/audit-run.sh:37:VERDICT_FILE="$RD/audit-verdict.json"
skills/foreman/scripts/audit-run.sh:370:    "audit-run currently only auto-invokes Codex; set audit.vendor=codex or write audit-verdict.json manually"
skills/foreman/scripts/gate-eval.sh:115:  "$RD/audit-verdict.json" >/dev/null 2>&1; then
skills/foreman/scripts/gate-eval.sh:121:  audit_diff="$(jq -r '.evidence.diff_sha256 // empty' "$RD/audit-verdict.json")"
skills/foreman/scripts/gate-eval.sh:122:  audit_tree="$(jq -r '.evidence.tree_sha256 // empty' "$RD/audit-verdict.json")"
skills/foreman/scripts/gate-eval.sh:123:  audit_attempt="$(jq -r '.evidence.attempt // empty' "$RD/audit-verdict.json")"
skills/foreman/scripts/gate-eval.sh:124:  audit_state="$(jq -r '.state // empty' "$RD/audit-verdict.json")"
skills/foreman/scripts/gate-eval.sh:139:  AUDIT_VERDICT="$(jq -r .verdict "$RD/audit-verdict.json")"
skills/foreman/scripts/gate-eval.sh:147:          "$RD/audit-verdict.json" 2>/dev/null || echo true
skills/foreman/scripts/gate-eval.sh:159:            "$RD/audit-verdict.json" 2>/dev/null
skills/foreman/scripts/gate-eval.sh:176:      audit_unverified_reason="$(jq -r '.reason // "unspecified"' "$RD/audit-verdict.json")"
```

The grep does not show the write because the script writes through `VERDICT_FILE`.
The control-flow trace shows these paths:

| Path before or through audit launch | Effect on a pre-existing verdict |
|---|---|
| Attempt allocation fails | `ar_fail` writes complete `UNVERIFIED` with `attempt_allocation_failed`. The stale file does not survive. |
| Tree identity computation fails | `ar_fail` writes complete `UNVERIFIED` with a tree reason. The stale file does not survive. |
| Attempt and tree setup succeed | `ar_write_unverified in_progress audit_in_progress` replaces the stale file before vendor, CLI, schema, or auditor checks. |
| Vendor, CLI, `setsid`, or schema check fails | The in-progress file exists first. `ar_fail` then replaces it with complete `UNVERIFIED`. |
| Auditor times out, mutates the tree, exits nonzero, returns empty output, or returns invalid output | `ar_fail` replaces the in-progress file with complete `UNVERIFIED` and a distinct reason. |
| Auditor returns a valid model verdict | A temporary file and `mv -f` replace the in-progress file with the complete verdict. |
| `INT` or `TERM` arrives after the pre-launch publish | Cleanup keeps the complete in-progress JSON. A stale approval does not return. |

Command:

```text
nl -ba skills/foreman/scripts/audit-run.sh | sed -n '334,382p'
```

Relevant verbatim output:

```text
   334 ar_fail() {
   335   local exit_code="$1" reason="$2" message="$3"
   336   ar_end_timing
   337   ar_write_unverified complete "$reason"
   338   ar_record_outcome UNVERIFIED
   339   ar_emit_lineage "$VERDICT_FILE" "$reason"
   340   log "ERROR: $message"
   341   exit "$exit_code"
   342 }
   343 
   344 if ! ATTEMPT="$(el_attempt_new "$TASK_ID" "$LANE")"; then
   345   ATTEMPT=0
   346   ar_fail "$EXIT_FAIL" attempt_allocation_failed "could not allocate audit attempt"
   347 fi
   348 ar_atomic_integer "$CURRENT_ATTEMPT_FILE" "$ATTEMPT"
   349 
   350 tree_tmp="$(mktemp)"
   351 if evidence_tree_sha256 "$WT" >"$tree_tmp"; then
   352   TREE_SHA="$(<"$tree_tmp")"
   353   rm -f "$tree_tmp"
   354 else
   355   tree_reason="${EVIDENCE_REASON:-tree-identity-uncomputable}"
   356   rm -f "$tree_tmp"
   357   ar_fail "$EXIT_FAIL" "tree_identity_uncomputable:${tree_reason}" \
   358     "could not compute evaluated-tree identity ($tree_reason)"
   359 fi
   360 
   361 # Replace any stale verdict before any auditor process (or CLI probe) starts.
   362 ar_write_unverified in_progress audit_in_progress
   363 
   364 if [[ "$AUDIT_VENDOR" == "$WORKER_VENDOR" ]]; then
   365   ar_fail "$EXIT_CONFIG" invalid_audit_vendor \
   366     "audit vendor ($AUDIT_VENDOR) must differ from worker vendor ($WORKER_VENDOR)"
   367 fi
   368 if [[ "$AUDIT_VENDOR" != "codex" ]]; then
   369   ar_fail "$EXIT_MISSING_CLI" missing_cli \
   370     "audit-run currently only auto-invokes Codex; set audit.vendor=codex or write audit-verdict.json manually"
   371 fi
   372 if ! command -v codex >/dev/null 2>&1; then
   373   ar_fail "$EXIT_MISSING_CLI" missing_cli \
   374     "required command not found: codex — install OpenAI Codex CLI and run codex login"
   375 fi
   376 if ! command -v setsid >/dev/null 2>&1; then
   377   ar_fail "$EXIT_MISSING_CLI" missing_cli \
   378     "required command not found: setsid — install util-linux"
   379 fi
   380 
   381 SCHEMA="$SCRIPT_DIR/adapters/verdict.schema.json"
   382 [[ -f "$SCHEMA" ]] || ar_fail "$EXIT_CONFIG" missing_schema "missing schema: $SCHEMA"
```

The shared probe shows what the gate sees during the new attempt.
It sees `UNVERIFIED`, `audit_in_progress`, and the current attempt.
It fails for the incomplete state and the `UNVERIFIED` verdict.

## Premise 2: config seam

**Verdict: FAIL.** The gate sources the loader and reads `[audit.policy]`.

Command:

```text
nl -ba skills/foreman/scripts/gate-eval.sh | sed -n '8,42p'
```

Verbatim output:

```text
     8 source "$SCRIPT_DIR/lib/common.sh"
     9 # shellcheck source=lib/eventlog.sh
    10 source "$SCRIPT_DIR/lib/eventlog.sh"
    11 # shellcheck source=lib/telemetry.sh
    12 source "$SCRIPT_DIR/lib/telemetry.sh"
    13 # shellcheck source=lib/evidence.sh
    14 source "$SCRIPT_DIR/lib/evidence.sh"
    15 # shellcheck source=lib/config.sh
    16 source "$SCRIPT_DIR/lib/config.sh"
    17 
    18 TASK_ID="${1:?usage: gate-eval.sh TASK_ID}"
    19 RD="$(run_dir "$TASK_ID")"
    20 require_cmd jq; require_cmd git
    21 
    22 for f in meta.json hashes.txt checks-result.json; do
    23   [[ -f "$RD/$f" ]] || die "$EXIT_CONFIG" "missing gate input: $RD/$f"
    24 done
    25 
    26 WT="$(jq -r .worktree "$RD/meta.json")"
    27 ROOT="$(jq -r .repo_root "$RD/meta.json")"
    28 BASE_SHA="$(jq -r .base_sha "$RD/meta.json")"
    29 HEAD_SHA="$(git_nohooks -C "$WT" rev-parse HEAD 2>/dev/null || echo "")"
    30 CONFIG="$ROOT/.foreman/config.toml"
    31 LANE="$(jq -r '.lane // "gate"' "$RD/meta.json" 2>/dev/null || echo gate)"
    32 [[ -n "$LANE" && "$LANE" != "null" ]] || LANE="gate"
    33 
    34 REASONS=()
    35 INPUTS_EVALUATED=()
    36 
    37 FOREMAN_CONFIG="$CONFIG"
    38 cfg_load
    39 WARNING_LOW_POLICY="$(cfg_get audit.policy warning_low_resolved merge)"
    40 WARNING_MEDIUM_POLICY="$(cfg_get audit.policy warning_medium ask)"
    41 BLOCKED_POLICY="$(cfg_get audit.policy blocked never)"
    42 UNVERIFIED_POLICY="$(cfg_get audit.policy unverified retry)"
```

Behavioral command and output:

```text
bats --show-output-of-passing-tests --filter '^premise 2:' /tmp/t1-premise-probe.bats
```

```text
1..1
ok 1 premise 2: audit policy changes BLOCKED gate behavior
# blocked_never_status=1
# blocked_never_reasons=["audit verdict BLOCKED (policy: never)"]
# blocked_merge_status=0
# blocked_merge_reasons=[]
```

The command above is the filtered form of the passing shared probe.
The full shared output records the same two decisions.

## Premise 3: consumers of the three literals

**Verdict: PASS.** The search found 135 tracked paths.

Command:

```text
git grep -l -E '\b(APPROVED|WARNING|BLOCKED)\b' -- . | nl -ba
```

Verbatim output:

```text
     1  .foreman/session.db
     2  .foreman/session.ndjson
     3  AUDIT-devlog-2026-07-30.md
     4  CHECKPOINT-2026-07-30-evening.md
     5  README.md
     6  RESUME-2026-07-30.md
     7  RESUME.md
     8  ROADMAP.md
     9  agents/codex-auditor.md
    10  agents/foreman-audit.md
    11  bugeventlog.md
    12  checklist.md
    13  devlog/2026-07-28.md
    14  devlog/2026-07-29.md
    15  docs/USAGE.md
    16  docs/evidence/v029-tranche-a1/final-fix-report.md
    17  docs/evidence/v029-tranche-a1/task-5-report.md
    18  docs/evidence/v029-tranche-a1/task-7-brief.md
    19  docs/evidence/v029/integrate-wt-xps-run-implement-xps/AUDIT-devlog-2026-07-30.md
    20  docs/evidence/v029/s1-crlf/AUDIT-final.md
    21  docs/evidence/v029/s1-crlf/AUDIT-merge-ready.md
    22  docs/evidence/v029/s1-crlf/AUDIT-opus.md
    23  docs/evidence/v029/s1-crlf/AUDIT-sol-r3.md
    24  docs/evidence/v029/s1-crlf/AUDIT-sol.md
    25  docs/evidence/v029/s1-crlf/REWORK.md
    26  docs/evidence/v029/s1-lock-L1/AUDIT-sol-L1-r2.md
    27  docs/evidence/v029/s1-lock-L1/AUDIT-sol-L1.md
    28  docs/evidence/v029/s1-lock-L2/AUDIT-L2.md
    29  docs/evidence/v029/s1-lock-L2/REWORK.md
    30  docs/evidence/v029/s1-lock-L3/AUDIT-L3.md
    31  docs/evidence/v029/s1-lock-L3/REPORT.md
    32  docs/evidence/v029/s1-lock-L3/REWORK.md
    33  docs/evidence/v029/s10-readme/REPORT.md
    34  docs/evidence/v029/s2-formal/REPORT.md
    35  docs/evidence/v029/s4a-emission/REPORT.md
    36  docs/evidence/v029/s6-metrics/REPORT.md
    37  docs/evidence/v029/trial/AUDIT-MERGE.md
    38  docs/evidence/v029/trial/REWORK.md
    39  docs/notes/2026-07-16-resume-checkpoint.md
    40  docs/notes/2026-07-17-resume-checkpoint.md
    41  docs/research/v030-review/codex-review.json
    42  docs/research/v030-review/codex-review.md
    43  docs/research/v040/plan-report.md
    44  docs/research/vnext/AUDIT-infra-codex.md
    45  docs/research/vnext/AUDIT-terminusdb-codex.md
    46  docs/research/vnext/AUDIT-terminusdb-opus.md
    47  docs/research/vnext/EDIT-readme-facts.md
    48  docs/research/vnext/EDIT-readme-line.md
    49  docs/research/vnext/EDIT-readme-structural.md
    50  docs/research/vnext/FINAL-codex.md
    51  docs/research/vnext/FINAL-opus.md
    52  docs/research/vnext/N4-symbolic-verification.md
    53  docs/research/vnext/PKG-graph-workplane-summary.md
    54  docs/research/vnext/PKG-workflow-summary.md
    55  docs/research/vnext/PM-acceptance-criteria.md
    56  docs/research/vnext/R2-anthropic-graph-infra.md
    57  docs/research/vnext/R3-vendor-adapters.md
    58  docs/research/vnext/R5-internal-attachment-map.md
    59  docs/research/vnext/R6-eval-and-workflow.md
    60  docs/research/vnext/R7-graphify-foundation.md
    61  docs/research/vnext/REAUDIT-codex.md
    62  docs/research/vnext/REAUDIT-opus.md
    63  docs/research/vnext/RECONCILE.md
    64  docs/research/vnext/REVIEW-codex.md
    65  docs/research/vnext/REVIEW-opus.md
    66  docs/research/vnext/SYNTHESIS.md
    67  docs/research/vnext/VERIFY-opus-findings.md
    68  docs/research/vnext/VERIFY-terminusdb-schema-live.md
    69  docs/superpowers/plans/2026-07-15-foreman-enhancement.md
    70  docs/superpowers/plans/2026-07-16-v025-orchestration-hardening.md
    71  docs/superpowers/plans/2026-07-18-hard-mode-launcher.md
    72  docs/superpowers/plans/2026-07-31-v029-tranche-a1-recording-instruments.md
    73  docs/superpowers/specs/2026-07-15-foreman-enhancement-design.md
    74  docs/superpowers/specs/2026-07-15-readme-deepening-design.md
    75  docs/superpowers/specs/2026-07-31-v029-release-closeout-design.md
    76  formal/expectations.tsv
    77  formal/reports/M3-audit-gate.md
    78  formal/reports/M4-evidence-contract.md
    79  formal/reports/VERIFY-quint-architect.md
    80  formal/specs/audit_gate.qnt
    81  formal/specs/lane_lifecycle.qnt
    82  graphify-out/GRAPH_REPORT.md
    83  graphify-out/graph.json
    84  openspec/changes/archive/2026-07-18-docs-readme-refresh/ground-truth-inventory.md
    85  openspec/changes/archive/2026-07-18-lifecycle-three-stage/auth-probes.md
    86  openspec/changes/archive/2026-07-19-hard-mode-launcher/proposal.md
    87  openspec/changes/audit-groundedness-gate/design.md
    88  openspec/changes/audit-groundedness-gate/proposal.md
    89  openspec/changes/audit-groundedness-gate/specs/gate/spec.md
    90  openspec/changes/audit-groundedness-gate/tasks.md
    91  openspec/changes/cross-vendor-audit-routing/specs/audit-routing/spec.md
    92  openspec/changes/doctrine-reality-drift/proposal.md
    93  openspec/changes/evidence-contracts/design.md
    94  openspec/changes/evidence-contracts/specs/evidence-contracts/spec.md
    95  openspec/changes/evidence-contracts/tasks.md
    96  openspec/changes/formal-model-suite/proposal.md
    97  openspec/changes/formal-model-suite/specs/formal-models/spec.md
    98  openspec/changes/formal-model-suite/tasks.md
    99  openspec/changes/graph-eval-falsification/design.md
   100  openspec/changes/readme-refresh/proposal.md
   101  openspec/changes/release-metrics/specs/release-metrics/spec.md
   102  openspec/changes/three-outcome-verdicts/design.md
   103  openspec/changes/three-outcome-verdicts/proposal.md
   104  openspec/changes/three-outcome-verdicts/specs/audit-verdict/spec.md
   105  openspec/changes/three-outcome-verdicts/tasks.md
   106  openspec/changes/vendor-adapter-contract/specs/vendor-adapters/spec.md
   107  site/index.html
   108  skills/foreman/SKILL.md
   109  skills/foreman/references/audit-checklist.md
   110  skills/foreman/references/lanes.md
   111  skills/foreman/references/orchestration-hardening.md
   112  skills/foreman/references/release-metrics.md
   113  skills/foreman/references/roles.md
   114  skills/foreman/scripts/adapters/verdict.schema.json
   115  skills/foreman/scripts/audit-run.sh
   116  skills/foreman/scripts/fm-session.py
   117  skills/foreman/scripts/gate-eval.sh
   118  skills/foreman/scripts/wt-consolidate.sh
   119  skills/graphify/SKILL.md
   120  skills/ste/SKILL.md
   121  skills/superpowers/RELEASE-NOTES.md
   122  skills/superpowers/docs/superpowers/specs/2026-06-10-strict-cost-sdd-design.md
   123  skills/superpowers/scripts/sync-to-codex-plugin.sh
   124  skills/superpowers/skills/subagent-driven-development/SKILL.md
   125  skills/superpowers/skills/subagent-driven-development/implementer-prompt.md
   126  skills/superpowers/tests/claude-code/test-subagent-driven-development-integration.sh
   127  skills/superpowers/tests/explicit-skill-requests/run-multiturn-test.sh
   128  skills/superpowers/tests/explicit-skill-requests/run-test.sh
   129  tests/audit-verdict.bats
   130  tests/decision-events.bats
   131  tests/gate-eval.bats
   132  tests/graph-project-harness.sh
   133  tests/graph-project.bats
   134  tests/probes/evidence-mechanism.sh
   135  tools/ci-local.sh
```

### Runtime, model, formal, and test consumers

- `agents/codex-auditor.md` constrains model output to three values. It rejects a fourth model value explicitly.
- `agents/foreman-audit.md` gives a report template with three values and `n/a`. It does not name harness `UNVERIFIED`.
- `formal/specs/audit_gate.qnt` declares all four artifact values and checks `UNVERIFIED` explicitly. It does not fall through.
- `skills/foreman/scripts/adapters/verdict.schema.json` constrains model output to three values. It rejects model `UNVERIFIED` by design.
- `skills/foreman/scripts/audit-run.sh` accepts three model values. It converts any other model value into harness `UNVERIFIED` with `invalid_verdict_value`.
- `skills/foreman/scripts/gate-eval.sh` validates and handles all four artifact values. Its `UNVERIFIED` case adds a distinct failure reason.
- `tests/audit-verdict.bats` exercises all four artifact values. It checks separate `UNVERIFIED` and `BLOCKED` behavior.
- `tests/decision-events.bats` uses three values as event fixtures. The event path copies arbitrary payload values, so a fourth value passes through as data.
- `tests/gate-eval.bats` uses `APPROVED` in a missing-input fixture. It does not switch on the value or test a fourth value.
- `tests/graph-project-harness.sh` stores `APPROVED` in graph input. The graph importer treats the value as data, so a fourth value passes through.
- `tests/graph-project.bats` stores `APPROVED` in graph input. The graph importer treats the value as data, so a fourth value passes through.

### Current operator guidance and reference consumers

- `README.md` maps three verdicts to actions. It omits `UNVERIFIED`, so the guidance does not handle a fourth value.
- `ROADMAP.md` records prior verdict defects and audit results. It does not execute a value, so fourth-value handling is not applicable.
- `docs/USAGE.md` maps three verdicts to actions. It omits `UNVERIFIED`, so the guidance does not handle a fourth value.
- `site/index.html` advertises the three model values. It has no runtime branch, so fourth-value handling is not applicable.
- `skills/foreman/SKILL.md` maps three verdicts to architect actions. It omits `UNVERIFIED`, so the guidance does not handle a fourth value.
- `skills/foreman/references/audit-checklist.md` defines the three-value model response. It does not consume the harness artifact.
- `skills/foreman/references/lanes.md` describes audit output as three-valued. It omits artifact `UNVERIFIED`.
- `skills/foreman/references/orchestration-hardening.md` describes three-value policy and says the gate is not wired. That statement is stale and omits `UNVERIFIED`.
- `skills/foreman/references/release-metrics.md` defines a four-value verdict distribution. It handles `UNVERIFIED` explicitly.
- `skills/foreman/references/roles.md` defines the three-value model schema. It does not consume the harness artifact.
- `skills/foreman/scripts/wt-consolidate.sh` prints an operator instruction that requires `APPROVED`. It does not parse values and gives no `UNVERIFIED` action.

### Recorded data and root records

- `.foreman/session.db` stores prior session text in a binary database. It is not executable, so fourth-value handling is not applicable.
- `.foreman/session.ndjson` stores prior session events. It is not executable, so fourth-value handling is not applicable.
- `AUDIT-devlog-2026-07-30.md` records an audit verdict. It is not executable, so fourth-value handling is not applicable.
- `CHECKPOINT-2026-07-30-evening.md` records work status and verdict text. It is not executable, so fourth-value handling is not applicable.
- `RESUME-2026-07-30.md` records work status and verdict text. It is not executable, so fourth-value handling is not applicable.
- `RESUME.md` records work status and verdict text. It is not executable, so fourth-value handling is not applicable.
- `bugeventlog.md` records historical verdict defects. It is not executable, so fourth-value handling is not applicable.
- `checklist.md` records review results. It is not executable, so fourth-value handling is not applicable.
- `devlog/2026-07-28.md` records verdict history. It is not executable, so fourth-value handling is not applicable.
- `devlog/2026-07-29.md` records verdict history. It is not executable, so fourth-value handling is not applicable.

### Evidence and note records

- `docs/evidence/v029-tranche-a1/final-fix-report.md` records verdict evidence. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029-tranche-a1/task-5-report.md` records verdict evidence. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029-tranche-a1/task-7-brief.md` records verdict requirements. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/integrate-wt-xps-run-implement-xps/AUDIT-devlog-2026-07-30.md` records verdict evidence. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/s1-crlf/AUDIT-final.md` records an audit verdict. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/s1-crlf/AUDIT-merge-ready.md` records an audit verdict. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/s1-crlf/AUDIT-opus.md` records an audit verdict. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/s1-crlf/AUDIT-sol-r3.md` records an audit verdict. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/s1-crlf/AUDIT-sol.md` records an audit verdict. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/s1-crlf/REWORK.md` records verdict-driven rework. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/s1-lock-L1/AUDIT-sol-L1-r2.md` records an audit verdict. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/s1-lock-L1/AUDIT-sol-L1.md` records an audit verdict. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/s1-lock-L2/AUDIT-L2.md` records an audit verdict. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/s1-lock-L2/REWORK.md` records verdict-driven rework. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/s1-lock-L3/AUDIT-L3.md` records an audit verdict. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/s1-lock-L3/REPORT.md` records verdict evidence. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/s1-lock-L3/REWORK.md` records verdict-driven rework. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/s10-readme/REPORT.md` records verdict evidence. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/s2-formal/REPORT.md` records formal verdict evidence. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/s4a-emission/REPORT.md` records verdict-event evidence. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/s6-metrics/REPORT.md` records verdict-metric evidence. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/trial/AUDIT-MERGE.md` records an audit verdict. It is not executable, so fourth-value handling is not applicable.
- `docs/evidence/v029/trial/REWORK.md` records verdict-driven rework. It is not executable, so fourth-value handling is not applicable.
- `docs/notes/2026-07-16-resume-checkpoint.md` records verdict history. It is not executable, so fourth-value handling is not applicable.
- `docs/notes/2026-07-17-resume-checkpoint.md` records verdict history. It is not executable, so fourth-value handling is not applicable.

### Research and planning records

- `docs/research/v030-review/codex-review.json` stores a review result. It is not executable, so fourth-value handling is not applicable.
- `docs/research/v030-review/codex-review.md` stores a review result. It is not executable, so fourth-value handling is not applicable.
- `docs/research/v040/plan-report.md` discusses verdict behavior. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/AUDIT-infra-codex.md` records audit findings about verdict behavior. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/AUDIT-terminusdb-codex.md` records an audit verdict. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/AUDIT-terminusdb-opus.md` records an audit verdict. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/EDIT-readme-facts.md` discusses verdict documentation. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/EDIT-readme-line.md` discusses verdict documentation. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/EDIT-readme-structural.md` discusses verdict documentation. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/FINAL-codex.md` records review verdicts. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/FINAL-opus.md` records review verdicts. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/N4-symbolic-verification.md` discusses formal verdict values. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/PKG-graph-workplane-summary.md` summarizes verdict records. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/PKG-workflow-summary.md` summarizes verdict records. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/PM-acceptance-criteria.md` states verdict acceptance criteria. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/R2-anthropic-graph-infra.md` discusses review verdicts. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/R3-vendor-adapters.md` discusses adapter verdicts. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/R5-internal-attachment-map.md` maps verdict references. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/R6-eval-and-workflow.md` discusses verdict evaluation. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/R7-graphify-foundation.md` discusses verdict graph data. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/REAUDIT-codex.md` records a re-audit verdict. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/REAUDIT-opus.md` records a re-audit verdict. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/RECONCILE.md` reconciles verdict records. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/REVIEW-codex.md` records review verdicts. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/REVIEW-opus.md` records review verdicts. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/SYNTHESIS.md` summarizes verdict findings. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/VERIFY-opus-findings.md` verifies verdict findings. It is not executable, so fourth-value handling is not applicable.
- `docs/research/vnext/VERIFY-terminusdb-schema-live.md` verifies schema findings. It is not executable, so fourth-value handling is not applicable.
- `docs/superpowers/plans/2026-07-15-foreman-enhancement.md` plans verdict handling. It is not executable, so fourth-value handling is not applicable.
- `docs/superpowers/plans/2026-07-16-v025-orchestration-hardening.md` plans verdict policy. It is not executable, so fourth-value handling is not applicable.
- `docs/superpowers/plans/2026-07-18-hard-mode-launcher.md` records status text. It is not a verdict consumer, so fourth-value handling is not applicable.
- `docs/superpowers/plans/2026-07-31-v029-tranche-a1-recording-instruments.md` plans verdict recording. It is not executable, so fourth-value handling is not applicable.
- `docs/superpowers/specs/2026-07-15-foreman-enhancement-design.md` designs verdict handling. It is not executable, so fourth-value handling is not applicable.
- `docs/superpowers/specs/2026-07-15-readme-deepening-design.md` designs verdict documentation. It is not executable, so fourth-value handling is not applicable.
- `docs/superpowers/specs/2026-07-31-v029-release-closeout-design.md` records verdict evidence requirements. It is not executable, so fourth-value handling is not applicable.

### Formal reports and generated graph records

- `formal/expectations.tsv` records an expected formal result about `WARNING`. It does not consume a runtime value.
- `formal/reports/M3-audit-gate.md` reports four-value model results. It is not executable, so fourth-value handling is not applicable.
- `formal/reports/M4-evidence-contract.md` describes the three-value model boundary. It is not executable, so fourth-value handling is not applicable.
- `formal/reports/VERIFY-quint-architect.md` records a `WARNING` counterexample. It is not executable, so fourth-value handling is not applicable.
- `graphify-out/GRAPH_REPORT.md` contains generated nodes from verdict documents. It is not executable, so fourth-value handling is not applicable.
- `graphify-out/graph.json` contains generated nodes from verdict documents. It is data, so a fourth value remains data.

### OpenSpec records

- `openspec/changes/archive/2026-07-18-docs-readme-refresh/ground-truth-inventory.md` records old verdict documentation. It is not executable.
- `openspec/changes/archive/2026-07-18-lifecycle-three-stage/auth-probes.md` records probe output. It is not executable.
- `openspec/changes/archive/2026-07-19-hard-mode-launcher/proposal.md` records a status word. It is not a verdict consumer.
- `openspec/changes/audit-groundedness-gate/design.md` designs three-value model output. It is not executable.
- `openspec/changes/audit-groundedness-gate/proposal.md` proposes three-value audit checks. It is not executable.
- `openspec/changes/audit-groundedness-gate/specs/gate/spec.md` specifies three-value audit checks. It is not executable.
- `openspec/changes/audit-groundedness-gate/tasks.md` lists three-value audit work. It is not executable.
- `openspec/changes/cross-vendor-audit-routing/specs/audit-routing/spec.md` specifies model verdict routing. It is not executable.
- `openspec/changes/doctrine-reality-drift/proposal.md` discusses `WARNING` doctrine. It is not executable.
- `openspec/changes/evidence-contracts/design.md` distinguishes outcome values. It is not executable.
- `openspec/changes/evidence-contracts/specs/evidence-contracts/spec.md` specifies evidence outcome values. It is not executable.
- `openspec/changes/evidence-contracts/tasks.md` lists evidence outcome work. It is not executable.
- `openspec/changes/formal-model-suite/proposal.md` proposes verdict models. It is not executable.
- `openspec/changes/formal-model-suite/specs/formal-models/spec.md` specifies verdict models. It is not executable.
- `openspec/changes/formal-model-suite/tasks.md` lists verdict-model work. It is not executable.
- `openspec/changes/graph-eval-falsification/design.md` discusses a `BLOCKED` review. It is not executable.
- `openspec/changes/readme-refresh/proposal.md` proposes verdict documentation. It is not executable.
- `openspec/changes/release-metrics/specs/release-metrics/spec.md` specifies verdict metrics. It is not executable.
- `openspec/changes/three-outcome-verdicts/design.md` specifies all four artifact values. It handles `UNVERIFIED` in the design.
- `openspec/changes/three-outcome-verdicts/proposal.md` proposes the fourth artifact value. It handles `UNVERIFIED` in the proposal.
- `openspec/changes/three-outcome-verdicts/specs/audit-verdict/spec.md` requires all four artifact values. It handles `UNVERIFIED` explicitly.
- `openspec/changes/three-outcome-verdicts/tasks.md` lists the fourth-value work. It handles `UNVERIFIED` explicitly.
- `openspec/changes/vendor-adapter-contract/specs/vendor-adapters/spec.md` specifies the three-value model adapter. It does not consume the harness artifact.

### Unrelated literal matches

- `formal/specs/lane_lifecycle.qnt` uses `WARNING` in a source comment. It is not a verdict consumer.
- `skills/foreman/scripts/fm-session.py` prints an orphan-store warning. It is not a verdict consumer.
- `skills/graphify/SKILL.md` prints graph-health warnings. It is not a verdict consumer.
- `skills/ste/SKILL.md` defines the word `WARNING` for safety text. It is not a verdict consumer.
- `skills/superpowers/RELEASE-NOTES.md` uses `BLOCKED` for implementer status. It is not an audit-verdict consumer.
- `skills/superpowers/docs/superpowers/specs/2026-06-10-strict-cost-sdd-design.md` uses `BLOCKED` for implementer status. It is not an audit-verdict consumer.
- `skills/superpowers/scripts/sync-to-codex-plugin.sh` prints repository warnings. It is not a verdict consumer.
- `skills/superpowers/skills/subagent-driven-development/SKILL.md` uses `BLOCKED` for implementer status. It is not an audit-verdict consumer.
- `skills/superpowers/skills/subagent-driven-development/implementer-prompt.md` uses `BLOCKED` for implementer status. It is not an audit-verdict consumer.
- `skills/superpowers/tests/claude-code/test-subagent-driven-development-integration.sh` prints a duration warning. It is not a verdict consumer.
- `skills/superpowers/tests/explicit-skill-requests/run-multiturn-test.sh` prints skill-order warnings. It is not a verdict consumer.
- `skills/superpowers/tests/explicit-skill-requests/run-test.sh` prints skill-order warnings. It is not a verdict consumer.
- `tests/probes/evidence-mechanism.sh` prints a digest warning. It is not a verdict consumer.
- `tools/ci-local.sh` prints a host-mutex warning. It is not a verdict consumer.

## T2 real state

**Verdict: IMPLEMENTED.** The artifact uses top-level provenance fields.
It does not use a nested object named `provenance`.

Command:

```text
rg -n 'provenance' skills/foreman/scripts/audit-run.sh skills/foreman/scripts/gate-eval.sh; printf 'rg_exit=%s\n' "$?"
```

Verbatim output:

```text
rg_exit=1
```

Thus, the reported zero occurrences are correct.
The behavioral artifact still contains `vendor`, `model`, `effort`, `started_at`, `ended_at`, and `duration_s`.

The shared probe also shows all five evidence fields.
It shows `diff_sha256`, `tree_sha256`, `base_sha`, `head_sha`, and `attempt`.

`ar_write_unverified` writes to a process-specific temporary path.
It then uses `mv -f` for the publish.
The success path uses the same temporary-file and rename pattern.

Command:

```text
flock /tmp/foreman-bats.lock bats tests/audit-verdict.bats
```

Verbatim output:

```text
1..26
ok 1 non-zero codex exit writes complete UNVERIFIED artifact
ok 2 timeout kills the whole audit process group and records timeout
ok 3 empty codex output writes complete UNVERIFIED artifact
ok 4 output with no JSON object writes complete UNVERIFIED artifact
ok 5 malformed JSON object writes no_json_object UNVERIFIED artifact
ok 6 out-of-vocabulary verdict writes complete UNVERIFIED artifact
ok 7 auditor worktree mutation writes complete UNVERIFIED artifact
ok 8 missing codex CLI writes missing_cli artifact and exits with missing-CLI status
ok 9 current UNVERIFIED in_progress attempt is published before codex finishes
ok 10 fresh in-progress publish replaces a stale APPROVED verdict
ok 11 artifact finding id is byte-identical to tl_finding_id
ok 12 consecutive UNVERIFIED attempts abandon at the cap and a real verdict resets the counter
ok 13 evidence_tree_sha256 is stable and includes an untracked file
ok 14 gate passes a complete current APPROVED verdict and current checks/docs
ok 15 gate rejects an audit verdict bound to a different diff
ok 16 gate rejects an audit verdict bound to a different evaluated tree
ok 17 gate rejects an audit verdict from a superseded attempt
ok 18 gate rejects an in-progress audit even when every identity matches
ok 19 UNVERIFIED and BLOCKED gate reasons remain distinct
ok 20 Abandoned audit-attempt state rejects an otherwise current APPROVED verdict under permissive policy
ok 21 stale checks-result diff cannot authorize a current APPROVED verdict
ok 22 stale docs-check diff cannot authorize a current APPROVED verdict
ok 23 stale checks-result tree cannot authorize a current APPROVED verdict
ok 24 stale docs-check tree cannot authorize a current APPROVED verdict
ok 25 default policy permits a low-only WARNING
ok 26 default policy rejects a medium WARNING and names the finding
```

Tests 1-10 cover the explicit audit outcomes and the pre-launch publish.
The source trace covers the common atomic writer and final success writer.

## T3 real state

**Verdict: IMPLEMENTED.** `audit.timeout_min` takes its default from `limits.round_timeout_min`.

Command:

```text
nl -ba skills/foreman/scripts/audit-run.sh | sed -n '55,63p;418,452p;488,493p'
```

Verbatim output:

```text
    55 
    56 WORKER_VENDOR="$(toml_get "$CONFIG" worker.vendor grok 2>/dev/null || echo grok)"
    57 CONFIGURED_AUDIT_VENDOR="$(toml_get "$CONFIG" audit.vendor codex 2>/dev/null || echo codex)"
    58 CONFIGURED_AUDIT_MODEL="$(toml_get "$CONFIG" audit.model gpt-5.6-sol 2>/dev/null || echo gpt-5.6-sol)"
    59 ROUND_TIMEOUT_MIN="$(toml_get "$CONFIG" limits.round_timeout_min 30 2>/dev/null || echo 30)"
    60 # A 30-minute fallback is intentionally generous: observed healthy audits have
    61 # taken 24–27 minutes. Fast-audit work belongs to v0.4.0, not this bound.
    62 AUDIT_TIMEOUT_MIN="$(toml_get "$CONFIG" audit.timeout_min "$ROUND_TIMEOUT_MIN" 2>/dev/null || echo "$ROUND_TIMEOUT_MIN")"
    63 MAX_AUDIT_ATTEMPTS="$(toml_get "$CONFIG" limits.max_audit_attempts 3 2>/dev/null || echo 3)"
   418 # awk preserves fractional minute values (the test fixture uses 0.02 = 1.2s).
   419 AUDIT_TIMEOUT_S="$(
   420   awk -v minutes="$AUDIT_TIMEOUT_MIN" \
   421     'BEGIN {
   422        if (minutes !~ /^[0-9]+([.][0-9]+)?$/ || minutes + 0 <= 0) minutes = 30
   423        printf "%.3f", minutes * 60
   424      }'
   425 )"
   426 
   427 set +e
   428 setsid codex exec \
   429   --model "$AUDIT_MODEL" \
   430   -c model_reasoning_effort=high \
   431   --sandbox read-only \
   432   --skip-git-repo-check \
   433   --cd "$WT" \
   434   --output-schema "$SCHEMA" \
   435   --output-last-message "$AUDIT_OUT_TMP" \
   436   - <"$PROMPT" 2>"$AUDIT_ERR_TMP" &
   437 AUDIT_CHILD_PID=$!
   438 # The watchdog stays in this script's own process group. A process-group
   439 # sweep therefore reaches it, and shellcheck can read the body. It ends by
   440 # itself when this script or the auditor goes away, so no external signal
   441 # is necessary. ar_reap_watchdog still kills it and its "sleep" by exact
   442 # PID on every ordinary exit path.
   443 (
   444   if ar_watchdog_wait "$AUDIT_TIMEOUT_S" "$AUDIT_CHILD_PID" "$$"; then
   445     printf 'timeout\n' >"$AUDIT_TIMEOUT_MARKER_TMP"
   446     mv -f "$AUDIT_TIMEOUT_MARKER_TMP" "$AUDIT_TIMEOUT_MARKER"
   447     # The auditor leads its own setsid process group. Signal the whole
   448     # group first. Escalate after 0.25 seconds, because a descendant
   449     # can ignore TERM.
   450     kill -TERM -- "-$AUDIT_CHILD_PID" 2>/dev/null || true
   451     sleep 0.25
   452     kill -KILL -- "-$AUDIT_CHILD_PID" 2>/dev/null || true
   488 if [[ "$TREE_SHA_AFTER" != "$TREE_SHA" ]]; then
   489   ar_fail "$EXIT_FAIL" worktree_mutation "auditor mutated the worktree — audit invalid"
   490 fi
   491 if [[ -f "$AUDIT_TIMEOUT_MARKER" ]]; then
   492   ar_fail "$EXIT_FAIL" timeout "codex audit exceeded ${AUDIT_TIMEOUT_MIN} minute timeout"
   493 fi
```

Behavioral command and output:

```text
bats --show-output-of-passing-tests --filter '^T3:' /tmp/t1-premise-probe.bats
```

```text
1..1
ok 1 T3: timeout kills descendant and records duration
# timeout={"verdict":"UNVERIFIED","state":"complete","reason":"timeout","duration_s":2,"evidence":{"diff_sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","base_sha":"d529aa3c5061a409b999bc7c6405dca1fe90e0d8","head_sha":"d529aa3c5061a409b999bc7c6405dca1fe90e0d8","attempt":1,"tree_sha256":"79191907f6b9f78a25e6095a2157f1bab4fae306714a0bebed913f00046b5d76"}}
# descendant_pid=237 descendant_state=dead
```

The full shared output contains the actual run.
The filtered output above shows the same recorded values.

## T4 real state

**Verdict: IMPLEMENTED.** The gate computes three current identities.
It also requires the artifact state to be `complete`.

Command:

```text
nl -ba skills/foreman/scripts/gate-eval.sh | sed -n '44,74p;121,137p'
```

Verbatim output:

```text
    44 CURRENT_DIFF_SHA=""
    45 CURRENT_DIFF_VALID=false
    46 if CURRENT_DIFF_SHA="$(tl_diff_sha256 "$WT" "$BASE_SHA")"; then
    47   CURRENT_DIFF_VALID=true
    48 else
    49   REASONS+=("gate diff hash computation failed (cannot bind gate inputs)")
    50 fi
    51 
    52 CURRENT_TREE_SHA=""
    53 CURRENT_TREE_VALID=false
    54 tree_tmp="$(mktemp)"
    55 if evidence_tree_sha256 "$WT" >"$tree_tmp"; then
    56   CURRENT_TREE_SHA="$(<"$tree_tmp")"
    57   CURRENT_TREE_VALID=true
    58   rm -f "$tree_tmp"
    59 else
    60   tree_reason="${EVIDENCE_REASON:-tree-identity-uncomputable}"
    61   rm -f "$tree_tmp"
    62   REASONS+=("gate evaluated-tree identity computation failed ($tree_reason)")
    63 fi
    64 
    65 CURRENT_ATTEMPT=""
    66 CURRENT_ATTEMPT_VALID=false
    67 if [[ -r "$RD/audit-attempt.current" ]]; then
    68   CURRENT_ATTEMPT="$(<"$RD/audit-attempt.current")"
    69   if [[ "$CURRENT_ATTEMPT" =~ ^[0-9]+$ ]]; then
    70     CURRENT_ATTEMPT_VALID=true
    71   fi
    72 fi
    73 if [[ "$CURRENT_ATTEMPT_VALID" != "true" ]]; then
    74   REASONS+=("audit current attempt id computation failed (audit-attempt.current missing or malformed)")
   121   audit_diff="$(jq -r '.evidence.diff_sha256 // empty' "$RD/audit-verdict.json")"
   122   audit_tree="$(jq -r '.evidence.tree_sha256 // empty' "$RD/audit-verdict.json")"
   123   audit_attempt="$(jq -r '.evidence.attempt // empty' "$RD/audit-verdict.json")"
   124   audit_state="$(jq -r '.state // empty' "$RD/audit-verdict.json")"
   125   if [[ "$CURRENT_DIFF_VALID" == "true" && "$audit_diff" != "$CURRENT_DIFF_SHA" ]]; then
   126     REASONS+=("audit verdict diff hash mismatch (stale verdict for a different diff)")
   127   fi
   128   if [[ "$CURRENT_TREE_VALID" == "true" && "$audit_tree" != "$CURRENT_TREE_SHA" ]]; then
   129     REASONS+=("audit verdict evaluated-tree mismatch (worktree changed since the audit ran)")
   130   fi
   131   if [[ "$CURRENT_ATTEMPT_VALID" == "true" ]] \
   132     && { [[ ! "$audit_attempt" =~ ^[0-9]+$ ]] || (( 10#$audit_attempt != 10#$CURRENT_ATTEMPT )); }; then
   133     REASONS+=("audit verdict attempt superseded or unfinished (a fresher or still-running audit exists)")
   134   fi
   135   if [[ "$audit_state" != "complete" ]]; then
   136     REASONS+=("audit verdict incomplete (state is not complete)")
   137   fi
```

Behavioral command and output:

```text
bats --show-output-of-passing-tests --filter '^T4:' /tmp/t1-premise-probe.bats
```

```text
1..1
ok 1 T4: four verdict bindings have distinct reasons
# baseline_status=0 baseline_reasons=[]
# diff_reason=audit verdict diff hash mismatch (stale verdict for a different diff)
# tree_reason=audit verdict evaluated-tree mismatch (worktree changed since the audit ran)
# attempt_reason=audit verdict attempt superseded or unfinished (a fresher or still-running audit exists)
# state_reason=audit verdict incomplete (state is not complete)
```

The full shared output contains the actual run.
The baseline passes only when all four bindings match.

## Verification

Commands:

```text
test -f docs/evidence/v029-plan2/t1-premise-check.md && echo "evidence written"
git status --porcelain
```

Verbatim output:

```text
evidence written
?? SPEC-plan2-t1.md
?? docs/evidence/v029-plan2/
```

The second status entry is the one file from this check.
Git collapses an untracked directory to one status entry.

`SPEC-plan2-t1.md` was present before this check started.
This check did not create, edit, or delete it.

Additional scope command:

```text
find docs/evidence/v029-plan2 -type f -print
```

Verbatim output:

```text
docs/evidence/v029-plan2/t1-premise-check.md
```

The file uses LF line endings.
