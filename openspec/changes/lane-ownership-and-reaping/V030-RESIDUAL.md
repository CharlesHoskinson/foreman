# v0.3 residual: dispatch hygiene enforcement

v0.2.9 ships process-state liveness, owner-safe reaping, and the lane ownership
harness.

v0.3 preserves these requirements:

- Promote dispatch hygiene from shadow to an enforcing gate.
- Bind every re-dispatch path to the persisted owner record.
- Add destructive controls for foreign and re-executed process trees.
- Remove the shadow residual only after those controls pass.
