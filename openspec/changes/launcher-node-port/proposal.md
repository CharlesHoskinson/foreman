# Change: launcher-node-port

## Why

Foreman process supervision still runs from a Bun-only tree under `launcher/`.
Sprint 5 requires a Node.js 24 and Effect package that preserves the frozen
CLI, heartbeat, stream, timeout, and exit contracts while reporting honest
platform containment capabilities.

## What changes

- Add `@foreman/launcher` under `packages/launcher/` as TypeScript-only source
  and tests on Node.js 24 with the root-pinned Effect version.
- Port CLI parse, supervision, heartbeats, graded stop, detach handoff, and
  platform capability planning without Bun or Deno imports.
- Model POSIX strong containment as a pure `process.execve` plan over absolute
  `unshare` (injectable; never executed inside the test runner).
- Fall back to a detached process group with negative-PID termination when the
  unshare probe fails or is unavailable.
- Report Windows `windows_job_object_unavailable` as a typed degraded
  capability and bound tree kill to injectable `taskkill.exe /T /F`.
- Emit `skills/foreman/runtime/dist/foreman-launch.js` and bind it in the
  runtime manifest with deterministic build and copied-bundle smoke.
- Leave the legacy `launcher/` tree byte-unchanged for a follow-on consumer
  switch and guarded retirement package.

## Impact

- **Runtime:** compiled Node entry for foreman-launch; Bun remains required only
  for legacy callers until consumer conversion.
- **Capabilities:** proved Node core CLI and POSIX process-group fallback;
  designed PID-namespace live cascade; typed Windows degraded boundary; open
  Job Object parity, legacy conversion, and hostile escapee closure.
- **Open:** do not mark Sprint 5 or the whole launcher migration complete.
