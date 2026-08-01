# Tasks — spec-triage-gate

Implementer: Sonnet 5 · Audit: Opus 4.8.

- [ ] **1. `spec-triage.sh` (TDD)** — write the failing bats fixtures first (a
  determined spec passes; an exploratory spec refuses; a declared-determined-
  but-discovery-phrase spec still refuses; PLUS the audit's false-positive
  regression guards: a determined spec merely containing "explore"/"discover
  the dirty file set" passes; a determined spec with an unrecognized-but-real
  verification command — `cargo build`, `make check`, `python -m http.server`,
  `shellcheck …` — passes; a determined spec with empty/parenthetical-only
  verification still refuses); implement
  `skills/foreman/scripts/spec-triage.sh SPEC_FILE` per the design's narrow,
  anchored classification rules (no bare-verb matching, no command
  allow-list); shellcheck-clean.
- [ ] **2. `five-part-spec.md`** — add the required `## Meta` line
  `determinability: determined | exploratory | hybrid` to the template, with
  doctrine: an `exploratory`/`hybrid` spec MUST go through `foreman-discover`
  first; a spec you cannot finish writing the Verification for is not
  `determined`.
- [ ] **3. Wire into `grok-implementer.md` Preflight (soft)** — after the
  `grok --version` check, run `spec-triage.sh <spec>`; on refusal, STOP and
  return `GROK REPORT / STATUS: refused / REASON: spec under-determined —
  route to foreman-discover` — never run grok on an under-determined spec.
- [ ] **4. Wire into `worker-run.sh` (hard)** — before building the worker
  argv, run the gate on the spec/`task.md`; on refusal, `el_emit "$RUN" alert
  "$LANE" '{"kind":"spec_underdetermined"}'` + `die EXIT_CONFIG` with the
  route-to-discover hint (mirrors the grok-secrets refusal shape); guard so
  this only applies to implementer-lane dispatch, not `foreman-discover`'s
  own.
- [ ] **5. Wire into `lane-run.sh`'s `LANE_VENDOR=grok` branch (durable third
  path — audit correction)** — inside the existing `if [[ "$LANE_VENDOR" ==
  "grok" ]]; then` block (`lane-run.sh:344`, beside
  `lane_grok_secrets_scan`), run the gate on the lane's spec; on refusal,
  mirror the neighbouring shape exactly: `el_emit "$RUN" alert "$LANE"
  '{"kind":"spec_underdetermined"}'` then `exit "$EXIT_CONFIG"`, CMD never
  spawned. Gated on `LANE_VENDOR=="grok"` only; the unset-`LANE_VENDOR`
  frozen path stays byte-unaffected. This closes the third grok door the
  audit flagged as previously ungated.
- [ ] **6. Document C4 honestly (doctrine, NOT an enforced gate)** — in
  `five-part-spec.md`/`roles.md`: after `foreman-discover` converges, the
  architect SHOULD re-run the gate on the implementation sub-specs and
  OFFLOAD the now-`determined` slices to grok rather than self-implementing.
  State plainly that foreman CANNOT enforce this — there is no coded gate on
  the architect's own edits; C1 only *admits* an offloaded sub-spec, it does
  not *compel* one. C4's only signal is the `workload-fit-accounting`
  package's C5 fit-report (a low offload fraction flags the poor cost-fit).
  Do NOT write "the gate enforces admission" or "enforces offload" — that
  claim is withdrawn per the audit.
- [ ] **7. Verify** — bats green under the mutex (incl. all false-positive
  regression guards); shellcheck-clean; `docs-check.sh` green; commit per the
  plan's two commit messages (`feat(triage): spec-triage.sh refuses
  under-determined specs...` / `feat(triage): gate all three grok dispatch
  paths on determinability; C4 re-triage doctrine`).

Acceptance: an under-determined spec (declared exploratory/hybrid/unset, OR
matching a narrow anchored discovery phrase, OR lacking concrete
verification — even when declared `determined`) is refused at ALL THREE grok
doors (`worker-run.sh`, `grok-implementer` preflight, `lane-run.sh`'s
`LANE_VENDOR=grok` branch) (`alert{kind:"spec_underdetermined"}`, CMD never
spawned) with a route-to-foreman-discover hint; a determined spec containing
"explore"/"discover the dirty file set" or an unrecognized-but-real
verification command is NOT refused; a post-discovery `determined` sub-spec
passes the same gate and is *admitted* (not compelled) to grok; C4 is
documented as an unenforceable discipline measured by C5, never as an
enforced gate; grok-multiround/empty-burst detector unchanged; bats +
shellcheck + docs-check green.
