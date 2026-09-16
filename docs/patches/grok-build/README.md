# Grok native admission patch

This directory preserves the native source work for the Foreman Grok adapter.
It does not install Grok or enable native dispatch.

## Source and scope

- Upstream: `https://github.com/xai-org/grok-build`
- Base: `482711333c7195dc16a272777f86086d615e2afb`
- Source version: 1.0.32
- License: [Apache-2.0](LICENSE), Copyright 2023-2026 SpaceXAI
- Patch: [request-admission.patch](request-admission.patch)

The patch contains the modified upstream files and new admission tests.
Each patch header identifies a changed file.
The patch also contains the implementation plan and historical verification results.
It does not contain credentials, dependencies, or compiled binaries.

The patch adds a trusted sampler veto and terminal denial handling.
It preserves the same admission hook through in-memory configuration reconstruction.
Serialization does not preserve authority.

## Reproduction

Use a separate checkout of the exact upstream base.
Check the patch before applying it:

```text
git apply --check /absolute/path/to/request-admission.patch
git apply /absolute/path/to/request-admission.patch
```

Use Rust 1.94.0 and Protobuf 29.3.
Set `PROTOC` to the selected Protobuf executable.
Populate the pinned Cargo dependency cache before using offline mode.

```text
cargo +1.94.0 test -p xai-grok-sampler --locked --offline -j4
cargo +1.94.0 test -p xai-grok-shell --lib admission --locked --offline -j4
cargo +1.94.0 check -p xai-grok-pager-bin --locked --offline -j4
```

## Remaining work

The hook does not enforce aggregate token or monetary limits.
Startup does not install a Foreman budget authority.
Direct tokenizer and web-search requests remain outside sampler admission.
Redirects, replays, server-side work, and native billing remain unqualified.
The coding/reporting controller and shared ledger remain unfinished.

Foreman therefore rejects public Grok starts before credential or process acquisition.
This source archive is not a release or live qualification.
The [OpenSpec task list](../../../openspec/changes/grok-bounded-work-report/tasks.md) retains the unresolved work.
