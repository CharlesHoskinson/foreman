# Foreman v0.4 appliance

The appliance has one Dockerfile and three targets:

- `foreman-toolchain` contains the pinned operating-system and language tools.
- `foreman-control` contains the generated Foreman runtime and immutable skills.
- `foreman-worker` preserves the existing untrusted-worker entry point.

The authored dependency pins are in `env/reference-manifest.toml`.
`lock.json` is a canonical projection. Regenerate it with
`npm run build:appliance-lock` and check drift with
`npm run verify:appliance-lock`.

## Local control smoke

Use the candidate commit time for `SOURCE_DATE_EPOCH`:

```text
git show -s --format=%ct HEAD
docker buildx build --load --provenance=false --platform linux/amd64 --target foreman-control --build-arg SOURCE_DATE_EPOCH=<seconds> --tag foreman-control:0.4.0-local -f containers/appliance/Dockerfile .
docker run --rm --network none --read-only --tmpfs /workspace:uid=10001,gid=10001,mode=0700 --tmpfs /state:uid=10001,gid=10001,mode=0700 --tmpfs /run/foreman:uid=10001,gid=10001,mode=0700 --tmpfs /tmp:uid=10001,gid=10001,mode=0700 foreman-control:0.4.0-local
```

The command must emit one canonical `Ready` record. The final image has no
repository `node_modules`; the doctor verifies the copied runtime manifest,
required skill directories, nonroot UID, writable mount contract, and exact
tool versions.

Compose and the Dev Container configuration build this same target. The
semantic-memory profile requires a dedicated `FOREMAN_QDRANT_API_KEY`. It uses
an internal network and publishes no host port.

## Reproducibility

Build the same target twice from separate clean checkouts with the same commit
and `SOURCE_DATE_EPOCH`. Use `--provenance=false` for the byte-identity
comparison because BuildKit attestation envelopes contain run-specific
metadata. The two image-manifest digests must match. A release build then emits
the SBOM and provenance as separate attestations for the already-matched image.

Use `docker buildx build --call=check --platform linux/arm64` to validate the
arm64 graph on a host without arm64 emulation. The release gate must also run a
real arm64 build on a multi-platform builder before publication.

The release record must retain the source commit, reference-manifest digest,
lock digest, per-platform image digests, multi-platform index digest, SBOM,
and provenance statement. Image publication happens only in the release
workflow. No private key or signing fixture belongs in this tree.

## Hard mode

Hard mode never uses the operator's Docker or Podman socket. The templates in
`host/` define the separate `foreman-engine` account and host-local mutual-TLS
Podman service. Follow `host/README.md` and run the TypeScript qualification
before enabling the unit. A failed or unavailable qualification leaves hard
mode disabled and does not affect soft mode.
