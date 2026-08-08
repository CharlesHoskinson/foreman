# D2 — the POSIX backslash path-confusion

2026-08-08. Decided by council during an autonomous release run, with the owner
asleep and having pre-authorized a council to decide in their place.

## What measurement found

The v0.3.0 design doc §W2 lists six verified defects. Five were fixed in
`a744e9f` and `d74600e`. The sixth — D2, a path-confusion primitive inside
credential-authority comparison, one of the two the design doc calls
"security-shaped" — was **present at all three sites** on `ca2e5f6`:

| Site | Function |
|---|---|
| `packages/orchestration/src/credential-profile.ts:157` | `normalizeAbsolutePath` |
| `packages/orchestration/src/secret-scan.ts:513` | `normalizeRootInput` |
| `packages/orchestration/src/resume-worktree-restore.ts:217` | `normalizeAbsoluteWorktreeInput` |

An earlier report in this session claimed two of the three were fixed. They
were not; nothing had landed. `brokenwindows.md` BW-011 repeated the same false
claim, having carried it rather than reproduced it.

## The question

Three options were put to a council of three independent reviewers with
distinct lenses — security correctness, release risk, and this repository's own
written doctrine:

- **A** — fix in place at all three sites, keep the duplication as a tracked row
- **B** — extract one shared normalizer now, retiring the duplication class
- **C** — tag v0.3.0 on the four passing exit predicates, fix D2 in v0.3.1

## Ruling: A, 2–1

Release risk and doctrine both chose **A**. Security chose **B**.

Doctrine was decisive on rejecting **C**: the four exit predicates in §1.2 do
not mention W2, so the predicates permit a tag — but declaring a known
security-shaped defect a deliberate residual is an owner act, and `blocked` in
`brokenwindows.md` means "needs an owner decision". An agent cannot declare a
residual on the owner's behalf. That left "fixed" as the only branch available.

**B** was rejected on blast radius, not merit. Extracting a shared helper
re-cuts bundle digests in the same commit that regenerates the manifest those
digests are checked against, and §4.1 obliges a *defect fix* to land
failing-test-first — a refactor is a different thing. The duplication class
stays as BW-011 and belongs to v0.4.0.

## The dissent changed the fix

The security lens voted **B** and was right about the code. It found that the
strip is **dead code for legitimate input**: `resolve()` already collapses
separator runs and removes a trailing separator for the platform's own path
flavour, and preserves roots. So the strip's only live effects were both bugs.
Measured:

```
posix.resolve("/tmp/x/")    -> "/tmp/x"      trailing separator already gone
posix.resolve("/tmp/x\")    -> "/tmp/x\"     backslash survives, correctly
win32.resolve("C:\")        -> "C:\"         length 3, ends in a separator
```

The proposed fix had been to gate the backslash strip on
`process.platform === "win32"`. That would have **preserved a second bug**: on
Windows the root `C:\` has length 3 and ends in a separator, so the strip turns
it into `C:`, which `win32.isAbsolute` rejects as drive-relative — containment
then gets decided against the per-drive working directory. UNC paths gain a
second canonical form the same way.

So the fix is to **delete the strip**, not to gate it. That lands inside option
A's blast radius while fixing a Windows bug the majority's own remedy would
have kept. A 2–1 vote settled the scope; the dissent settled the code.

## Evidence

Six tests, three sites, both polarities on one tree:

```
# revert only the three source files, keep the tests
npx tsx --test --test-reporter=tap --test-name-pattern='backslash' \
  packages/orchestration/src/{credential-profile,resume-worktree-restore,secret-scan}.test.ts
  -> # pass 0   # fail 6

# with the fix applied
  -> # pass 6   # fail 0
```

The `secret-scan` test is black-box and shows the consequence rather than the
mechanism: a real directory named `x\` was **refused** as
`{"_tag":"Refused","reason":"invalid_worktree"}`, because the normalizer
resolved it onto a sibling that did not exist. The `resume` test showed the
confusion directly — two distinct real directories normalizing to the identical
string.

Bundle digests were rebuilt (5 bundles + `manifest.json`) and the drift gate was
proven live: restoring one pre-fix bundle gives
`verify-runtime exit=1 tracked runtime manifest: bundle_size_mismatch`; a
rebuild returns `verify-runtime: ok`.

## Residual, stated plainly

The Windows root bug (`C:\` → `C:`) is fixed by deletion but is **not** covered
by a test, because Windows is not a gating platform for v0.3.0 and these
normalizers bind to the host's path flavour at runtime. The reasoning is
recorded here and the measurement above is reproducible on any host with Node.
