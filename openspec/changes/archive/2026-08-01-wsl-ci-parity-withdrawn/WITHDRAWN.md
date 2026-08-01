# WITHDRAWN 2026-08-01 — wsl-ci-parity

Archived, not deleted. It exists to solve a problem that no longer exists.

## Why

The package's premise is that the bats suite runs on no CI platform. That was
true when it was written and is false now.

`proposal.md:7` and `design.md:9` both state the suite "runs on NO CI platform
today". Measured on `main`:

- `.github/workflows/` holds **five** workflows, not two:
  `formal.yml`, `gates-linux.yml`, `gates-windows.yml`, `maintenance.yml`,
  `windows-smoke.yml`.
- `grep -rn FOREMAN_CI_BATS .github/workflows/` shows `gates-linux.yml` setting
  it to `"1"` — the suite runs, and gates, on every push and pull request.

The same dead premise propagated into `test-infrastructure-hardening/proposal.md`
(which asserts "exactly two jobs") and `regression-harness-tiers/proposal.md`.
Those two packages have other live content and are corrected in place rather
than withdrawn; this one has nothing left once the premise goes.

## What replaced it

`gates-linux.yml` and `gates-windows.yml`, which did not exist when this package
was written. Criterion 3 of the v0.2.9 checklist — both workflows green on `main`
with a recorded red run proving each can fail — is met and ticked.

## What must NOT be lost

**Parity is not achieved, only Linux coverage is.** `gates-windows.yml:73` sets
`FOREMAN_CI_BATS: "0"`, which disables the **full gate** on the Windows runner.

Be precise about what that does and does not mean — an earlier draft of this
file said the suite "does not run on the Windows runner at all", and a
cross-vendor audit caught it. `gates-windows.yml` runs a deliberate **two-file,
non-gating probe** over `tests/line-endings.bats` and `tests/plugin-drift.bats`,
each under the same timeout bound `tests/run.sh` uses and capturing bats' own
exit status rather than a pipeline's. So Windows does execute bats; what it does
not do is gate on the suite. `docs/RESIDUALS.md` records that provisioning a
tool and passing with it are different claims — and this is a third claim again:
running a probe is not running the suite.

That gap is the surviving half of this package's intent, and it is why
checklist criterion 2 stays unticked: the criterion asks for the bats gate ON
"in `ci-local.sh` and CI", and it is on in `ci-local.sh` and in `gates-linux`
only. Whoever closes that gap should re-read this package's `specs/` for the
parity requirements before writing new ones.
