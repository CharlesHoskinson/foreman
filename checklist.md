# v0.2.8.2 release checklist

This is the completed v0.2.8.2 release checklist. No later release scope is
active. The SessionDB is the recovery record, but a historical SessionDB
statement does not change the current release scope.

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

- [x] **1. Linux suite:** The current legacy launcher was built with
      `(cd launcher && bun run build:posix)`. Then
      `FOREMAN_CI_BATS=1 bash tools/ci-local.sh` ran on the release commit.
      Both commands exited zero. The annotated tag and GitHub release record
      the final `GATE` verdict and test totals.
- [x] **2. Main CI:** Both `gates-linux` and `gates-windows` completed green on
      the exact `main` commit that is tagged.
- [x] **3. Honest records:** `docs/RESIDUALS.md`,
      `docs/releases/v0.2.8.2-notes.md`, and the cleanup log describe the
      shipped boundary and all known limitations without a current v0.2.9
      claim.

A lane count, fact count, report digest, or model-family label is evidence. It
is not a release criterion by itself.

## Release actions

- [x] Validate Markdown links and repository hygiene.
- [x] Validate all active OpenSpec packages with strict mode.
- [x] Confirm that the replacement graph records the release candidate commit.
- [x] Commit and push the release-record cleanup branch as PR #12.
- [x] Merge the cleanup branch to `main` as `d9eafbb` after its workflows pass.
- [x] Merge final release-record PR
      [#16](https://github.com/CharlesHoskinson/foreman/pull/16) after its
      Linux and Windows workflows pass.
- [x] Re-run criterion 1 on the merged commit.
- [x] Confirm criterion 2 on the merged commit.
- [x] Confirm that the final release commit does not change between gate
      dispatch and tag creation.
- [x] Record the three terminal criterion results in the annotated tag and
      GitHub release.
- [x] Create and push annotated tag `v0.2.8.2`.
- [x] Verify that GitHub and the local repository resolve the tag to the same
      commit.

The final commit does not contain its own commit ID or workflow run IDs. The
annotated tag and GitHub release record the exact tag target, final workflow
run IDs, and artifact digests.

## Final release evidence

Exact release commit `076c014a8123d8df341b8037b3be5756c7cf6354`
passed the local release gate with 685 passed, 0 failed, and 19 skipped Bats
cases. All 12 NATS cases passed. Hosted Linux run `30819569495` and hosted
Windows run `30819569488` passed on the same commit. The annotated tag and
GitHub release both resolve to this commit. The authority graph records this
exact commit with 1,434 nodes, 2,618 links, and no duplicate or dangling
records.

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
