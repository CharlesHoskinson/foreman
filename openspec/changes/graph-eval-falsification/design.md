# Design: graph evaluation boundary

## Run-set authority

The evaluator accepts one canonical LF-terminated JSON file with schema
`foreman.graph-evaluation-run-set.v1`. The file declares exactly 2,000 planned
runs. Recorded observations contain only a pair identifier, an arm, and an
outcome.

Pair identifiers are integers from 1 through 1,000. Each pair has one
`baseline` slot and one `graph` slot. Observations are strictly ordered by pair
and then arm. This order makes duplicate or ambiguous slots invalid.

An outcome is `PASS`, `FAIL`, or `UNAVAILABLE`. A slot without an observation
is counted as not run. The complete file digest is the run-set identity.

## Verdict

The evaluator accounts for all planned slots:

```text
completed + unavailable + not-run = 2,000
```

It returns `GRAPH_OFF_UNCOMPUTABLE` when any slot is unavailable or not run.
It returns `PROMOTE` only when all 2,000 slots completed and the graph arm has
more passes than the baseline arm. A measured graph loss returns
`GRAPH_OFF_FAILED`. A tie returns `GRAPH_OFF_INCONCLUSIVE`.

The graph default is `on` only for `PROMOTE`. Every other result keeps it off.
This rule prevents a missing denominator from becoming an implicit pass.

## File and process boundary

The source API is total and returns a closed invalid result for hostile input.
The decoder rejects files larger than 16 MiB, malformed UTF-8, missing or CRLF
termination, duplicate JSON keys, noncanonical JSON, unknown fields, invalid
enums, invalid identifiers, duplicate slots, and more than 2,000 observations.

The command has one exact form:

```text
graph-evaluation report --run-set ABS
```

It reads one regular absolute-path file, writes one canonical report line, and
does not write repository or state files. Invalid arguments return exit 64.
Invalid input returns exit 1 with one fixed diagnostic.

## Release result

v0.4 has no completed paired model observations. Its checked-in run set is
canonical and contains zero observations. The generated report accounts for
all 2,000 slots as not run, returns `GRAPH_OFF_UNCOMPUTABLE`, and keeps graph
context off by default.

This negative result does not block the release. It blocks only claims that
graph context improves task outcomes and blocks automatic context injection.
The explicit Track 7 command remains available for opt-in use.

## Deferred work

Future measurements may add task corpora, token and cost matching, confidence
intervals, vendor comparisons, serializer sweeps, and longer observation
windows. Those additions must preserve the canonical run-set boundary and must
not revise a completed run after its result is known.
