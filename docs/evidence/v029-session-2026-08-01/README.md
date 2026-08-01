# Session evidence — 2026-08-01 overnight run

Captured at the session boundary because these lived only in `/tmp` and would
have been lost when the machine changed. Verbatim, not edited.

| File | What it is |
|---|---|
| `audit-groundedness-gate-T1T2.audit.txt` | grok cross-vendor audit. WARNING, two HIGH findings: the canary's only evaluator was a test double keying on `basename`, and nothing bound it to a gate entrypoint. Two T2 checkboxes were withdrawn on the strength of it. |
| `cross-vendor-audit-routing-T3T4.audit.txt` | grok cross-vendor audit. First round BLOCKED — three of five findings were that the diff was empty, which was a packaging error on my side. Re-audited from file content: APPROVED. |
| `gate-ground-T3-and-four-classify.audit.txt` | grok cross-vendor audit of the real evaluator and the Setup launcher build. One HIGH closed, one HIGH refused; four defects on the launcher build, all since fixed. |
| `tier2-machinery.lane-report.txt` | Self-report of `origin/lane/tier2-machinery`, which is **unverified and unmerged**. Claims only. |
| `freshness-and-tier2.verification.txt` | Architect verification of the freshness lane (criterion 6). |

Every audit here was produced by **grok auditing codex-implemented work**, because
the cross-vendor invariant forbids codex auditing codex — which is also why
criterion 5, as written, cannot be satisfied (obligation 89).
