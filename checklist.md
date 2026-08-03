# v0.2.8.2 release checklist

This is the only active release checklist. The SessionDB is the recovery
record, but a historical SessionDB statement does not change the current
release scope.

## Completed pivot preconditions

- [x] Preserve the withdrawn v0.2.9 tree with annotated tag
      `v0.2.9-preserve` at `04f3695`.
- [x] Land a Foreman-worker commit in Gobox. Worker commit `b0519b2` merged as
      `24bd736` through Gobox PR
      [#1](https://github.com/CharlesHoskinson/gobox/pull/1).
- [x] Verify the Gobox change with Gobox `make check` and the Foreman
      pristine-archive gate.
- [x] Record and fix the external soft-mode portability defects in Foreman PR
      [#7](https://github.com/CharlesHoskinson/foreman/pull/7), merged as
      `525cfb0`.
- [x] Pass the PR Linux and Windows workflows on the final PR head.
- [x] Restore Linux NATS coverage in Foreman PR
      [#10](https://github.com/CharlesHoskinson/foreman/pull/10). The Linux
      workflow passed all 12 NATS integration tests before merge `09e0715`.

## Tag criteria

The release has exactly three criteria:

- [ ] **1. Linux suite:** `FOREMAN_CI_BATS=1 bash tools/ci-local.sh` exits zero
      on the release commit. Record the final `GATE` verdict and test totals in
      the v0.2.8.2 release notes.
- [ ] **2. Main CI:** both `gates-linux` and `gates-windows` complete green on
      the exact `main` commit that will be tagged.
- [ ] **3. Honest records:** `docs/RESIDUALS.md`,
      `docs/releases/v0.2.8.2-notes.md`, and the cleanup log describe the
      shipped boundary and all known limitations without a current v0.2.9
      claim.

A lane count, fact count, report digest, or model-family label is evidence. It
is not a release criterion by itself.

## Release actions

- [ ] Validate Markdown links and repository hygiene.
- [ ] Validate all active OpenSpec packages with strict mode.
- [ ] Confirm that the replacement graph records the release candidate commit.
- [x] Commit and push the release-record cleanup branch as PR #12.
- [x] Merge the cleanup branch to `main` as `d9eafbb` after its workflows pass.
- [ ] Re-run criterion 1 on the merged commit.
- [ ] Confirm criterion 2 on the merged commit.
- [ ] Mark the three criteria complete in one final release-record commit.
- [ ] Create and push annotated tag `v0.2.8.2`.
- [ ] Verify that GitHub and the local repository resolve the tag to the same
      commit.

## Criteria retired from v0.2.8.2

The abandoned v0.2.9 checklist had nine additional scope families. They are
not silently incomplete; they are explicitly outside v0.2.8.2.

| Retired scope | Disposition |
|---|---|
| Complete every v0.2.9 OpenSpec package | Deferred; the withdrawn tree is preserved by tag |
| Ship the formal model plane | Deferred for a fresh design review |
| Ship the graph and knowledge plane | Deferred; shipped graph utilities are not deleted |
| Execute and certify Tier 2 vendor statistics | Deferred; no live result is claimed |
| Refresh every historical measurement | Retired; only release claims need current evidence |
| Expand negative controls to every verdict predicate | Deferred as a separate hardening project |
| Make the full Bats suite gate on Windows | Deferred; Windows keeps its documented probe boundary |
| Extract Superpowers from the repository | Rejected until a complete skill manifest exists |
| Integrate `dev/foreman-v1` | Deferred for branch review after the release |

Historical checklists and package tasks remain recoverable through Git history
and `v0.2.9-preserve`. They do not regain authority because a search finds
them.
