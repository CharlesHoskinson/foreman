# Captured facts

Use this artifact to record only facts established by empirical probes. Give
each fact a stable ID and cite its probe in the fact entry and in the
provenance table. Do not include a fact without probe evidence.

## Resolved interfaces

Repeat this block for every resolved API or SDK call.

### IF-001 — Interface name

- **Real signature:** `replace with the observed API or SDK signature`
- **Sample request:** `replace with the request sent by the probe`
- **Sample response:** `replace with the response observed by the probe`
- **Probe:** `replace with the probe command, script, or evidence path`

## Observed behavior

Repeat this block for every empirical behavior.

### BH-001 — Behavior name

- **Finding:** Replace with the observed behavior.
- **Probe:** `replace with the probe command, script, or evidence path`

## Constraints discovered

Repeat this block for every discovered constraint.

### CT-001 — Constraint name

- **Constraint:** Replace with the concrete, testable constraint.
- **Probe:** `replace with the probe command, script, or evidence path`

## Provenance

Every fact ID above must have exactly one row. Record when the probe ran and
the result that supports the fact; the artifact itself is not evidence.

| Fact ID | Probe | Observed at | Evidence or result |
|---|---|---|---|
| IF-001 | `probe command, script, or evidence path` | `YYYY-MM-DDTHH:MM:SSZ` | `observed result` |
| BH-001 | `probe command, script, or evidence path` | `YYYY-MM-DDTHH:MM:SSZ` | `observed result` |
| CT-001 | `probe command, script, or evidence path` | `YYYY-MM-DDTHH:MM:SSZ` | `observed result` |
