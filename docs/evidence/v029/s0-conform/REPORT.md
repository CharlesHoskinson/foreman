# REPORT — OpenSpec conformance for the five WSL packages

## 1. Pre-fix validate errors (five packages)
DONE

Command: `/usr/local/bin/openspec validate <pkg> --strict` for each of the five.

All five failed with the **same** class of error (no content difference between packages beyond the capability path name):

| Package | Spec path | Error |
|---|---|---|
| `wsl-ci-parity` | `ci/spec.md` | No delta sections found. Add headers such as `## ADDED Requirements` …; Change must have at least one delta. |
| `wsl-launcher-shipped` | `launcher-dist/spec.md` | same |
| `wsl-preflight` | `wsl-preflight/spec.md` | same |
| `wsl-seam-doctrine` | `wsl-seam/spec.md` | same |
| `wsl-tool-path-persistence` | `environment/spec.md` | same |

Representative raw output (`wsl-ci-parity`, exit 1):

```text
Change 'wsl-ci-parity' has issues
✗ [ERROR] ci/spec.md: No delta sections found. Add headers such as "## ADDED Requirements" or move non-delta notes outside specs/.
✗ [ERROR] file: Change must have at least one delta. No deltas found. …
```

Root cause confirmed in file: each used `## ADDED Requirement: <title>` (singular, title on the H2) instead of the parseable:

```text
## ADDED Requirements
### Requirement: <title>
#### Scenario: <name>
```

No package needed a content change to validate.

## 2. Header transform (content-preserving)
DONE

Mechanical transform only, applied to the five `specs/**/spec.md` files:

1. First `## ADDED Requirement: <title>` → `## ADDED Requirements` + blank line + `### Requirement: <title>`
2. Each subsequent `## ADDED Requirement: <title>` in the same file → `### Requirement: <title>`

Headers transformed per package: 2 / 3 / 3 / 3 / 2 (ci / launcher / preflight / seam / tool-path).

No requirement body, scenario text, titles, or bullet lists were rewritten.

## 3. Post-fix validate (five packages — all valid strict)
DONE

```text
/usr/local/bin/openspec validate wsl-ci-parity --strict            → exit 0  "Change 'wsl-ci-parity' is valid"
/usr/local/bin/openspec validate wsl-launcher-shipped --strict     → exit 0  "Change 'wsl-launcher-shipped' is valid"
/usr/local/bin/openspec validate wsl-preflight --strict            → exit 0  "Change 'wsl-preflight' is valid"
/usr/local/bin/openspec validate wsl-seam-doctrine --strict        → exit 0  "Change 'wsl-seam-doctrine' is valid"
/usr/local/bin/openspec validate wsl-tool-path-persistence --strict → exit 0  "Change 'wsl-tool-path-persistence' is valid"
```

## 4. Regression validate (other 28 packages)
DONE

The other 28 live packages (excluding `archive/`) all still PASS under
`/usr/local/bin/openspec validate <pkg> --strict` after the transform.
No regressions observed. Full list in §7.

## 5. openspec/README.md claim update
DONE

Before: claimed "Eight packages predating v0.2.9 use `## ADDED Requirement: <title>` and do **not** validate. That is recorded rather than silently migrated…"

After: states that all 33 live packages validate under `--strict`, names the five WSL packages as migrated by header-only transform, requires the parseable form for new packages, and points operators at `/usr/local/bin/openspec` (not `npx`).

The documented-claim-versus-reality drift is closed.

## 6. Content-preservation proof (diff touches only headings)
DONE

Automated check over `git diff -U0` for the five specs: every `+/-` line is either

- a removed `## ADDED Requirement: …` heading,
- an added `## ADDED Requirements` heading,
- an added/replaced `### Requirement: …` heading, or
- the single blank line inserted after the new section header.

**CONTENT-PRESERVATION OK.** No prose hunks.

`git diff --word-diff` (quoted for each package) shows only heading token moves:

### wsl-ci-parity

