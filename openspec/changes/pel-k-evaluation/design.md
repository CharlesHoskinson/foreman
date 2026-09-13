# Implement closures, arguments, and control: design

## Context and decisions

Use explicit control frames for eval, collect, bind, invoke, define, lambda, and native control operations. Separate administrative K rewrites from charged Pel operations. Do not add blanket strictness to conditionals or syntax parameters.

Represent lexical environments by stable graph nodes. Capture definition environments, parameter defaults, partial applications, and syntax argument environments explicitly. Preserve the selected recursion restrictions. Use the source builtin ArgSpecs as the inventory, with independently reviewed expected behavior.

Model if, case, for, do, do/async, leading call chains, and nested caret pipes. The unselected branch performs no effects. Each pipe left operand evaluates once, even when the right side uses caret repeatedly. The scheduling package supplies ready-task behavior for asynchronous blocks.

## File ownership

- `formal/pel/control.k`
- `formal/pel/arguments.k`
- `formal/pel/values.k`
- `formal/pel/pel.k`
- `packages/pel/test/k/evaluation.test.ts`
- `packages/pel/test/k/fixtures/evaluation.json`

These are implementation targets, not files delivered by this plan.
Shared files require serial integration through the program owner.
Preserve existing public APIs and unrelated user changes.

## Interfaces

Consume the [program contracts](../pel-k-release-program/contracts.md) and dependency package outputs.
Produce the case and evidence records defined there, with suite identity `pel-k-evaluation`.
Every requirement ID below is also a case-group ID accepted by the planned check command.
The program's [coverage map](../pel-k-release-program/coverage.json) binds inherited M7 rows to package owners.

## Failure and verification

Use the negative scenarios as admission controls.
Retain each failed source, host schedule, observation, and tool log.
Do not mark a requirement complete until its distinguishing case runs against the implemented candidate.
See [tasks.md](tasks.md) for commands and exact expected outcomes.
