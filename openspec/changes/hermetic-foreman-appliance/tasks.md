# Hermetic Foreman appliance implementation tasks

## 1. Appliance lock

- [x] Add RED tests for exact manifest pins and canonical lock projection.
- [x] Add appliance and rootless-engine pins to the reference manifest.
- [x] Implement the TypeScript parser, projection, and drift check.
- [x] Verify malformed, missing, floating, and mismatched pins refuse.

## 2. OCI build and operator entry points

- [x] Add RED tests for the three target names and filesystem contract.
- [x] Add the pinned multi-stage Dockerfile without changing the sandbox image.
- [x] Add Compose and Dev Container definitions for the same control image.
- [x] Add the optional private Qdrant profile without a default host port.

## 3. Control doctor

- [x] Add RED tests for exact runtime and skill identity reporting.
- [x] Implement the nonroot control entry point and doctor command in TypeScript.
- [x] Add the doctor runtime to the generated manifest.
- [x] Smoke the copied image without repository `node_modules`.

## 4. Rootless hard-mode service

- [x] Add RED tests for host account, subordinate IDs, endpoint, and TLS modes.
- [x] Add sysusers, tmpfiles, configuration, and systemd service templates.
- [x] Implement fail-closed TypeScript qualification and protected-root probes.
- [x] Verify there is no host-socket fallback or worker service credential.

## 5. Reproducibility and release lane

- [x] Build and smoke control and worker images on `linux/amd64`.
- [x] Verify the `linux/arm64` build graph.
- [x] Add reproducibility and supply-chain evidence instructions.
- [x] Add the package brief and set coverage rows to `complete`.
- [x] Run strict OpenSpec validation and the full repository verifier.
