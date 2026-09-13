# Pel authoring

Use Node.js 24 to run the built authoring entry.

```text
node skills/foreman/runtime/dist/foreman.js check examples/pel/implement-verify-review.pel
node skills/foreman/runtime/dist/foreman.js plan examples/pel/implement-verify-review.pel --json
```

`check` validates source against the admitted snapshot. `plan` returns a derived preview.
Neither command runs the host operations in the source.

The default snapshot resides in `assets/pel/default-authoring-snapshot.json`, relative to the runtime root.
The current directory does not select the default snapshot.
Use `--context FILE` to select another complete snapshot.
Use `--selection FILE` to select admitted roles, predicate profiles, dependency mode, result contract, or narrower limits.
Both files require JSON with unique keys and validated content.

Successful check output is `FILE: valid Pel` followed by a newline.
With `--json`, successful check output is exactly:

```json
{ "schemaVersion": 1, "tag": "ok", "warnings": [] }
```

A successful plan prints one `PlanPreviewV1` object.
The object contains the source and snapshot binding, effects, dependencies, dynamic regions, diagnostics, limits, and final value summary.
Unknown values contain an unresolved reason and source span.
Human plan output uses indentation. JSON mode uses one compact object.

| Source                                          | Check exit | Preview                                                                 |
| ----------------------------------------------- | ---------- | ----------------------------------------------------------------------- |
| `implement-verify-review.pel`                   | 0          | Task, verification, and review effects in value order                   |
| `conditional.pel`                               | 0          | Verification and conditional review, with the unresolved Boolean branch |
| `parallel-read.pel`                             | 0          | Two read effects from separate admitted source bundles                  |
| `repair.pel`                                    | 0          | One task effect with named arguments                                    |
| `packages/pel/test/fixtures/repair-invalid.pel` | 2          | No accepted preview, with `PEL_ARGUMENT_MODE`                           |

Diagnostics show the filename, line, column, source line, caret range, and cause.
Registered usage appears when the diagnostic supplies a signature.
JSON errors contain `schemaVersion`, `tag`, `code`, `message`, `exitCode`, and available structured diagnostics.
JSON mode sends no diagnostic text to stderr.

## Explicit generation

```text
foreman plan --prompt "Implement the approved change and request review" --model gpt-6-astra --transport openai-responses
```

Generation requires an installed provider implementation for the selected exact model and transport.
M2 supplies the port and local validation loop. It does not supply a live transport.
The command accepts `--controls FILE`, `--credential-profile REFERENCE`, and `--grammar-mode auto|grammar-required|envelope`.
Controls must match the selected profile. Generation requires `toolChoice` equal to `none`.
A missing control override uses the admitted application defaults with the no-tools generation policy.
Credentials remain opaque account references.

Default generation output writes exact Pel source to stdout. The preview, attempt count, provider identities, and cumulative usage go to stderr.
Use shell redirection to save source explicitly.
With `--json`, stdout contains one generated-plan object, including source, preview, attempt count, provider identities, and cumulative usage.
Generation accepts the first locally valid source. It permits at most two repair calls.
It does not execute the generated program.

## Draft commands

```text
foreman plan examples/pel/repair.pel --interactive
```

The session retains drafts only in memory. It does not write the source or history automatically.
`show` displays source and current node IDs. Completion uses the immutable registry and draft command names.

| Command                      | Result                                                            |
| ---------------------------- | ----------------------------------------------------------------- |
| `show`                       | Display source and node spans                                     |
| `check`                      | Validate the current draft                                        |
| `preview`                    | Display the current derived preview                               |
| `history`                    | Display retained revision numbers, digests, and byte counts       |
| `undo`                       | Restore the previous retained source                              |
| `replace-expression NODE-ID` | Replace exactly one parsed expression                             |
| `replace-suffix NODE-ID`     | Replace source from a top-level expression                        |
| `replace-program`            | Replace all source                                                |
| `repair`                     | Request provider correction with the selected model and transport |
| `export`                     | Write exact current source to stdout                              |
| `abort`                      | Close the session                                                 |

Terminate each replacement fragment with a line containing only `.end`.
Replacement commands check each new revision. Invalid drafts remain available for correction.
The session retains at most 100 revisions and 16 MiB of source bytes.
`history` shows the oldest available revision number after older revisions expire.
Run-bound continuations fail with `PEL_DRAFT_EXECUTED`.

Exit codes are 0 for success, 1 for generation failure, 2 for invalid input, and 4 for cancellation.
Authoring does not use exit codes 3 or 5.
The production entry rejects `--fixture-manifest`. Only the separately compiled test entry accepts fixture manifests.
