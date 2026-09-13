# Specify and execute abstract host boundaries: design

## Context and decisions

Use closed finite scripts of registry descriptors, receipts, and scheduling choices. Match the current HostRequestV1 and HostReceiptV1 structures. Receipt bindings that are not wire fields must be checked through the pending request and registry context, not invented fields.

Model all data schema alternatives, strict and syntax host arguments, resource descriptor data, print output, and pel/nl-condition selection bindings. Preserve success, failure, malformed receipt, and missing receipt as distinct cases. Cryptographic digest equality is an explicit collision-resistance assumption, not a K theorem.

Treat retry, race, remote execution, durable budget reservations, and publication checks as host-policy boundaries. Test their M1 request/child interfaces. Do not copy their production algorithms into a second authority owner. A cancelled local wait does not prove remote cancellation.

## File ownership

- `formal/pel/host.k`
- `formal/pel/host-script.schema.json`
- `formal/pel/pel.k`
- `packages/pel/test/k/host.test.ts`
- `packages/pel/test/k/fixtures/host.json`

These are implementation targets, not files delivered by this plan.
Shared files require serial integration through the program owner.
Preserve existing public APIs and unrelated user changes.

## Interfaces

Consume the [program contracts](../pel-k-release-program/contracts.md) and dependency package outputs.
Produce the case and evidence records defined there, with suite identity `pel-k-host`.
Every requirement ID below is also a case-group ID accepted by the planned check command.
The program's [coverage map](../pel-k-release-program/coverage.json) binds inherited M7 rows to package owners.

## Failure and verification

Use the negative scenarios as admission controls.
Retain each failed source, host schedule, observation, and tool log.
Do not mark a requirement complete until its distinguishing case runs against the implemented candidate.
See [tasks.md](tasks.md) for commands and exact expected outcomes.

## Early host boundary delivery

K05 depends on K02 and precedes K03.
Implement the host transition module against the frozen configuration and observation schemas before integrating general control evaluation.
Use supplied invocation configurations and bound arguments for the initial K05 checks.
Compare them with TypeScript states captured at the public suspension boundary.
These are configuration-level host tests. They do not count as K source-parser or full-program coverage.
K03 consumes the real host module for pipe, print, and selected-branch tests.
K07 reruns every host fixture from original source against the integrated machine before K1 admission.
