# v0.3 residual: lock hardening breadth

v0.2.9 ships the shared lock helper, occupancy regression test, and owner-aware
reclaim path.

v0.3 preserves these requirements:

- Complete the remaining lock-failure and filesystem-class controls.
- Cover each caller that still has an inline or partial lock path.
- Resolve the remaining OpenSpec conformance decision.
- Promote only mechanisms that pass occupancy and reclaim controls.
