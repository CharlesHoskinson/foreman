# Grok bounded work and report design

Status: approved for implementation on 2026-09-15.
The user selected implementation with GPT-6 after the separate-process proposal.
Implementation starts with hard-budget admission and strict terminal report validation.
No live qualification, independent approval, or installation is claimed.

## Objective

Run Grok 4.6 coding work through Foreman with native login, then obtain a strictly validated report.
Preserve the original workspace grants, selected account, requested effort, and total job limits.
Use actual files and host checks as acceptance evidence.
Do not infer completion from a model report.

The controlling research dossier is in the Moriarty repository vault:
`raw/sources/grok-4.6-adapter-2026-09-15/RESEARCH.md`.
The original login repair plan retains attempts 01 through 14.

## Research conclusions

The public API, Grok Build CLI, and ACP are different interfaces.
API support does not establish native-login transport support.
The installed executable is Grok 1.0.30.
The inspected upstream source is `482711333c7195dc16a272777f86086d615e2afb`.
Those identities are not proven equivalent.

ACP supports a response schema on each prompt.
Its final metadata contains a structured result separately from streamed progress.
The inspected `toolOverrides` object configures search filters, not tool removal.
No inspected public ACP operation establishes complete mid-session tool revocation.

The current adapter validates token and USD limit fields but does not enforce or account for them.
The native process supervisor enforces a deadline and output bytes.
The adapter counts tool requests and checks durable permissions.
These controls are not a complete token or billing budget.
The redesign must not preserve this gap behind an unchanged limits object.

## Alternatives

| Option | Benefit | Limitation | Decision |
| --- | --- | --- | --- |
| Two prompts in one native session | Preserves conversation state and avoids another startup | No established tool-revocation operation. Background work and missing usage remain problems. | Retain as an option only after stronger native controls are qualified. |
| Separate coding and reporting processes | Process cleanup ends coding authority. Reporter receives immutable evidence and no workspace tools. | Loses original conversation context and adds startup cost. Hard budget support still needs evidence. | Recommended. |
| Public Responses API with host-executed tools | Explicit tool loop and documented usage fields | Requires separately authorized API credentials and billing. Native login is not an API key. | Do not substitute automatically. |

The recommendation preserves the model, account, effort, permission ceiling, and total budget.
It does not preserve the native session ID across phases.
Each phase has its own observed session identity under one Foreman effect.
The second process has strictly less authority.

## Execution sequence

```text
ADMIT -> WORK -> STOP_AND_CAPTURE -> REPORT -> VALIDATE -> COMPLETE
            any failure -> STOP_AND_PRESERVE -> INCOMPLETE
```

### Admit

Resolve the exact executable, credential reference, worktree, model, effort, and approved input.
Require a current capability record bound to those identities.
Reject unsupported hard limits before a model request.
Keep one original deadline and spend reservation.
Reserve part of the existing token and byte allowances for reporting.
Reject a job whose total allowance cannot cover both phases.

There is no new campaign, scheduler, retry owner, or independently replenished phase budget.

### Work

Create one isolated coding process with the existing source-write grants.
Supply the approved task and admitted artifacts without a response-schema demand.
Keep trusted instructions separate from untrusted repository material.
Disable unneeded discovery, memory, subagents, remote tools, and background automation through qualified controls.
Do not replace Grok's operating instructions with a minimal output-format instruction.

Treat progress as progress, including text that resembles JSON.
Continue to require a durable host decision before each permitted tool execution.
Do not accept a model's permission assertion as evidence.
Recognize terminal reasons explicitly.
Do not start reporting after cancellation, refusal, exhaustion, malformed identity, or an unknown outcome.

### Stop and capture

Close the coding process and its owned descendants through the existing supervisor.
Confirm cleanup before starting the reporting process.
Capture candidate content through the existing immutable candidate mechanism.
Preserve the actual diff, permitted paths, original Git identity, and required host check results.
Reject late changes, extra files, altered Git metadata, or an unobserved process outcome.

This phase does not run a second copy of the product verification gate.
Reuse the existing Pel verification owner at its registered point.
The transport qualification still performs its exact-byte and boundary checks.

### Report

Start a fresh Grok 4.6 process for the same selected account and effort.
Give it the immutable task, candidate identifiers, and available host evidence.
Do not transfer private reasoning, access tokens, mutable session directories, or unbounded tool output.
The reporter receives no writable source mount and no executable workspace tools.
Require a qualified empty or formatter-only catalog and a host denial boundary.
Reject unexpected tool requests without granting them.

