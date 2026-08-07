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
| `lane-queue.bats` is "14 pass / 2 skip / 7 fail" | **This refutation was itself wrong.** Both figures are correct, for different trees: on `main`, where the implementation is shell, `21 pass / 0 fail / 2 skip`; on the migration branch, where a TypeScript port replaces it, `14 pass / 7 fail / 2 skip`. I measured `main` and refuted a claim that was about the branch. See "A figure carries a tree" below. |
| `session.bats` has "zero output-content assertions" | 61, across 27 of 34 tests. See above. |
| A vendored skill gained "nine unrelated lines, an arXiv pattern" | 17 lines, a Microsoft Learn pattern plus a GitHub issue-comments note, added in a commit whose own message declares them. |

The point is not the ratio. It is that each execution-derived claim carried a
command anyone could re-run, and each inspection-derived one did not.

## A figure carries a tree, not just a command

The rule above -- record the command beside the number -- is not sufficient. The
same command produces different, equally correct numbers on different refs, and
a refutation run on the wrong ref refutes nothing.

Worked case. A review recorded `lane-queue.bats` as `14 pass / 2 skip / 7 fail`.
Running the suite on `main` gave `21 pass / 0 fail / 2 skip`, so the claim was
recorded as false and that "correction" was propagated into this plugin, into an
operating prompt, and into two commit messages. Then the migration branch was
merged and the same file measured `14 pass / 7 fail / 2 skip` -- the original
figure, exactly. The failing test names matched the original diagnosis too:
POSIX quoting dialect, `shell_command` override classification, and the
`FORCE_MISSING` fallback.

The claim was about the branch. The refutation was about `main`. Nothing was
wrong with either measurement.

So: state the ref beside the number, and before refuting an inherited claim, ask
which tree it was made on. A claim about code that has not merged cannot be
tested on the branch that lacks it. This is the same failure as citing CI for a
path CI never reaches, one level up: right command, wrong world.