```text
## ADDED {+Requirements+}

{+###+} Requirement: ubuntu-latest runs shellcheck and the bats suite on every relevant PR
…
[-## ADDED-]{+###+} Requirement: windows-latest uses shell: bash for the Git-Bash half
```

### wsl-launcher-shipped

```text
## ADDED {+Requirements+}

{+###+} Requirement: Setup builds the POSIX launcher when absent
…
[-## ADDED-]{+###+} Requirement: readiness reports the launcher's absence loudly, DEGRADED (not NOT-READY) when bun is also absent
…
[-## ADDED-]{+###+} Requirement: the frozen launcher-absent degraded fallback is unchanged
```

### wsl-preflight

```text
## ADDED {+Requirements+}

{+###+} Requirement: the preflight runs before any event-log write and refuses an unsafe FOREMAN_HOME (FOREMAN_HOME only, override available)
…
[-## ADDED-]{+###+} Requirement: the preflight warns on a stale WSL build
…
[-## ADDED-]{+###+} Requirement: the preflight warns on cross-boundary networking and tool-resolution risk
```

### wsl-seam-doctrine

```text
## ADDED {+Requirements+}

{+###+} Requirement: browser-callback auth flows on WSL are operator-foreground
…
[-## ADDED-]{+###+} Requirement: the pueue daemon on WSL is restart-on-demand, not persistent
…
[-## ADDED-]{+###+} Requirement: every directly-exec'd tracked script is executable-or-guarded
```

### wsl-tool-path-persistence

```text
## ADDED {+Requirements+}

{+###+} Requirement: vendor CLIs resolve WSL-native without relying on ~/.bashrc
…
[-## ADDED-]{+###+} Requirement: grok-readiness UNIT tests do not depend on live grok reachability
```

No word-diff hunk alters requirement or scenario prose.

## 7. Aggregate before/after validate (all 33 packages)
DONE

| When | PASS | FAIL | Total |
|---|---:|---:|---:|
| Before transform | 28 | 5 (all WSL) | 33 |
| After transform | 33 | 0 | 33 |

### Before (failures only)

```text
FAIL wsl-ci-parity
FAIL wsl-launcher-shipped
FAIL wsl-preflight
FAIL wsl-seam-doctrine
FAIL wsl-tool-path-persistence
```

(28 others PASS; error class = "No delta sections found" for each fail.)

### After (full)

```text
PASS agy-lane-activation
PASS audit-groundedness-gate
PASS crlf-extensionless-hardening
PASS cross-vendor-audit-routing
PASS decision-lineage-and-telemetry
PASS doctrine-reality-drift
PASS evidence-contracts
PASS formal-model-suite
PASS graph-context-builder
PASS graph-dogfood
PASS graph-eval-falsification
PASS graph-store-port
PASS knowledge-plane-refresh
PASS lane-ownership-and-reaping
PASS lock-primitive-hardening
PASS readme-refresh
PASS regression-harness-tiers
PASS release-metrics
PASS round-ownership-default
PASS terminusdb-adapter
PASS terminusdb-operations
PASS terminusdb-schema
PASS test-infrastructure-hardening
PASS three-outcome-verdicts
PASS vendor-adapter-contract
PASS vendor-concurrency-and-quota
PASS vendor-preflight
PASS work-dag-projection
PASS wsl-ci-parity
PASS wsl-launcher-shipped
PASS wsl-preflight
PASS wsl-seam-doctrine
PASS wsl-tool-path-persistence
SUMMARY pass=33 fail=0 total=33
```

### Checker soundness (known-bad observed failing)

A temporary package `_known-bad-demo` with the legacy `## ADDED Requirement: …` header was validated with `/usr/local/bin/openspec validate _known-bad-demo --strict`:

```text
✗ [ERROR] demo/spec.md: No delta sections found. …
known-bad exit=1
SOUNDNESS OK: known-bad failed as expected
```

Temp package removed after the demonstration. Harness/checks exit non-zero on failure (observed).

---

**No git commit performed.** No graphify. No bats invoked (not required for this brief). CLI used: `/usr/local/bin/openspec` only.
