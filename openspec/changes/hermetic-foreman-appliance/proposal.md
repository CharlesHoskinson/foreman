# Change: Hermetic Foreman appliance

## Why

Foreman currently ships source and generated runtime bundles, but a new
operator must still assemble the host toolchain. The existing sandbox image is
an untrusted-worker boundary and must not become the control appliance.

## What Changes

- Add one pinned multi-stage OCI build with toolchain, control, and worker
  targets.
- Derive a closed appliance lock from `env/reference-manifest.toml`.
- Add one Compose definition and one Dev Container definition for the same
  control image and mounts.
- Add an optional private Qdrant profile with no default host port.
- Add declarative rootless Podman host assets and fail-closed qualification.
- Add reproducible build, runtime identity, and no-host-socket checks.

## Capabilities

### New Capabilities

- `hermetic-foreman-appliance`: Pinned control and worker images with an
  isolated hard-mode engine boundary.

## Impact

- Adds appliance assets under `containers/appliance`.
- Extends the reference manifest with exact appliance and host-engine pins.
- Adds TypeScript validation and doctor code under orchestration.
- Leaves `sandbox/Dockerfile` unchanged.
