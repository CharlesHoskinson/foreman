# Cross-CLI Council: compatibility and production best practices

Research date: 2026-08-01. This is an evidence and requirements report only; it does not include implementation.

## Recommendation

Build Council as a small durable orchestrator with one adapter per CLI, a canonical append-only event stream, and thin platform-specific plugin wrappers. Do not make one CLI's wire format or plugin manifest the internal API.

The stable common denominator is:

1. launch a non-interactive subprocess with an explicit working directory and permission policy;
2. consume JSON or JSONL events when the CLI supports them;
3. normalize events and usage into a provider-neutral schema;
4. persist state before acknowledging progress or requesting human input;
5. validate final output against Council's own JSON Schema;
6. stop on explicit time, token, cost, turn, and concurrency limits; and
7. package the shared MCP server and skills through separate native manifests.

Multi-agent fan-out should be opt-in or policy-gated in v1. Anthropic reports that its multi-agent research system used about 15 times as many tokens as chat, and also says most coding tasks have fewer truly parallelizable branches than research. The same post reports up to a 90% research-time reduction when it used parallel subagents and parallel tool calls. The correct product rule is therefore "parallelize independent, valuable work within a declared budget," not "always ask every agent." [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)

## CLI compatibility matrix

| Surface | Machine mode | Streaming/events | Schema-constrained final output | Resume | Packaging implications |
| --- | --- | --- | --- | --- | --- |
| Codex | `codex exec` | `--json` emits JSONL such as `thread.started`, `turn.*`, `item.*`, and `error`; progress otherwise goes to stderr | `--output-schema`; `turn.completed` includes token usage | `codex exec resume` | `.codex-plugin/plugin.json`; root-level `skills/`, `.mcp.json`, `hooks/`; repo or personal marketplace |
| Claude Code | `claude -p`; `--bare` is recommended for reproducible scripts | `--output-format stream-json --verbose`; subagent lineage is available through `parent_tool_use_id` | `--json-schema`; final JSON contains `structured_output`; JSON metadata includes `total_cost_usd` | `--continue` / `--resume` | `.claude-plugin/plugin.json`; components remain at plugin root; use `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` |
| Gemini CLI | `gemini -p` or non-TTY | `--output-format stream-json`; defined `init`, `message`, `tool_use`, `tool_result`, `error`, `result` events | No schema flag is documented on the selected headless reference; validate in Council | session metadata is emitted; use the CLI's session controls separately | root `gemini-extension.json`; `${extensionPath}` for portable MCP commands; extension changes require reload/restart |
| Grok Build | `grok -p`; use `--no-auto-update` in automation | `--output-format streaming-json`; ACP mode is JSON-RPC over stdio via `grok agent stdio` | No schema flag is documented on the selected Grok headless page; validate in Council | `--session-id`, `--resume`, `--continue` | Native Grok plugin roots exist; Grok also reads Claude Code plugins, skills, MCP, agents, hooks, and marketplaces |

