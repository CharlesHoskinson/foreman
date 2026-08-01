# Captured-facts convergence

`captured-facts.md` is the convergence artifact for empirical discovery. It
turns live observations into resolved interfaces and constraints from which an
architect can write a determined implementation spec. Use the
[captured-facts template](../templates/captured-facts.md).

## Artifact contract

Each resolved interface, observed behavior, and discovered constraint has a
stable fact ID and cites the exact probe that established it. The provenance
table maps every fact ID to that probe, when it ran, and its evidence or result.
A statement without a cited probe is an unproven claim and must not be included.

The probe is the evidence. The convergence artifact organizes that evidence;
it does not make an observation true merely by recording it.

## Inline facts into implementation specs

This workflow formalizes the existing
[single-burst inline-first/write-first doctrine](../../../agents/grok-implementer.md#single-burst-write-first-specs);
it does not replace or newly introduce that rule. When composing a Grok
implementation sub-spec, the architect must copy the relevant resolved
signatures, sample request and response shapes, and discovered constraints
directly into the sub-spec's `## Interfaces` and `## Constraints` sections.

Do not make the worker read `captured-facts.md` before writing. A reference to
the artifact recreates the reads-first failure mode: the single burst can be
spent orienting and end without a write. A determined sub-spec carries the
facts it needs inline, so its first action can be a concrete write with zero
repository reads first.

## Worked discovery-derived sub-spec

The example below inlines the resolved signature and constraint. It does not
require the worker to open a discovery artifact or inspect the repository.

````markdown
## Objective
First, write `src/ledger-client.ts` with the client described below.

## Files
- create: `src/ledger-client.ts`

## Interfaces
Probe P-06 established the call shape `GET /v1/notes?owner={hex}`.

- Sample request: `GET /v1/notes?owner=0a1b`
- Sample response: `{ "notes": [{ "id": "f3", "value": 12 }] }`
- Provenance: probe P-06, run `2026-07-19T14:32:00Z`, returned the sample
  response above with HTTP 200.

## Constraints
- The request SHALL use a lowercase hexadecimal `owner` value; probe P-07,
  run `2026-07-19T14:35:00Z`, returned HTTP 400 for uppercase input.
- The implementation SHALL require zero repository reads before its first
  write.

## Verification
```bash
npm test -- ledger-client
```
````

After the sub-spec is written, its normal verification and triage controls
remain responsible for deciding whether it is ready to dispatch.
