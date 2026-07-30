# Design — vendor-adapter-contract

## What the contract is actually for

Not abstraction for its own sake. The contract exists because facts about
vendor CLIs are, today, encoded in four different kinds of place: a `case` arm
(grok/codex implement), a hard-coded block in a script (codex audit), prose in
an agent file (codex audit, again), and nowhere at all (claude, agy). When a
new fact arrives — `agy`'s prompt is the value of `--print`, and putting
`--print` anywhere but last with its value attached makes the process hang
forever — there is no place to put it that the whole system reads.

The eight contract points in R3 §0 are the complete set of things that differ
per vendor and that a caller must never guess: prompt delivery, write
authorization, read-only enforcement, structured verdict, result capture,
write evidence, config-home isolation, and the non-billing auth probe. Anything
outside that set is not vendor-specific and does not belong in an adapter.

R3 was written against `@google/gemini-cli` 0.52.0, which is installed on this
box but is **not** the CLI these lanes use and is not authenticated. The
vendor-independent doctrine in R3 survives that correction intact — it is the
per-flag detail that does not. Both facts are why the contract is worth having:
the vendor-specific half of R3 was invalidated by a change of binary, and the
adapter is the blast wall that keeps such a change out of `lane-run.sh`,
`audit-run.sh` and six agent files.

## Alternatives considered and rejected

**Grow `wc_build_argv`'s `case` to four vendors and add a second function for
audit.** Rejected. It is the smallest diff and the worst end state: eight
branches in two functions in one file, with `audit-run.sh` and
`agents/codex-auditor.md` still carrying their own copies of the codex audit
invocation. The thing that makes the current code hard to extend is not the
number of branches, it is that the two verbs live in different files under
different conventions. Adding vendors without unifying the verbs multiplies
that.

**A declarative vendor table (TOML/JSON) that a generic builder renders into
argv.** Genuinely attractive, and rejected on evidence. The live argv shapes
are not renderings of one template: grok takes a *path*
(`--prompt-file "$SPEC"`), codex takes the *contents* as a positional
(`"$(cat "$SPEC")"`), and agy takes the contents as the *value of a flag that
must come last*. A data table cannot express "this flag is positional-order
sensitive and a misplacement hangs rather than errors" without a shell escape
hatch on its first day. The array-output convention (`WC_ARGV`, now
`ADAPTER_ARGV`) exists specifically so that no argv element is ever
re-interpreted by a shell; keeping the adapters as shell functions preserves
that guarantee, and a rendered string does not.

**Adapters as executables invoked as subprocesses** rather than sourced
libraries. Rejected: an executable can only return a string, which reintroduces
the shell re-interpretation the array convention was built to prevent, and it
costs a fork per lane on a path that already pays fork tax (see
`test-harness-fork-tax`).

**Write a plain-GPT (non-Codex) lane** to "broaden GPT". Rejected on R3 §2.4:
there is no first-party non-Codex GPT CLI, so a plain-GPT lane means Foreman
maintains its own Responses-API client, its own tool loop and its own
file-write layer — re-implementing precisely what the adapter contract exists
to avoid, and losing the sandbox. Broadening GPT is instead
model-and-profile parameterization of the codex adapter: promote the existing
`WC_CODEX_MODEL` to config, and pass `-p/--profile` through so a repo can pin
model, reasoning effort and sandbox in `$CODEX_HOME/<name>.config.toml`.

**Leave `claude` as it is.** Rejected, and this is the package's sharpest
judgement. The four sites that advertise a claude lane are not harmless: they
are how a reader concludes claude is supported, and they are the template
someone would copy to add a fourth vendor. Half-wiring is worse than absence
because it fails late — after the readiness gate, after the worktree, after the
queue admission — and it fails with `unknown worker vendor`, which reads like a
config typo rather than a missing feature. The choice between finishing it and
removing it is an architect decision this package forces; it does not pre-empt
it, but it does refuse the third option.

## The never-stdin invariant needs an owner, and so does argument order

The stdin rule is currently satisfied by luck of vendor design and stated in a
comment. It has to become a property the adapters are tested for, not a rule a
future author is expected to have read.

Argument order is the same class of hazard and is worse, because its failure is
a hang rather than an error. Observed live on the reference box: with the
prompt supplied as a positional and a bare trailing `--print`, `agy` produced
no output for 180 s and had to be killed; with the prompt as the value of a
trailing `--print`, it answered immediately with rc 0. Every layer above the
adapter would misread the first case as a slow model.

Both are cheap to test: assert that no adapter's built argv contains a bare `-`
in a prompt-from-stdin position, that the prompt string appears exactly once
and as the value of the flag the adapter declares, and that any
order-sensitive flag occupies the position the adapter's caps declare.

