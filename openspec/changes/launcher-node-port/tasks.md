# Tasks — launcher-node-port

## 1. Package scaffold and CLI

- [x] Add `@foreman/launcher` package, tsconfig, and root workspace wiring.
- [x] Write failing CLI tests for frozen flags, exit mapping, and Node version line.
- [x] Implement pure CLI parse and exit mapping.

## 2. Heartbeat and streams

- [x] Write failing tests for frozen heartbeat keys, single-line append, live and
      dead lines, write-failure isolation, and stale detach reset.
- [x] Implement heartbeat format/validate and supervise stream pumps with null
      stdin and separate stdout/stderr byte streams.

## 3. Supervision and timers

- [x] Write failing tests for timeout, grace, one termination, timer cleanup,
      and no double completion.
- [x] Implement Effect-scoped supervise with injectable clock and kill services.

## 4. Platform capabilities

- [x] Write pure strong-path plan tests (absolute unshare, host PID, recursion
      marker, exact execve request) without calling process.execve.
- [x] Write failed-probe degradation, detached process group, and negative-PID
      termination tests.
- [x] Write Windows pre-spawn degraded capability and injectable taskkill tests.
- [x] Implement capability resolution and live probe (typed degrade on this host).

## 5. Churn and compiled artifact

- [x] Add bounded >1000 short-descendant churn control without zombie
      accumulation under the launcher host.
- [x] Emit `skills/foreman/runtime/dist/foreman-launch.js` and bind the
      runtime manifest.
- [x] Prove copied-bundle execution without repository `node_modules`.

## 6. Documentation truth

- [x] Author OpenSpec change `launcher-node-port` with proved vs open claims.
- [x] Update `node-typescript-runtime` M3 tasks only for proved behavior.
- [x] Update `v030-release-program` and `typescriptmigration.md` without marking
      Sprint 5 or full launcher migration complete.
- [x] Leave legacy `launcher/` byte-unchanged.

## Open follow-on (not this package)

- [ ] Consumer switch from Bun launcher binary to Node runtime artifact.
- [ ] Guarded retirement of `launcher/` Bun tree.
- [ ] Native Windows Job Object parity.
- [ ] Live PID-namespace cascade proof on a host where unshare succeeds.
- [ ] Hostile escaped-descendant closure under strong containment.
