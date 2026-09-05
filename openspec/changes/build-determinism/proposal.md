# Change: build-determinism

## Purpose

`verify-runtime` reported `ok` from a worktree whose `node_modules` was a
symlink to another checkout, and `appliance-doctor drift` from a clean
worktree of the same commit. `secret-scan` refuses to scan the working
checkout under default bounds. A green result that depends on where the
command ran is not evidence. This change makes both tools report the truth
of the tree they were pointed at. It closes BW-010 and BW-017.

## Scope

- In scope: `verify-runtime` refuses when `node_modules` is a symlink or when
  the installed package tuples do not match the repository lockfile.
- In scope: measure why two independent checkouts of one commit build
  different bundles, then remove that cause.
- In scope: `secret-scan` excludes untracked ignored paths by default and
  reports which bound was exceeded with the offending count.

## Exclusions

- Out of scope: changing the bundle format or esbuild options beyond path
  independence.
- Out of scope: new secret patterns.

## Acceptance Evidence

- Evidence: `npm run verify-runtime` exits non-zero with `node_modules_symlink` in a symlinked worktree.
- Evidence: `npm run verify-runtime` exits 0 in a clean worktree at the same commit as the main checkout.
- Evidence: `secret-scan.test.ts` case "scans the current Foreman worktree clean" passes on this host.
