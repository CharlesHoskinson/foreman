# CLI Adapters

Each vendor adapter (`scripts/adapters/claude.sh`, `codex.sh`, `grok.sh`) exposes the same
contract, dispatched by `worker-run.sh` (IMPLEMENT) and `audit-run.sh` (AUDIT):

```
run_worker <worktree> <prompt-file> <session-id>   → normalized event log + result envelope
run_audit  <diff-file> <criteria-file>             → verdict JSON
```

## Verified per-CLI facts (design spec §8, verbatim)

| CLI | Worker invocation | Audit invocation | Gotchas |
|---|---|---|---|
| Claude Code | `claude -p --output-format stream-json --dangerously-skip-permissions` (in-container only) | `claude -p --json-schema` read-only tool allowlist | `--bare` may become default for `-p`; cost reported in result JSON |
| Codex | `codex exec --json -C <dir>` | `codex exec --output-schema -s read-only -` (diff on stdin) | `codex review --json` **does not exist** (open request); `-p` means `--profile`; stderr/stdout split; needs git repo or `--skip-git-repo-check` |
| Grok Build | `grok -p <file> --output-format streaming-json --always-approve` (in-container only) | same, read-only prompt + schema-forced verdict | `streaming-json` ≠ Claude's `stream-json`; detect xAI binary vs community grok-cli sharing `~/.grok/` |

## The three gotchas, in detail

1. **`codex review --json` does not exist.** It looks like the natural command for a
   structured audit, but it was never shipped (tracked upstream as `openai/codex#6432`).
   The Codex adapter's structured audit path goes through `codex exec --output-schema`
   instead, reading the diff on stdin and writing the verdict via
   `--output-last-message`.
2. **`-p` means `--profile` in Codex, not "prompt".** This is the opposite of Claude
   Code and Grok Build, where `-p` takes the prompt (a file's contents, for the worker
   invocation) directly. The Codex worker adapter instead pipes the prompt file on stdin
   to `codex exec --json ... -` and never uses `-p` for a prompt at all.
3. **`streaming-json` (Grok) is not the same string as `stream-json` (Claude).** They are
   different vendors' names for conceptually similar streamed-event output formats, and
   using the wrong one is a silent CLI-argument mismatch, not a hard error, on at least
   one of the vendors. There is also a **binary-identity gotcha for Grok**: the xAI
   binary and the community `superagent-ai/grok-cli` project both install as `grok` and
   both read from `~/.grok/`, but only the xAI binary supports the flags this harness
   depends on. `install.sh` checks `grok --version` to confirm the xAI binary is what's
   on `PATH` before relying on it.

## As-built adapter reality

The adapters (`skills/foreman/scripts/adapters/`) implement the matrix above with a few
concrete details worth knowing when debugging a round:

- **Prompt delivery.** All three worker commands read the prompt from
  `${FOREMAN_PROMPT:-/task/prompt.md}` inside the container — never string-interpolated
  into the shell command itself (spec §6.3: the prompt is a file, mounted into the
  container, and `docker-run.sh` sets `FOREMAN_PROMPT` when it differs from the default
  mount path). The worker commands are literally:
  - Claude: `claude -p "$(cat "${FOREMAN_PROMPT:-/task/prompt.md}")" --output-format stream-json --verbose --dangerously-skip-permissions`
  - Codex: `codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox - < "${FOREMAN_PROMPT:-/task/prompt.md}"`
  - Grok: `grok --no-auto-update -p "$(cat "${FOREMAN_PROMPT:-/task/prompt.md}")" --output-format streaming-json --always-approve`

  Full-auto/always-approve flags on the worker side are acceptable *only* because the
  container is the actual security boundary (spec §7 S1) — they must never be used
  outside a hardened container.

- **Claude audit uses a read-only tool allowlist.** `adapter_run_audit` in `claude.sh`
  invokes `claude -p "$(cat "$prompt")" --output-format json --json-schema "$schema"
  --allowedTools "Read,Grep,Glob"` — restricting the auditor to read-only tools even
  though the audit prompt itself already tells the model not to touch anything. The
  adapter then extracts `.structured_output` from the JSON result via `jq`.

- **Codex audit runs sandboxed and reads the diff on stdin.** `codex exec --sandbox
  read-only --skip-git-repo-check --output-schema "$schema" --output-last-message
  "$out" - < "$prompt"` — the verdict is written directly to `$out` by
  `--output-last-message`, no extra parsing needed.

- **Grok has no native schema forcing for the audit**, so the adapter relies on the
  audit prompt demanding a bare verdict JSON object as the model's final answer, then
  extracts it defensively: `jq -r '.result // .content // empty'` on the raw CLI output,
  piped into a small Python script that runs a real `json.JSONDecoder().raw_decode`
  scan over the text (not a regex) looking for `{`-delimited objects, keeping the last
  one that parses as a dict containing a `verdict` key. This handles nested braces and
  braces embedded inside string values, which a naive regex-based JSON extraction would
  mishandle.

## Enforcement note

Orchestrator vendor ≠ worker vendor is enforced by `worker-run.sh` (exit code 2 if
violated); worker vendor ≠ audit vendor is enforced the same way by `audit-run.sh`. Both
checks are deterministic script logic, not something the orchestrator prompt is trusted
to self-enforce.