Sources: [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive), [Claude programmatic mode](https://code.claude.com/docs/en/headless), [Gemini headless reference](https://geminicli.com/docs/cli/headless/), and [Grok headless and ACP reference](https://docs.x.ai/build/cli/headless-scripting).

Important incompatibilities:

- The streaming flag value is `stream-json` for Claude and Gemini, `streaming-json` for Grok, and `--json` for Codex.
- JSON event names and terminal records differ. Treat them as adapter input, not Council's public contract.
- Only the selected Codex and Claude CLI references document a JSON Schema constraint for the final response. Council must validate every provider's normalized final result and repair or fail closed on mismatch.
- Cost telemetry is uneven. Claude exposes `total_cost_usd`; Codex exposes token usage in `turn.completed`; Gemini's result includes aggregated statistics and per-model token usage; the selected Grok page promises JSON events but does not define a cost schema. A Council-side price table is necessary, with an `estimated` marker where the provider does not return billed cost.
- Exit semantics differ. Gemini documents `0`, `1`, `42`, and `53`. Claude documents graceful SIGTERM behavior and exit 143. The other adapters must classify exit code, terminal event, and parse state together rather than equating any nonzero exit with one generic failure.

## Specific v1 requirements

### Orchestration and state

- **ORCH-01 — Bounded fan-out.** Default to one lead plus no more than three independent advisers. The planner must assign each adviser a distinct objective, expected JSON result shape, evidence requirement, and stop condition. Reject duplicate assignments before launch.
- **ORCH-02 — Dependency-aware scheduling.** Run only independent branches concurrently. Serialize branches that share mutable workspace state. A read-only advisory Council may fan out; implementation agents must use isolated worktrees or run sequentially.
- **ORCH-03 — Canonical lifecycle.** Persist `queued -> running -> input_required | completed | failed | cancelled`. Terminal states never change. This mirrors the MCP task state model while remaining an internal contract. [MCP Tasks specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
- **ORCH-04 — Attempts are explicit.** Give each run, branch, step, and attempt a stable ID. Retrying creates a new attempt under the same step; it never creates an indistinguishable duplicate step.
- **ORCH-05 — Checkpoint before handoff.** Persist the plan before fan-out, each normalized terminal branch result before synthesis, and approval state before waiting. Resume from the last committed boundary, not from the beginning. Anthropic combines regular checkpoints and retries because stateful agent errors compound; Restate shows how committed journal entries make recovery deterministic. [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system), [Restate](https://restate.dev/blog/building-a-modern-durable-execution-engine-from-first-principles)
- **ORCH-06 — Version pinning.** Record the Council version, adapter version, CLI executable path and version, plugin/skill version, model, prompt/template hash, output-schema version, and policy version at run start. An in-flight run resumes with the same recorded interpretation or fails with a clear incompatibility error.
- **ORCH-07 — Synthesis is a separate stage.** Preserve adviser outputs as immutable artifacts and give the synthesizer references plus compact summaries. Never replace raw adviser evidence with only an LLM paraphrase.

### Subprocess and cross-platform behavior

- **PROC-01 — No shell interpolation.** Spawn the resolved executable with an argument array and explicit `cwd`, stdin/stdout/stderr pipes, environment allowlist, and output-size limits. Shell mode is prohibited unless an adapter has a documented, tested need for it.
- **PROC-02 — Stream discipline.** Parse stdout line by line as JSONL where available. Keep stderr as diagnostics. A malformed line becomes a typed `protocol_error` with a bounded raw excerpt; it must not crash the whole event reader or be silently discarded.
- **PROC-03 — Backpressure and limits.** Set bounded queues and maximum line, event, stderr, and total-output sizes. Persist events before releasing queue capacity. Slow consumers must not cause unbounded memory growth.
- **PROC-04 — Cancellation ladder.** On cancel: mark `cancel_requested`, stop scheduling new work, use the provider/protocol cancellation method if advertised, request graceful process termination, wait a short configured grace period, then terminate the whole process tree. Late events are stored as late but cannot change the terminal state. MCP requires cancellation capability negotiation and says cancelled tasks remain cancelled even if execution continues. [MCP Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
- **PROC-05 — Platform-specific tree ownership.** Use a POSIX process group on Linux/macOS/WSL and a Windows Job Object or equivalent tree owner on native Windows. This is an implementation inference from the documented platform differences; it must be integration-tested rather than assumed. Claude provides a useful conformance case because its headless mode documents that SIGTERM aborts the turn, terminates the Bash process tree, runs end hooks, and exits 143. [Claude headless docs](https://code.claude.com/docs/en/headless)
- **PROC-06 — WSL capability probe.** Never assume WSL exists. Detect `wsl.exe` and a functional registered distribution, translate paths with `wslpath`, require `.exe` for Windows executables invoked from WSL, and keep file-intensive work on the same filesystem as the tool. Microsoft warns that `/mnt/c` and `\\wsl$` cross-filesystem tight loops incur 9P overhead. [Microsoft WSL interop](https://learn.microsoft.com/en-us/windows/dev-environment/wsl-interop)
- **PROC-07 — Reproducible startup.** Pin executable discovery and suppress ambient or mutable startup behavior. Examples: use Claude `--bare` for scripted calls, Grok `--no-auto-update`, explicit Codex config/rules behavior, and explicit Gemini extensions. Record any loaded plugin/MCP inventory from startup events where provided.

### Structured output and adapter contract

- **DATA-01 — Canonical event envelope.** Every event contains `schema_version`, `event_id`, `run_id`, `branch_id`, `step_id`, `attempt`, monotonic `seq`, UTC timestamp, provider, provider session/thread ID, event type, payload, and redaction metadata.
- **DATA-02 — Minimum event taxonomy.** Support `run.created`, `process.started`, `provider.init`, `message.delta`, `tool.started`, `tool.completed`, `usage.updated`, `checkpoint.committed`, `approval.requested`, `approval.resolved`, `retry.scheduled`, `cancel.requested`, `process.exited`, and one terminal run event.
- **DATA-03 — Raw provenance.** Store the original provider event or its content hash beside the normalized event. Preserve unknown provider fields under an extension namespace so adapters remain forward-compatible.
- **DATA-04 — Final-result schema.** Council's v1 result must include `status`, `summary`, `recommendations`, `evidence[]`, `disagreements[]`, `risks[]`, `usage`, and `artifacts[]`. Use `additionalProperties: false` for the stable core, and a versioned `extensions` object for provider-specific data.
- **DATA-05 — Validation policy.** Validate provider output locally even when the CLI enforced a schema. Permit at most one bounded repair attempt for a syntactically valid but schema-invalid final answer; otherwise finish as `failed/schema_invalid` and retain the raw output.
- **DATA-06 — Capability detection.** Adapters expose capabilities such as streaming, schema output, resume, interrupt, usage, billed cost, tool events, and subagent lineage. Detect from startup metadata when possible; do not branch only on a version string.

### Retries and idempotency

- **REL-01 — Retry classification.** Retry only transient launch, transport, rate-limit, and explicitly retryable provider failures. Do not retry invalid input, denied permission, schema incompatibility, missing credentials, human rejection, or deterministic tool errors.
- **REL-02 — One retry owner.** Avoid multiplicative retries across CLI, adapter, and orchestrator. The adapter reports provider retry events, and the orchestrator applies the outer policy only when the CLI has stopped.
- **REL-03 — Bounded full-jitter backoff.** Use capped exponential backoff with random jitter, a maximum attempt count, and an overall deadline. Stripe explains that jitter prevents synchronized clients from creating a thundering herd. [Stripe Engineering](https://stripe.com/blog/idempotency)
- **REL-04 — Stable idempotency key.** Side-effecting steps use a caller-generated key derived from the run and logical step, reused across attempts. Atomically store key, request hash, state, and result. Return the stored semantically equivalent result for a duplicate. Reject the same key with different parameters. AWS describes caller-provided request IDs, atomic recording, equivalent retry responses, late arrivals, retention windows, and parameter mismatch validation. [Amazon Builders' Library](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
- **REL-05 — Side-effect ledger.** Record `not_started`, `in_flight`, `committed`, or `compensated` for every mutating tool call. An ambiguous process exit must surface `outcome_unknown` and require reconciliation; it must not blindly replay the mutation.
- **REL-06 — Retention.** Define an idempotency and event retention window longer than the maximum retry/resume window. Store request hashes to detect reused keys with changed intent.

### Budgets, observability, and evaluation

- **OPS-01 — Admission budget.** Every run declares hard limits for wall time, total input/output tokens, estimated or billed cost, tool calls, turns, concurrent branches, retries, and artifact bytes. Missing limits use conservative server defaults.
- **OPS-02 — Shared budget ledger.** Reserve budget before launching a branch and reconcile it from provider usage events. Stop new work at a soft threshold and cancel at the hard threshold. A branch cannot spend tokens already reserved by another branch.
- **OPS-03 — Trace model.** Emit one trace per Council run and spans for planning, each CLI attempt, each tool call, approval wait, checkpoint, and synthesis. Attach run/branch/attempt IDs, provider/model, latency, tokens, cost quality (`billed`, `reported`, or `estimated`), retry reason, exit code, and terminal classification.
- **OPS-04 — Privacy.** Logs and traces are content-redacted by default. Store prompts, model text, tool arguments, repository paths, and credentials only under an explicit retention policy. Anthropic reports useful high-level monitoring of decision patterns and interaction structures without inspecting conversation contents. [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)
- **OPS-05 — Required service metrics.** Track success and cancellation rates, schema failures, retry counts, timeout rate, queue and execution latency, time to first event, per-provider token/cost distribution, branch duplication, adviser disagreement, approval wait time, and orphan-process count.
- **OPS-06 — Evals before expansion.** Maintain a fixed suite of representative Council tasks and score end-state correctness, evidence quality, schema validity, latency, cost, and duplicated work. Add human review for subtle source quality, unsafe actions, and disagreement handling. Do not count lower cost or latency as an improvement if correctness regresses.

### Human-in-the-loop

- **HITL-01 — Explicit approval boundary.** Require approval before network writes, publication, external messages, pushes, deployments, destructive commands, credential use outside the initial scope, or budget expansion.
- **HITL-02 — Durable request.** Persist approval ID, action summary, exact normalized arguments or artifact hash, risk, requester, expiry, and run checkpoint before notifying the user. Approval applies only to that exact hash.
- **HITL-03 — Pause semantics.** Move the run to `input_required`, release compute where possible, and resume with the same run/version after approve, reject, edit, or timeout. MCP's task model provides a compatible external vocabulary but must be capability-negotiated. [MCP Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
- **HITL-04 — Rejection and expiry.** Rejection and expiry are typed outcomes, not transient failures, and are never automatically retried. A changed action requires a new approval.

### Plugin and MCP packaging

- **PKG-01 — Shared core, native wrappers.** Maintain one core MCP server, schemas, skills, and scripts, but generate/test distinct distributions rather than forcing one manifest:
  - Codex: `.codex-plugin/plugin.json`, root `skills/`, optional `.mcp.json`, `hooks/`.
  - Claude: `.claude-plugin/plugin.json`, root `skills/`, `agents/`, `.mcp.json`, `hooks/`; validate with `claude plugin validate`.
  - Gemini: root `gemini-extension.json` with `mcpServers` and `${extensionPath}`; test install, link, update, disable, and restart behavior.
  - Grok: test a native plugin load and the documented Claude-compatible load path; do not assume compatibility means identical policy or lifecycle behavior.

  Sources: [OpenAI packaging](https://developers.openai.com/plugins/build/plugins), [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference), [Gemini extension reference](https://geminicli.com/docs/extensions/reference/), [Grok plugins](https://docs.x.ai/build/features/skills-plugins-marketplaces).
- **PKG-02 — Portable paths.** All manifest paths are relative to the plugin/extension root. Use each host's substitution variable. Never bake developer absolute paths into a release.
- **PKG-03 — MCP stdio hygiene.** For a bundled stdio MCP server, stdout is protocol-only and logs go to stderr. Include startup and tool timeouts, capability negotiation, and a health/diagnostic command.
- **PKG-04 — Trust is not installation.** Installing a plugin must not auto-approve its hooks or tools. Ship deny-by-default permissions and require an explicit user/admin decision for write-capable MCP tools.
- **PKG-05 — Version and migration tests.** Pin semantic versions in releases, test upgrade/downgrade and cache behavior, and validate manifests in CI on Windows, WSL, Linux, and macOS. Claude notes that an unchanged explicit plugin version prevents users from receiving new commits; Gemini copies installed extensions and requires an update action.
- **PKG-06 — Minimal always-on context.** Keep skill and agent descriptions concise and load full instructions only on invocation. Do not register every adviser, schema, and workflow as always-on prompt text.

## Visual pass: what PixelRAG added

PixelRAG 0.4.0 `pixelshot` rendered the Anthropic source into three tiles, and the first two were inspected at original detail. The visual pass added three details that are easier to miss in text extraction:

1. the high-level architecture is a strict user -> lead agent -> several parallel search subagents -> lead aggregation flow;
2. the detailed process diagram places durable memory of the plan before subagent fan-out and shows a loop back to the lead before the final citation stage; and
3. the synchronous join is visually a single chokepoint, which reinforces Anthropic's written warning that one slow subagent can block the system.

This supports ORCH-02, ORCH-05, and ORCH-07: persist the plan, fan out only independent work, store branch artifacts independently, and make the join observable and cancellable. The screenshots are under `visuals/www.anthropic.com_engineering_multi-agent-research-system.png.tiles/`.

## Key risks and open compatibility tests

- Confirm exact JSON/JSONL schemas against pinned installed versions; documentation describes contracts, but event fields can evolve.
- Test cancel during model generation, tool execution, nested subagent work, approval wait, and stream backpressure on every OS.
- Test process-tree cleanup, especially native Windows and a Windows parent launching a WSL CLI.
- Verify whether each CLI reports provider retries, cached tokens, reasoning tokens, and cost consistently enough for hard budgets.
- Test missing or invalid plugins/MCP servers. Claude can continue successfully while reporting skipped MCP entries in startup metadata; Council must fail when a required capability is absent.
- Test schema-invalid but otherwise successful results from Gemini and Grok, and JSON truncation after forced cancellation.
- Treat Grok's Claude compatibility as a compatibility lane, not as the sole release artifact, until native and compatibility behavior pass the same conformance suite.

## Evidence artifacts

The machine-readable source catalog is `SOURCES.json`. Targeted Markdown extracts are in `extracts/`. PixelRAG screenshots and `tiles.json` are in `visuals/`. All were collected from public pages after a robots.txt review; no protected page or bypass mode was used. The temporary local Scrapling environment is not part of the corpus and is not indexed.
