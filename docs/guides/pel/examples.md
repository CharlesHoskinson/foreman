# Use the installed examples

The package contains eight canonical workflows under `examples/pel`. Check and plan a source before admission:

```text
foreman check examples/pel/implement-verify-review.pel
foreman plan examples/pel/implement-verify-review.pel
```

| File | Behavior and prerequisites |
| --- | --- |
| `implement-verify-review.pel` | Implement, run the registered full gate, then obtain independent review. Requires existing task authority and an approved input artifact. |
| `parallel-read.pel` | Read two immutable research bundles concurrently. Requires both configured bundle bindings. |
| `repair-and-publish.pel` | Apply bounded corrections, verify and review each candidate, then use a separately authorized destination. |
| `race-cancel.pel` | Evaluate two task contenders under separate workspace grants. Persist the winner and reconcile an unknown loser. |
| `resume-checkpoint.pel` | Retain a named checkpoint before the standard task. Resume uses the original run ID and completed receipts. |
| `research-prepare.pel` | Read the registered release-source bundle as advisory context. |
| `conditional.pel` | Select source-defined branches under the admitted predicate policy. |
| `repair.pel` | Show corrected keyword argument syntax after an authoring error. |

The standard workflow uses `role:implementer` and `role:reviewer`. Configure Grok 4.6 and GPT 5.6 Sol for those roles to reproduce the default sequence. To use GPT 6 Astra and Claude Opus 5, change only those role bindings in project settings. The same source continues to select the registered full gate and independent review policy.

## Configure concrete project inputs

`project-settings.json` is a schema-shaped example. Its `/absolute/...` paths, zero hashes, directory identities, artifact lengths, and UUID are placeholders. Replace them with the existing registered repository, execution authority, immutable artifact references, admitted worktree identities, full gate command, and credential references. Do not run the example unchanged.

Keep the original authority's budgets and write scope. Project limits can narrow them. For a two-task race, register two isolated worktrees at the same immutable base and admit both grants. A task implementation does not create its own write or publication authority. Artifact references must resolve through registered project input bytes; they are not arbitrary filesystem paths.

```text
foreman project configure --settings project-settings.json
foreman run implement-verify-review.pel --json
```

Configuration occurs once for each concrete project setup. Active runs retain their original settings. Later configuration changes do not alter recovery inputs.

## Select an exact profile

The `profiles` directory contains explicit examples for `grok-4.6`, `claude-opus-5`, `claude-fable-5-1`, `gpt-6-astra`, `gpt-5.6-sol`, and `gemini-3.8-flash`. Each source fixes its transport. These examples show exact selection syntax; they do not promise native coding support for every cell. Gemini native coding is currently unsupported. Missing credentials, capability evidence, or an enforced native boundary cause admission failure. No profile fallback occurs.

Use `foreman providers list --json` to inspect current exact cells. Source files contain credential references only through their configured selections. Keep credential values outside the package and source repository.

`repair.pel` and the six profile examples perform task execution and candidate capture only. The sample contract also requires verification and review. These examples return needs-action for those missing milestones. Recorded example tests use explicit fixture transports and do not establish live qualification.

The conditional example first captures a task candidate, then verifies it. It requests review only after successful verification. A failed verification remains visible in its result.

## Recover a run

```text
foreman status RUN_ID --json
foreman resume RUN_ID --json
```

Use the recorded next action for unknown external outcomes. A persisted winner stays selected after resume. A checkpoint is durable evidence; it is not a command to repeat completed provider work. See [support](support.md) for safe diagnostic export and [research](research.md) for advisory context limits.

To stop an active run, use `foreman cancel RUN_ID` separately. A cancelled run does not become a resumable pending run.
