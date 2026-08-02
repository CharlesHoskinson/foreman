# v0.3 residual: Agy isolation

v0.2.9 ships the authenticated Agy Setup lane, the zero-inference model-list
probe, and a concurrency cap of one.

v0.3 preserves these requirements:

- Verify isolated credential seeding for an Agy worker home.
- Add per-lane quota and entitlement evidence.
- Raise concurrency only after a GREEN destructive control at the new limit.
- Remove the documented keyring isolation residual only after that control.
