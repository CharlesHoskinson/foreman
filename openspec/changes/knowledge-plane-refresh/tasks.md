# Tasks: Graphify 0.9.48 qualification

## 1. Reconcile and measure

- [x] Remove the broad `lock-primitive-hardening` prerequisite and the new-Bash
  implementation plan.
- [x] Reproduce the two-writer data-loss race against Graphify 0.9.48.
- [x] Record the pin, interpreter rule, race result, host, and date in the
  reference manifest.
- [x] Strict-validate the reconciled OpenSpec package.

## 2. RED qualification suite

- [x] Add TypeScript tests for the closed graph, health, metadata, and freshness
  schemas.
- [x] Add one valid code-only candidate and isolated invalid cases for every
  qualification reason.
- [x] Prove normalized determinism, zero model tokens, endpoint order, source
  locations, dangling endpoints, duplicate identifiers, and duplicate links.
- [x] Prove exact rename mappings and explicit unmapped nodes.
- [x] Prove freshness distinguishes fresh, stale, unrelated, missing, invalid,
  and failed states without Graphify.
- [x] Prove two concurrent publishers cannot both hold the advisory lock.

## 3. TypeScript implementation

- [x] Implement the pure Graphify qualification and freshness core.
- [x] Implement the Node 24 live CLI with exact argv and canonical output.
- [x] Resolve one safe interpreter and require Graphify 0.9.48.
- [x] Run raw and complete code-only builds in isolated temporary directories.
- [x] Normalize candidates and compare two complete builds.
- [x] Publish the graph and canonical metadata atomically under the bounded
  common-Git-directory lock.
- [x] Leave previous bytes unchanged on every refusal.

## 4. Repository integration

- [x] Track only `graphify-out/graph.json` and `refresh-meta.json`.
- [x] Add qualification and freshness runtimes to the generated manifest.
- [x] Route maintenance graph reporting through the freshness runtime.
- [x] Add the Graphify-free freshness check to the maintenance workflow.
- [x] Update the Foreman skill and README to use the qualification runtime and
  direct-source fallback.
- [x] Record the retired manual-refresh failure class in `bugeventlog.md`.

## 5. Qualification evidence

- [ ] Build the repository graph twice with Graphify 0.9.48 and prove normalized
  byte identity.
- [ ] Run the registered good and bad health fixtures.
- [ ] Publish the first qualified graph and metadata as one reviewable commit.
- [ ] Confirm zero commit drift and zero unrepresented tracked source files.
- [ ] Add the package brief and set the v0.4 coverage rows to `complete`.

## 6. Gate

- [ ] Run focused TypeScript tests and type checks.
- [ ] Run strict OpenSpec validation.
- [ ] Run the full repository verifier.
