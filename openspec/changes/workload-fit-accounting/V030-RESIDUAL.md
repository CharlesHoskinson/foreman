# v0.3 residual: workload-fit doctrine

v0.2.9 ships the fit-ledger reader, discovery-versus-offload report, poor-fit
verdict, and cleanup integration.

v0.3 preserves these requirements:

- Add the up-front `fit:` decision to the five-part specification.
- Seed the fit ledger before dispatch.
- Record `discovery_fraction` without reading the event log as a substitute.
- Add doctrine controls that fail when the decision or ledger seed is absent.
