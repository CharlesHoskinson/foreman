# Hermetic Foreman appliance specification

## ADDED Requirements

### Requirement: Pinned OCI build graph

The appliance SHALL expose the `foreman-toolchain`, `foreman-control`, and
`foreman-worker` targets from one Dockerfile. Every base image and installed
top-level tool SHALL use an exact identity from `env/reference-manifest.toml`.

#### Scenario: A pin is missing

- **WHEN** the appliance lock omits or changes one required identity
- **THEN** lock validation refuses
- **AND** the build does not silently select a floating version

### Requirement: One control product

Compose and the Dev Container configuration SHALL run the same control image.
They SHALL mount the repository at `/workspace`, durable state at `/state`, and
ephemeral process state at `/run/foreman`.

#### Scenario: The control image starts

- **WHEN** an operator starts the appliance
- **THEN** it runs as a nonroot user
- **AND** doctor reports the exact Node, runtime-manifest, and skill identities
- **AND** no host container-engine socket is mounted

### Requirement: Optional private semantic memory

The semantic-memory profile SHALL use the pinned Qdrant image, a private
network, a dedicated volume, and an explicit API key. It SHALL publish no host
port by default.

#### Scenario: Semantic memory is disabled

- **WHEN** the profile is not selected
- **THEN** the control image starts without Qdrant
- **AND** core behavior remains available through `NullMemoryIndex`

### Requirement: Dedicated rootless hard-mode engine

Hard mode SHALL use a separate non-login `foreman-engine` account and a
host-local mutual-TLS Podman service. It SHALL refuse wrong versions, missing or
overlapping subordinate IDs, unsafe key modes, substituted paths, successful
protected-root probes, or an unavailable endpoint. It SHALL never fall back to
a general host engine socket.

#### Scenario: The service is not qualified

- **WHEN** any host, identity, certificate, endpoint, or isolation check fails
- **THEN** hard-mode admission refuses before a worker starts
- **AND** soft mode remains available

### Requirement: Reproducible release evidence

The appliance SHALL support `linux/amd64` and `linux/arm64`. Builds SHALL use a
pinned Dockerfile frontend and base index, one candidate-derived
`SOURCE_DATE_EPOCH`, and deterministic file ownership and modes.

#### Scenario: Two builds differ

- **WHEN** two clean locked builds of one platform produce different digests
- **THEN** the appliance lane remains incomplete
- **AND** publication is blocked
