# ForeDi release completion plan

**Goal:** Complete the remaining authorized release work after PR 59.

**Architecture:** Retain the existing runtime, authority, and release records.
Apply a CI-specific Bubblewrap AppArmor profile without disabling host-wide restrictions.
Preserve historical measurements while moving production reduction into a separate cleanup release.

**Tech Stack:** Node.js 24, TypeScript, GitHub Actions, AppArmor, OpenSpec.

## Constraints

- The user authorized completion and GitHub integration.
- The user deferred code reduction on 2026-09-13: “ignore the code reduction. We can do this in a separate release that cleans up the repo”.
- Preserve all original metric reports and their candidate identities.
- Do not waive independent review, provider identity, qualification, or existing publication authority.
- M7 remains a planned sprint. Its requested deliverable was a sprint specification.

## Tasks

- [ ] Repair the Linux prerequisite failure in `.github/workflows/gates-linux.yml`.
  Validate `.github/apparmor/foreman-bwrap` with `apparmor_parser --skip-kernel-load --skip-read-cache`.
  Run the existing native-boundary tests and observe the GitHub namespace probe.
- [ ] Amend the M6 specification, catalogs, roadmap, and release status to record the authorized code-reduction deferral.
  Preserve the frozen baseline and failed historical results.
  Validate the affected OpenSpecs and catalog consistency.
- [ ] Recheck exact provider qualification and remaining release predicates.
  Record actual outcomes, complete available checks, and retain external blockers with evidence.
- [ ] Review and integrate verified changes, then update the checkpoint and release records.
  Treat successful packaging, merged source, and final release acceptance as separate facts.

## CI evidence

GitHub main run `34769434833` failed before workspace tests with `bwrap: setting up uid map: Permission denied`.
The local WSL kernel has AppArmor disabled, so local tests cannot establish the hosted-runner result.
The runner must pass its existing unprivileged namespace probe after loading the profile.

Ubuntu describes per-application user namespace profiles in its [AppArmor guidance](https://discourse.ubuntu.com/t/understanding-apparmor-user-namespace-restriction/58007).
The added profile applies only to `/usr/bin/bwrap` on the disposable runner.
