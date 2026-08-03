## 1. Regression

- [x] 1.1 Add TypeScript/Vitest architecture regression that reads both root
      gate workflows and proves Node 24, step name, working directory, command
      order, strict OpenSpec flags, fail-closed gating, and no provider
      credentials or live calls.
- [x] 1.2 Run the regression against unchanged workflows and record RED for
      Linux and Windows.

## 2. Workflows

- [x] 2.1 Add `Run Council Node 24 gate` to `.github/workflows/gates-linux.yml`
      after Node 24 setup with `working-directory: components/council`,
      `CI: "true"`, and the three required commands.
- [x] 2.2 Add the same gating step to `.github/workflows/gates-windows.yml`.
- [x] 2.3 Keep both steps fail-closed without `continue-on-error` or weak
      conditionals, and without provider secrets.

## 3. Documentation and OpenSpec

- [x] 3.1 Define OpenSpec change `council-node24-ci` with proposal, design,
      tasks, and `ci-gating` delta specification.
- [x] 3.2 Update Council README and roadmap status text for hosted Node 24
      root gate validation.

## 4. Verification

- [x] 4.1 Record focused GREEN for the workflow regression.
- [x] 4.2 Run `corepack pnpm check` from `components/council`.
- [x] 4.3 Run `corepack pnpm exec openspec validate --all --strict --no-interactive`.
- [x] 4.4 Run root localization and documentation Bats under the repository
      flock.
- [x] 4.5 Write `FOREMAN_CI_REPORT.md` with RED, GREEN, full-gate, changed
      file, and no-provider-call evidence.
