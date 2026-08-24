# Design: Hermetic Foreman appliance

## Product boundary

Keep the existing sandbox image as the legacy untrusted-worker boundary. Build
the appliance in `containers/appliance/Dockerfile` with three named targets:
`foreman-toolchain`, `foreman-control`, and `foreman-worker`.

The control image contains compiled Foreman runtime bundles and immutable skill
trees. It runs as a nonroot user with `/workspace`, `/state`, and `/run/foreman`
as its only writable runtime locations. The worker image contains the worker
toolchain and does not contain control state.

## Lock authority

`env/reference-manifest.toml` is the authored authority. A generated canonical
JSON lock is a pure projection. TypeScript code validates exact keys, versions,
image digests, supported platforms, and the projection digest. Builds refuse
floating tags or mismatched projection bytes.

## Operator entry points

Compose and the Dev Container configuration select the same control image,
workspace mount, state volume, and tmpfs runtime directory. The optional
semantic-memory profile starts the pinned Qdrant image on an internal network
without a published port.

## Hard-mode host

The host bundle uses systemd sysusers, tmpfiles, configuration, and a service
unit for a dedicated non-login `foreman-engine` account. The service binds a
host-local TCP endpoint and requires mutual TLS. It never exposes or mounts a
general engine socket. TypeScript qualification checks the exact Podman
version, endpoint, certificate modes, account identity, subordinate-ID ranges,
and protected-path probes before hard mode is admitted.

## Verification

Tests bind the manifest projection, target names, nonroot filesystem layout,
Compose/Dev Container parity, private Qdrant network, absence of host-engine
socket mounts, and rootless host templates. Live Docker tests build and smoke
the control and worker targets when Docker is available.
