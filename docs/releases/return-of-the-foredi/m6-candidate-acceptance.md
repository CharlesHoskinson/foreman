# M6 candidate acceptance

Candidate `f734d99caf17c3ac5e958a161627eecdc6e43494` is not accepted as the completed release.
Its implementation and installation checks pass, but both simplification targets fail.
The [machine-readable record](m6-candidate-acceptance.json) binds the commands, archive, and source measurements.

## Package and workflow

Two archive productions produce the same build ID and SHA-256.
Build ID: `88c6037187059511ef0109c7675b6c23e1480e2514de495b9b50d701a83cc62f`.
Archive SHA-256: `f705be1033212716e7793550249cd43819472a719b29dfbf5616dfaac79358ce`.
The package remains unversioned.

The actual archive installs under umask 027 into an isolated home.
All 19 installed-product checks pass without a source checkout or external vault in the child environment.
These checks include executable invocation, exact package identity, all shipped examples, provider listing, and portable research queries.

The configured-run test uses source and snapshot bytes from that verified archive.
It writes real project configuration and completes one implementation, one verification, and one independent review.
It preserves the package manifest and labels the result `test-fixture`.
Product invocation rejects fixture authority with the exact expected diagnostic and zero execution effects.
This test does not establish live model readiness.

## Measured simplification

| Measure | Frozen baseline | Candidate | Required reduction | Observed change |
| --- | ---: | ---: | ---: | ---: |
| Production nonblank lines | 6,916 | 48,873 | At least 40% | 606.67% growth |
| Required instruction tokens | 16,502 | 17,477 | At least 50% | 5.91% growth |

The metric command exits 1 and retains its complete report.
The fixed cohort, tokenizer, exclusions, and thresholds remain unchanged.
Production counts include full changed files and the language, provider, research, installation, and measurement implementations.
Deleting twelve shell entries does not establish net simplification.

The [source complexity audit](m6-source-complexity-audit.md) separates 30,215 new lines from 18,658 retained lines counted in full.
Ordinary deduplication cannot close the 44,724-line gap to the permitted integer maximum.
Its three concrete simplifications estimate 1,750–3,150 deleted lines, subject to unchanged behavioral tests.
These estimates are proposals, not completed reductions.

The instruction measurement includes actual rendered output through the first standard task's Grok prompt.
The trace uses the real adapter serializer with an explicitly finite process fixture.
It preserves transmitted system instructions, output schema, and session prompt bytes.
Its required corpus includes all surviving baseline instruction files and the complete quickstart.

The trace records three commands after prerequisites, one start command, and one entry point.
Workflow-loop, provider-conditional, active-owner, and authoritative-history counts remain unknown in this report.
Separate durable execution tests do not silently fill those measured fields.

## Remaining work

Reduce implementation complexity and mandatory startup output without weakening features or changing measurement rules.
Complete the candidate graph extraction and preserve its coverage limits.
Keep unavailable exact model qualification explicit.
Reconcile the numerical release through the existing release program before publication.