## Write evidence is a contract point — owned by `evidence-contracts`, consumed here

`grok-multiround.sh` was written for grok's single-burst behaviour, and the
*capability* it provides is vendor-neutral: multiple silent-zero-write
mechanisms exist across the vendor set, all ending `rc=0` with the model
narrating a completed edit. No vendor's own report is admissible evidence that
a file changed. That much generalizes.

**Its predicate does not.** The load-bearing line was a sha256 of
`git status --porcelain` in the target worktree, compared before and after. On
2026-07-28 that predicate was measured returning a false negative on the most
common Foreman task: porcelain collapses an untracked directory to a single
`?? pkg/` line, so files 2..N written inside it produce a byte-identical digest,
and it is blind to content changes inside untracked files besides. `-uall` fixes
the first and not the second. A lane that had written all four required package
files correctly was reported `EMPTY-BURST FAILED`.

So the original plan to promote `snap()` into `lib/evidence.sh` under this
package is withdrawn on both counts. **`evidence-contracts` owns and implements
`lib/evidence.sh` and `vendor-multiround.sh`**, and replaces the predicate with
a content hash over a declared deliverable set plus a lane-type artifact
assertion. This package is a declared consumer. Its whole obligation at that
boundary is `adapter_implement_argv` and `adapter_caps`, plus two negative
assertions in `tests/adapters.bats`: no adapter decides a round on a status
digest, and any `git status` invocation this package still owns passes
`--untracked-files=all`.

The two details that looked incidental and are not — the hard failure when the
working dir is not a git work tree (`grok-multiround.sh:66-67`), and the
feed-forward of the prior round's captured output into the re-prompt preamble —
carry over into `evidence-contracts`' implementation, which specifies both.

## What "no behaviour change for grok and codex" means

This package is a refactor with one functional addition (the audit verb). The
existing grok and codex implement argv are frozen: the adapter SHALL produce
the same argv array `wc_build_argv` produces today, and a test SHALL compare
them element by element. If a reviewer finds a difference that is not
explicitly specced here, that is a defect in this package, not an improvement.

## Risks

- **A second source of truth for invocations.** `agents/*.md` describe vendor
  invocations in prose that architect models read. If the adapters and the
  agent files drift, soft mode and hard mode diverge silently. Mitigation: the
  agent files cite the adapter rather than restating flags, and a docs check
  asserts no agent file contains a raw vendor invocation.
- **The claude decision may be deferred in practice** by landing an adapter
  that is never exercised — half-wiring with extra steps. Mitigation: whichever
  branch is taken must be observable in `tool-check.sh`'s lane rows and in the
  test suite; an adapter with no passing lane test does not count as finished.
- **`audit-run.sh` is on the gate path.** Replacing its inline invocation
  touches the one script whose output `gate-eval.sh:43-47` consumes. The
  post-audit tamper check at `audit-run.sh:430-432` must survive the refactor
  unchanged in effect; `cross-vendor-audit-routing` strengthens it, and the two
  packages must not both rewrite it.
- **Vendor CLIs move under us.** `agy` self-updates: it carries an `updater/`
  directory and a `last_check.timestamp`, and it moved from 1.1.7 to 1.1.8
  during the single session in which this package was written. An adapter's
  flag set is a claim about a version, so `adapter_caps` records the version it
  was verified against and the round report records the version actually
  invoked. Without that, a silent update turns a verified adapter into an
  unverified one with no signal.
- **Scope creep into routing.** Deciding *which* vendor audits is deliberately
  not in this package. The adapter answers "how do I invoke vendor X for verb
  Y"; the router answers "which X". Conflating them is how `audit-run.sh:322-325`
  ended up refusing every non-codex auditor in the middle of an invocation
  builder.

## Demonstrated rejection — the two predicates this package still owns at the evidence boundary

| Predicate | Known-bad input it is demonstrated to reject | Demonstration |
|---|---|---|
| No adapter decides a round on a `git status --porcelain` digest | An adapter that reintroduces a local status-digest acceptance check | Fixture adapter containing a `status --porcelain \| sha256sum` acceptance branch; `tests/adapters.bats` must fail on it. A grep that passes trivially after reformatting is not sufficient — assert on the adapter's decision path, not on the string alone. |
| Any surviving `git status` invocation passes `--untracked-files=all` | A `git status --porcelain` call without `-uall`, which is verified to miss files 2..N inside an untracked directory | Fixture invocation without the flag must fail the assertion, and the same fixture must be shown to miss the second file. |

Both are negative assertions about this package's own code. The positive
control for the evidence mechanism itself is `evidence-contracts`' planted-write
corpus, which is where it belongs now that the mechanism has one owner.
