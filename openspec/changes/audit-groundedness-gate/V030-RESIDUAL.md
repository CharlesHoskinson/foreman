# v0.3 residual: groundedness promotion

v0.2.9 ships the groundedness library, registry, canary, and fail-capable unit
tests. The release keeps this control in shadow mode.

v0.3 preserves these requirements:

- Bind the canary to the production audit and gate entrypoints.
- Reject an empty registry instead of reporting a vacuous canary success.
- Make each predicate consume every input that its declaration names.
- Promote the control from shadow only after the entrypoint controls pass.
