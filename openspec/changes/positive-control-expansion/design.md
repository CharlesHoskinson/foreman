# Design: positive-control expansion

## Boundary

Reuse the v0.2.9 full-tree scanner, literal TSV parser, comparator, and control
record format. Add one recognizer class at a time.

Do not infer check identity from output keywords. A probe identity comes from a
named function that records a tool or environment verdict. A verdict-predicate
identity comes from a named function or annotated call site that parses an
outcome token.

## Order

1. Measure the candidate probe inventory.
2. Add fail-capable recognizer fixtures.
3. Add paired control evidence and registry rows in bounded batches.
4. Make probe completeness enforcing only after every row passes.
5. Repeat the process for verdict predicates.

## Assertions

Do not build an exhaustive assertion registry. The assertion count makes the
registry a maintenance burden that can hide rather than improve test quality.
An individual assertion still needs a failing test or known-bad arm before its
owning package treats it as evidence.

## Authority

The scanner derives inventory from the repository at the commit under test.
The committed registry supplies human-authored evidence bindings. Foreman runs
the comparator. Council can review a committed bundle but remains advisory.