Request the lowered schema on this prompt.
Accept the session-bound and model-bound `structuredOutput` only after the terminal response.
Reject missing or malformed structured metadata.
Do not extract JSON from prose or concatenate progress into the report.
An internal schema formatter is not authority to access the filesystem.

### Validate and complete

Validate the report against the exact host schema.
Bind it to the immutable candidate and evidence identifiers.
A report cannot establish passed tests, changed files, or a new permission grant.
Emit one outer completion only after both scoped processes have finished and the host checks pass.
Preserve partial candidate evidence on failure without reporting success.
Publication and independent review remain separate Pel actions.

## Resource contract

One ledger covers startup, coding, reporting, automatic retries, compaction, and any auxiliary model requests.
Input tokens include repeated context presented to later requests.
Output tokens include reasoning when the provider accounts for it as output.
Count each native request once, not once per cumulative streaming update.
Do not add last-call counters to whole-prompt totals.
Keep tool invocations distinct from model turns.

The original absolute deadline never moves.
The reporting phase receives only remaining resources after its reserved allowance is reconciled.
The coding and reporting output-byte counts share one total.
No retry, new process, session change, or recovery resets the counters.

Missing usage is unknown.
Unknown cost is not zero and is not an estimate of API billing.
API token prices do not establish native subscription charges.
Post-response billing can reconcile a charge but cannot prevent an overshoot.

Hard token and monetary limits require a qualified pre-request enforcement mechanism.
If the selected native runtime cannot provide one, return `UnsupportedCapability` before dispatch.
Do not fall back to prompt instructions, per-response caps, hook callbacks, or rate limits.
An upstream runtime change may be necessary, but its implementation is not established by this design.
The first implementation milestone is to resolve that capability gap, not launch another paid test.

## Component boundaries

| Component | Responsibility | Existing code to retain |
| --- | --- | --- |
| Native admission | Exact identity, credential, runtime capabilities, and limits | Provider profiles, native host validation, credential capability |
| ACP peer | JSON-RPC IDs, session binding, notifications, terminal responses | Existing native connection and scoped process port |
| Work/report controller | Two phase lifetimes and one outer result | Provider transport and Pel effect ownership |
| Usage projection | Whole-prompt receipts, deduplication, unknown states | Provider usage types and existing spend authority |
| Permission boundary | Workspace tools, durable decisions, reporter denial | Native permissions and namespace boundary |
| Evidence handoff | Immutable candidate and bounded report input | Existing candidate capture and artifact ports |

Use Node.js 24 and TypeScript for Foreman code.
Use Effect for failures, scoped lifetimes, cancellation, and concurrent protocol handling.
Do not add a second durable store or a generic agent framework.
Split the current large adapter only along the responsibilities above.

## Required acceptance tests

1. Coding receives no output-schema requirement. Reporting receives the exact lowered schema.
2. Both phases observe Grok 4.6, the selected effort, and the selected account reference.
3. Coding can make the exact admitted edit through a durable permission receipt.
4. JSON-shaped progress cannot complete either phase or forge a report.
5. Reporting cannot read mutable source state, write files, or execute a command.
6. A background child or late write prevents reporting or invalidates the captured candidate.
7. Exhaustion and cancellation between phases start no second process.
8. Both phases share the original deadline, counters, reservation, and output-byte ceiling.
9. Missing, decreasing, duplicated, mismatched, and partial usage receipts do not replenish resources.
10. Unsupported hard token or monetary enforcement starts no paid request.
11. Malformed, missing, or foreign-session structured output produces no completion.
12. Extra files and Git metadata changes fail the exact qualification predicate.
13. Process cleanup precedes final filesystem observation and secret-snapshot removal.
14. A fresh independent reviewer assesses the exact candidate after host verification.

Use deterministic protocol and namespace fixtures before live qualification.
Then run one admitted live exact-edit qualification with the selected account.
Its result must satisfy all required capabilities in the same run.
Do not combine a previous edit with a later successful JSON response.

## Review disposition

Research supports phase separation but does not prove the complete design feasible on stock Grok 1.0.30.
The user approved process-separated reporting and requested GPT-6 implementation.
The hard-budget capability gap remains blocking for live dispatch.
No broader Moriarty roadmap item closes through this proposal.

## Implementation boundary findings

The current native boundary permits no-tools execution only for `claude-code`.
Grok authentication snapshots currently require a coding request.
The boundary also mounts the mutable source tree read-only outside its writable paths.
Read-only access does not make that source tree immutable evidence.

The reporting phase therefore needs a distinct admitted mount layout and authentication path.
Do not reuse a coding boundary with tool flags and describe it as a qualified reporter.
Do not enable the reporting phase before hard-budget enforcement is established.
Protocol fixtures can establish parser behavior without authorizing a native process.
