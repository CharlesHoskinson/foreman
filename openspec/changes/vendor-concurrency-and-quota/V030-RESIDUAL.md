# v0.3 residual: quota and entitlement

v0.2.9 ships measured concurrency caps and keeps Agy at one.

v0.3 preserves these requirements:

- Report entitlement separately from authentication.
- Classify quota exhaustion as vendor unavailability.
- Detect silent model downgrade in the lane result.
- Extend destructive concurrency controls to Agy before a cap increase.
