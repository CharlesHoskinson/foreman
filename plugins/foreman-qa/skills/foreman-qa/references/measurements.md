# Measurement provenance — 2026-08-07

The C1 lane declined to assert two figures it could not trace to a repository
artifact, and asked for the source. It was right to: under this plugin's own
doctrine a figure without a reproducible command is a claim, not evidence. This
file is that source. Every number below carries the command that produces it, so
a reader re-measures rather than trusts.

## session.bats assertion counts

Run from the repository root:

```bash
grep -cE '\[\[ "\$output" ==' tests/session.bats
```

Output: `61`

```bash
awk '
  /^@test/ { intest=1; has=0; n++ }
  intest && /\[\[ "\$output" ==/ { has=1 }
  /^\}/ { if (intest && has) w++; intest=0 }
  END { printf "%d of %d tests assert on printed output\n", w, n }
' tests/session.bats
```

Output: `27 of 34 tests assert on printed output`

Supporting counts: `grep -c '^@test' tests/session.bats` is `34`;
`grep -cE '\[ "\$status"' tests/session.bats` is `45`.

Why this was measured: a prior review recorded that the file has "zero
output-content assertions" and concluded a port could emit entirely different
stdout and still pass. The commands above refute that. The first test in the
file asserts `[[ "$output" == *"last session: (none"* ]]`.

## Claim-provenance tally

The rule "findings from executing code outrank findings from reading it" is
generalised from this specific comparison, made against one review document on
2026-08-06/07. It is a small sample and is stated as a ranking, not a law.

Execution-derived claims, all confirmed:

| Claim | Confirming command |
|---|---|
| Unguarded recursion throws a raw `RangeError` | Called `parseJsonRejectDuplicateKeys` and `canonicalize` at nesting depth 20000; both threw `RangeError: Maximum call stack size exceeded`. Depth 2000 returned normally. |
| `normalizeAbsolutePath` collapses a trailing backslash | `normalizeAbsolutePath("/tmp/x\\")` and `normalizeAbsolutePath("/tmp/x")` both returned `"/tmp/x"`. |
| `decodeUtf8Fatal` strips a UTF-8 BOM | Bytes `ef bb bf 7b 7d` decoded to `"{}"`, length 2; `sha256(bytes)` `aa25e978046d680e...` vs `sha256(text)` `44136fa355b3678a...`. |
| Unthrottled spawn fallback discards vendor caps | `queue-admission.ts` `cmdAdd`: `if (pueueBin === null)` calls `proc.runForeground(...)` with no cap, while `FIXED_GROUPS` declares grok 3, codex 2, misc 2, gate 1, agy 1. |
| Race-hook setters reach the public surface | `grep -n RaceHook packages/orchestration/src/index.ts` lists three setters and three types. |

Inspection-derived counts, all found wrong:

| Claim | Measurement |
|---|---|
| `lane-queue.bats` is "14 pass / 2 skip / 7 fail" | Measured twice: `21 pass / 0 fail / 2 skip`, matching its baseline of 21 with delta 0. |
| `session.bats` has "zero output-content assertions" | 61, across 27 of 34 tests. See above. |
| A vendored skill gained "nine unrelated lines, an arXiv pattern" | 17 lines, a Microsoft Learn pattern plus a GitHub issue-comments note, added in a commit whose own message declares them. |

The point is not the ratio. It is that each execution-derived claim carried a
command anyone could re-run, and each inspection-derived one did not.
