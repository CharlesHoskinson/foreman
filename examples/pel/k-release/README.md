# Run the K agenda with Pel

These programs express the K OpenSpec agenda using the existing Pel host functions.
Pel coordinates implementation, verification, independent review, checkpoints, and separately admitted correction runs.
The resulting language definitions and proof claims still use K.

The programs are authored and checked. Their project bindings remain **unbound**.
No provider work, K implementation, proof, candidate promotion, or release publication has been dispatched by this change.

## Read the agenda

[agenda.pel](agenda.pel) represents the complete package graph as ordinary Pel data.
Its K1 list includes the program governor and ten required packages.
Its K2 list contains the separate source-certification track.
Every package lists its OpenSpec tasks, requirement IDs, inherited M7 requirements, dependencies, and workflow filename.
K05 appears before K03 because control tests need its host boundary rules.
Repository cleanup remains a separate release.

With the released Foreman entry point available:

```text
foreman check examples/pel/k-release/agenda.pel
foreman plan examples/pel/k-release/agenda.pel
foreman check examples/pel/k-release/01-foundation.pel
foreman plan examples/pel/k-release/01-foundation.pel
```

In a built repository, the equivalent entry point is:

```text
node skills/foreman/runtime/dist/foreman.js check examples/pel/k-release/01-foundation.pel
node skills/foreman/runtime/dist/foreman.js plan examples/pel/k-release/01-foundation.pel
```

The agenda is a manifest to inspect. It is not a dispatcher or a delivery result.
Do not run agenda.pel as a delivery workflow.

## Workflow behavior

Each numbered program performs a bounded sequence for its admitted work unit:

1. Record a checkpoint before implementation.
2. Execute the exact approved input through role:implementer.
3. Stop with needs-action when the implementation makes no change.
4. Verify the host-captured candidate through candidate-full.
5. Review only a candidate whose verification passed.
6. Return approved, or retain the candidate and findings with correction-context-required.

There is no automatic correction loop. The first beta review exposed an input-binding limitation in that design.
A bare artifact string resolves to admitted content. Reference-shaped strings inside an ordinary result association remain ordinary data.
Passing a failed delivery directly to another task does not supply the original spec and evidence bytes.

[correction.pel](correction.pel) expresses one correction through the registered correct action.
Before using it, the host must admit a fresh immutable packet containing the original spec and resolved candidate, check, and review evidence.
Use the existing registered authority for correction. Do not reset consumed contract budgets or treat an imported reference as authority.
The correction checkpoint has a generic name. Its admitted input packet and run record must identify the package.
The required round-count result field is zero because this invocation contains no correction loop.
The correction program verifies and reviews its own captured candidate, then stops.
A failed correction needs another explicit admission decision. No Pel loop repeats it.

The programs retain the findings returned by their own task, check, or review.
A host failure terminates evaluation without blind retries. An absent receipt remains pending under its original request identity.
The programs contain no publication call.

## Bind an admitted unit

[bindings.json](bindings.json) is an authoring worksheet, not a Foreman project-settings file.
Its null identities, empty acceptance commands, and empty grants explicitly mark missing bindings.
Do not pass it to foreman project configure.

The worksheet identifies every package and the files required in its input packet.
Bind artifact:approved-spec to the exact immutable packet for the selected run.
Include its selected requirement or task, normative clauses, required evidence, permitted paths, and prerequisite receipts.
Include the shared K program contracts, proof domains, and source inventory where the unit depends on them.
Pin the packet's bytes and the source commit through the existing artifact and execution-authority mechanisms.
A filename or an artifact-shaped string inside ordinary Pel data does not load a file or grant authority.
The numbered workflows share a control template. Their filenames and comments do not enforce a package-to-packet identity match.
The admission owner must check that match against bindings.json and the immutable packet before execution.

A package can require many admitted runs. Select one independently reviewable unit that fits the actual time and resource budget.
A successful unit does not complete its package. Close a package only after every required task and inherited M7 scenario passes.
Keep source implementation, checked results, and completed task records consistent after promotion.

The candidate-full registration must execute the complete gate for that admitted unit and all applicable existing regressions.
Do not substitute model-reported test results, a successful parse, or an empty gate for those checks.
Before K01 builds pel-semantics.js, use real bootstrap checks against its implemented outputs.
Later units use the concrete commands from their OpenSpec tasks after those commands exist.
K08 closure requires actual prove --all-required results. K10 closure requires all K1 release predicates and retained publication requirements.

## Select Opus and Grok

[settings.patch.json](settings.patch.json) provides a configuration fragment for:

- Implementation: claude-opus-5 through claude-code.
- Independent review: grok-4.6 through grok-acp.
- Each invocation performs one implementation or correction, at most one verification action, and at most one review.

The fragment is not a complete project configuration.
Apply roleBindings and taskActions as explicit field updates.
Merge each limits.execution leaf into the existing limits.execution object. Do not replace the parent limits or execution object.
A shallow object merge is incorrect. Keep workspace grants and authority references unchanged.
Retain real wall-clock, cost, token, output, concurrency, and cancellation bounds.
The current host decoder requires positive execution counters. The fragment sets providerRetries to its minimum value of one; it cannot express a zero host-retry allowance.
The Pel programs contain no retry loop. Host retry accounting remains governed by the registered contract.

The fragment caps totalActions at four for one invocation, including conservative room for its checkpoint.
Validate these ceilings against the actual execution contract rather than inferring authority from the fragment.

Resolve account:default to the intended authorized credential profiles.
The exact model and transport cells must pass the current qualification checks for their task or review capability.
A model appearing in the registry does not establish live readiness.
The check and plan commands use the current authoring context. Before project configuration they may display the default role assignments.
Validate again under the configured Opus/Grok context before dispatch.

Use the existing [project quickstart](../../../docs/guides/pel/quickstart.md) to create a complete settings file.
Once it is admitted, a selected unit uses the ordinary command:

```text
foreman run examples/pel/k-release/01-foundation.pel --json
```

This command is an execution instruction for a future admitted run. It was not executed while authoring these programs.

## Promotion and publication boundaries

Each run is bound to its original workspace, immutable base, input, and execution contract.
The host must integrate an approved candidate through the existing guarded mechanism before admitting a dependent unit against the new base.
Do not edit an active run's settings or source to simulate promotion.
Do not pass a previous run's reference-shaped string as proof that its artifacts or authority belong to a new run.

K07 conformance and K08 proofs may use separate workspaces after their common prerequisites are admitted.
The agenda lists a conservative serial order. It does not assert that shared-file writes are safe in parallel.

Current Pel has no general package-import, nested-run, candidate-merge, or GitHub release-asset upload function.
Those host-owned boundaries are explicit in agenda.pel.
K10's workflow prepares and reviews implementation artifacts. It does not by itself publish a release or embed its image.
The release owner must execute the existing authorized tag, asset, and image-verification steps from the K10 OpenSpec.
An approved review is not publication authority.

## Validation and limits

Run the focused control tests:

```text
npm ci
npm run build --workspace @foreman/pel
npm run build --workspace @foreman/providers
node --import tsx --test packages/orchestration/src/pel-k-workflows.test.ts
```

Run these commands from the repository root.
The tests execute the actual Pel source against the shipped language registry using scripted host receipts.
They validate each intermediate receipt against its actual request result schema.
They check complete agenda coverage, dependency order, approval, verification failure, review rejection, no-change handling, correction-context stops, separately admitted correction, and missing receipts.
They do not establish live provider qualification, durable host-journal recovery, K proofs, or release acceptance.
Those requirements remain in the [OpenSpec program](../../../openspec/changes/pel-k-release-program/proposal.md).
