# Migrate a registered legacy workflow

Use the installed Foreman command from the registered project checkout:

```text
foreman migrate round-v1.json --contract contract-v1.json --out workflow.pel
```

The command writes `workflow.pel` and `workflow.pel.parity.json`. Both paths must be new. The output directory must exist. The command refuses symlinks and does not replace an existing file. The parity file contains the emitted source hash, original input hashes, registered binding hash, contract hash, model and transport identities, workspace scope, gate argv digest, limits, and required milestones.

Read the source and parity file before you run the program:

```text
foreman check workflow.pel
foreman run workflow.pel
```

Keep the original registered contract, project scope, model roles, gate, and immutable specification in effect. Migration does not create authority or reset ledger counters. The execution service checks remaining authority and budget again when the program runs.

## Supported inputs

The importer accepts RoundPlanV1 schema version 1 with ExecutionContractV1 schema version 1. Two closed templates are available:

| Registered template | Result |
| --- | --- |
| `implement-verify-review` | One task, host checks, and independent review |
| `bounded-rework` | The same assessment with at most one correction; publication requires existing authority |

The command vector must match the registered Grok implementation template exactly. Only the prompt path and workspace root are typed path slots. The prompt basename and report path identify the template: `implement-verify-review.md` with `reports/implement-verify-review.md`, or `bounded-rework.md` with `reports/bounded-rework.md`. The prompt bytes must equal the immutable text in the registered `artifact:approved-spec` snapshot descriptor.

The workspace path and base must match an existing grant. The implementation role must resolve to `grok-4.6` through `grok-acp`. The independent review role must resolve to `gpt-5.6-sol` through `codex-app-server`. Credential references come from the registered project. The gate is `candidate-full`. Its legacy command must be exactly `/usr/bin/git -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check`. The existing registered argv must have the same digest as the packaged mapping. The importer compares the original command bytes; it does not parse or evaluate shell syntax.

The report baseline must be absent. Required milestones are `checks` and `audit`. Dependency contracts, additional workflow fields, and other argv shapes have no import mapping. A bounded-rework import also requires the registered `correct` task action and the original correction allowance. The publication call in its output can return needs-action; import does not grant publication permission.

The installed package supplies the trusted template files. A `registered-command-bindings.json` file beside the input is not authority and is never read. The live importer binds the approved slots to the existing project and exact ledger contract. It does not infer a weaker workflow from an unfamiliar command.

## Active and historical runs

An active legacy run keeps its current controller. Migration returns `ActiveLegacyRun`, exit 3, with the recorded owner. It does not acquire that run's lease, reserve a resume attempt, start a provider, or rewrite events. Existing ownership records do not identify a verified controller executable or build. The diagnostic reports `originalController: unavailable`; it does not invent a restart command. Complete the run through its retained original controller. If that controller is unavailable, this runtime cannot restart the legacy run.

The new supervisor reports historical completion, waits for live legacy owners, and refuses legacy restart with `ActiveLegacyRun` before reservation, restoration, or queue submission. Its dry run reports the retained checkpoint without a command vector. Pel recovery still uses the existing held-owner callback. This is an explicit retirement of automatic legacy restart, not a claim of equivalent restart behavior.

`foreman status RUN_ID --json` returns a separate `legacy-round` projection with decoded attempt identities and the full history hash. A terminal legacy observation exits 0 without claiming a Pel delivery result; active or unknown history exits 3. Legacy `resume` and `cancel` return `ActiveLegacyRun`, exit 3, before provider services, ownership, or allocation.

Historical RoundPlanV1 and event decoding remain available. Migration emits a separate source file. It does not convert old events into Pel events or move old work into a second controller.

## Command outcomes

| Exit | Meaning |
| --- | --- |
| 0 | Source and hash-bound parity file were written |
| 1 | I/O failed after valid input selection |
| 2 | Unsupported schema, field, command, identity, authority, or output selection |
| 3 | An active or uncertain legacy run needs its current controller |
| 4 | The command was interrupted |

Unsupported inputs report `UnsupportedLegacyConstruct` with the source locator. ExecutionContractV2, queue layouts, arbitrary shell commands, and Council workflows are outside this importer. Council preflight and review policy remain on their existing execution path.

The two conformance cases use recorded source hashes and finite provider responses. Their manifests identify them as test fixtures, not historical execution observations. Test repository relocation is explicit and preserves original limits and milestones. It does not authorize relocation in the installed product.

The earlier v0.5.0 round-controller obligations for historical decoding, owner exclusion, immutable checkpoint identity, and budget history remain in their existing modules and tests. Automatic legacy restore-and-queue behavior is retired in this runtime. Migration does not close obligations for unsupported legacy workflows or make an unavailable original controller recoverable. Council retains its existing preflight, blinding, quorum, and execution policy.
