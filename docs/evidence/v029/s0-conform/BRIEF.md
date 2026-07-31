# SPEC — OpenSpec conformance for the five WSL packages

Read `AGENT_TRAPS.md` IN FULL first. No `git commit`. No graphify.

## The job

`openspec/README.md` states this repo follows OpenSpec folder conventions. It
does not: **five live change packages fail `openspec validate --strict`**, and
they are all the S3 WSL set:

- `wsl-ci-parity`
- `wsl-launcher-shipped`
- `wsl-preflight`
- `wsl-seam-doctrine`
- `wsl-tool-path-persistence`

Every other package (28 of 33) validates. Fixing these closes a release-gate
item and unblocks S3, which is otherwise the next stage to dispatch.

## The cause

They use `## ADDED Requirement: <title>` where the CLI parses:

```
## ADDED Requirements
### Requirement: <title>
#### Scenario: <title>
```

**This is a mechanical header transform with NO content change.** Do not
rewrite, improve, reword or restructure any requirement text. Do not add or
remove scenarios. If a package appears to need a content change to validate,
STOP and report it rather than making one — a content edit smuggled into a
conformance migration is exactly the kind of thing an audit cannot separate
later.

## Method

1. Run `/usr/local/bin/openspec validate <pkg> --strict` on each of the five
   and **capture the actual error** before touching anything. Different packages
   may fail for different reasons; do not assume all five share one cause.
2. Transform the headers.
3. Re-validate. All five must report valid, strict.
4. Re-validate the other 28 to prove you broke nothing.
5. Update `openspec/README.md` so its claim about conventions is true — it is
   currently a documented-claim-versus-reality drift of the same class
   `doctrine-reality-drift` exists to catch.

## Verification

Prove the transform is content-preserving: for each package, show that the diff
touches only heading lines. `git diff --word-diff` or an equivalent, quoted in
`REPORT.md`. Any diff hunk that changes prose is a finding you must report.

Report the before/after validate output for all 33 packages in aggregate.
