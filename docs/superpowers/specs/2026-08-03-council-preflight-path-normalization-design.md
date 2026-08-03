# Council Preflight Path Normalization Design

## Problem

The preflight request accepts relative host filesystem paths. The runtime
forwards the relative `cwd` to the child process and the provider CLI.

Grok and Codex can resolve the same path segment two times. Equivalent absolute
paths pass the same canaries.

## Decision

Normalize all host filesystem paths at the Node runtime boundary. Resolve each
relative path against the CLI invocation directory.

Normalize these fields:

- `cwd`
- `observedBundle.diffPath`
- Each `artifactPaths[].path`

Keep `provider.executable` unchanged. A bare executable name must continue to
use the child environment `PATH`.

## Data flow

1. Decode the closed request schema.
2. Capture the Node process working directory.
3. Create a new request with normalized paths.
4. Verify artifacts with the normalized request.
5. Probe and start the provider with the normalized `cwd`.

The runtime must not mutate the decoded request. The runtime must not add paths
to results, tokens, receipts, stdout, or stderr.

## Error behavior

Normalization uses `node:path.resolve`. The function does not access the
filesystem. Existing bounded readers and process-start failures keep their
current typed failure behavior.

## Verification

A unit test injects one absolute invocation directory. The test proves these
conditions:

- Every relative runtime path resolves against the invocation directory.
- Every absolute runtime path remains unchanged.
- The executable value remains unchanged.
- The input request remains unchanged.

The exact-candidate Grok, Claude, and Codex canaries prove the behavior across
the supported provider adapters.
