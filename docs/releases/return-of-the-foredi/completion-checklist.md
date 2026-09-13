# ForeDi release completion checklist

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
- [x] Amend the M6 specification, catalogs, roadmap, and release status to record the authorized code-reduction deferral.
  Preserve the frozen baseline and failed historical results.
  Validate the affected OpenSpecs and catalog consistency.
- [ ] Recheck exact provider qualification and remaining release predicates.
  Record actual outcomes, complete available checks, and retain external blockers with evidence.
- [x] Repair API no-tool qualification using observed transport evidence and fail-closed tool-output decoding.
  Keep native permission, workspace, and catalog requirements unchanged.
  Run focused regressions before the full host verification.
- [ ] Review and integrate verified changes, then update the checkpoint and release records.
  Treat successful packaging, merged source, and final release acceptance as separate facts.
- [x] Audit the Pel syntax and semantic inventory against planned K requirements.
  See the [mapping audit](../../guides/pel/k-mapping-audit.md). K implementation and proofs remain open.
- [x] Refine the Pel README explanation with GPT-6 and Inkwell's Grothendieck profile and editors.
  Gottlieb and Le Guin reviews completed. The blind reader returned CLEAR after one clarification.

The recovery changes passed local `npm run verify`: 3,303 tests passed, seven skipped, and none failed.
The build, runtime verification, appliance lock, register documentation, and smoke check also passed.
These are local recovery-worktree results. Hosted CI and live provider qualification remain separate obligations.

## CI evidence

GitHub main run `34769434833` failed before workspace tests with `bwrap: setting up uid map: Permission denied`.
The local WSL kernel has AppArmor disabled, so local tests cannot establish the hosted-runner result.
The runner must pass its existing unprivileged namespace probe after loading the profile.

Ubuntu describes per-application user namespace profiles in its [AppArmor guidance](https://discourse.ubuntu.com/t/understanding-apparmor-user-namespace-restriction/58007).
The added profile applies only to `/usr/bin/bwrap` on the disposable runner.

## Provider routing

The user selected Opus and Grok after the initial investigation.
The local coding agents stopped before implementing the API correction.
Opus owns completion of the partial documentation amendment and the adapter fix.
Grok initially reported signed out. A later check confirmed an active grok.com session and the exact `grok-4.6` selection.
The first cold review reached its turn limit without a verdict. The full retry timed out. Grok completed the nested-output review with no blocking findings.
A separate bounded review covers the remaining request-evidence, qualification, and CI changes.
The fresh Opus canary confirmed `claude-opus-5` through the provider's model-usage record.
