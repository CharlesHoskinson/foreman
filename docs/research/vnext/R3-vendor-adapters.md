# R3 — Vendor adapter contract: adding Gemini, broadening GPT

Research lane R3, Foreman vNext swarm. Written 2026-07-28.

**Evidence labels used on every claim in this document:**

| Label | Meaning |
|---|---|
| `VERIFIED-live` | Observed by running a read-only command on this host (WSL, 2026-07-28). Command shown or quoted. |
| `VERIFIED-docs` | Stated in an upstream vendor doc fetched this session (see "Sources fetched"). |
| `VERIFIED-repo` | Stated in Foreman's own committed research/plumbing at `/root/foreman`. |
| `INFERRED` | Reasoned from the above; **not** directly observed. Needs a test before it becomes doctrine. |

**Live-probe discipline:** every vendor command run for this lane was read-only
(`--help`, `--version`, `models`, `login status`, `--list-sessions`, `mcp list`).
No login/auth command was run. No vendor auth state was mutated. No billed
inference call was made — Gemini is unauthenticated on this host, so its probes
short-circuit before any model call, and grok/codex were probed only with their
non-billing auth-status commands.

---

## 0. Headline: the recommended adapter interface (read this first)

Foreman already has the seed of this: `skills/foreman/scripts/lib/worker-cmd.sh`
exposes `wc_build_argv VENDOR PROMPT_FILE WORKDIR` and fills a global `WC_ARGV`
array, covering `grok` and `codex` only, implement-only, hard-mode-only
(`VERIFIED-repo`). The recommendation is to **generalize that one function into a
per-vendor adapter file with eight contract points**, and to make soft mode and
hard mode share it.

Proposed layout: `skills/foreman/scripts/adapters/<vendor>.sh` for
`grok | codex | gemini | claude`, each sourcing nothing and defining:

```
adapter_implement_argv  VENDOR PROMPT_FILE WORKDIR             -> fills ADAPTER_ARGV
adapter_audit_argv      VENDOR PROMPT_FILE WORKDIR SCHEMA OUT  -> fills ADAPTER_ARGV
adapter_home_var        VENDOR                                 -> prints the isolation env var name
adapter_auth_probe      VENDOR                                 -> rc 0 = authed, non-0 = not (never bills)
adapter_result_text     VENDOR OUT_FILE STDOUT_FILE STDERR_FILE -> prints the final assistant text
adapter_result_verdict  VENDOR OUT_FILE STDOUT_FILE STDERR_FILE -> prints verdict JSON (schema-validated)
adapter_caps            VENDOR                                 -> prints k=v caps (resume, schema, sandbox, cap_n)
```

### The eight contract points, and what each vendor needs shimmed

| # | Contract point | grok | codex | gemini | claude |
|---|---|---|---|---|---|
| 1 | **Prompt delivery — never stdin** | `--prompt-file PATH` (native) | positional `"$(cat FILE)"` | `-p "$(cat FILE)"` — **no `--prompt-file` exists** | `-p` |
| 2 | **Write authorization (implement)** | `--allow Write --allow Edit` | `--sandbox workspace-write` | `--approval-mode auto_edit --skip-trust` | `--dangerously-skip-permissions` (container only) |
| 3 | **Read-only enforcement (audit)** | `--permission-mode plan` + `--disallowed-tools` | `--sandbox read-only` | `--approval-mode plan` (+ `-s`) | disallowed write tools |
| 4 | **Structured verdict** | `--json-schema "$(cat SCHEMA)"` (inline JSON, native) | `--output-schema SCHEMA` (file, native) | **none — biggest shim**: prompt-forced JSON inside `.response`, extract with `jq -r .response` then validate | `--json-schema` |
| 5 | **Result capture** | `--output-format json` → one object on stdout | `--output-last-message FILE` | `--output-format json` → `.response` on **stdout**, but the **error object goes to stderr** — tee both | `--output-format stream-json` |
| 6 | **"Did it actually write?" evidence** | git-status digest (`grok-multiround.sh`) | git-status digest | git-status digest — **equally required**, see §1.6 | git-status digest |
| 7 | **Config-home isolation** | `GROK_HOME` | `CODEX_HOME` | `GEMINI_CLI_HOME` (`VERIFIED-live`, §1.9) | `CLAUDE_CONFIG_DIR` (insufficient — needs distinct `$HOME`) |
| 8 | **Setup-stage auth probe (non-billing)** | `grok models`, positive-signal match | `codex login status` | `gemini --list-sessions`, rc `41` = not authed | `claude auth status` |

### Three concrete refactors this implies

1. **`lib/worker-cmd.sh` → `adapters/<vendor>.sh`.** Keep `WC_ARGV`'s
   array-output convention (callers spawn argv directly, no shell
   re-interpretation) but add the `audit` verb, which today has no argv builder
   at all — `agents/codex-auditor.md` hard-codes its own `codex exec` block in
   prose (`VERIFIED-repo`). One argv builder, two verbs, four vendors.
2. **`lane-run.sh`'s `LANE_VENDOR` map grows one row.** The T5a contract maps
   `grok->GROK_HOME`, `codex->CODEX_HOME`, `claude->CLAUDE_CONFIG_DIR`
   (`VERIFIED-repo`, header comment). Add `gemini->GEMINI_CLI_HOME`. The
   existing `lane_normalize_config_dir` cygpath handling applies unchanged —
   Gemini CLI is a Node program and takes a POSIX or mixed path equally.
3. **`grok-multiround.sh` → `vendor-multiround.sh`.** Its `snap()` git-status
   digest and bounded re-prompt loop are not grok-specific; they are the
   generic defence against *any* vendor that narrates success without writing.
   Gemini needs it for a structurally identical reason (§1.6). Parameterize the
   `--prompt-file`-appending line through `adapter_implement_argv`.

### Where the cross-vendor invariant gains room

Today the invariant `auditor vendor ≠ worker vendor` has a documented **hole**:
"If Codex implemented, do **not** use `codex-auditor`. Use architect review or a
non-OpenAI auditor and say so explicitly" (`SKILL.md`, `VERIFIED-repo`) — i.e.
the cross-vendor implementer race has no cross-vendor auditor, so racing Grok +
Codex costs you the audit lane. Four vendors closes that:

| Worker | Auditor (1st choice) | Auditor (2nd) | Notes |
|---|---|---|---|
| grok | codex (Sol, high) | gemini (pro, plan mode) | today's default pair, unchanged |
| codex | **gemini** | claude | **new** — fixes the documented hole |
| gemini | codex | grok | |
| claude | codex | gemini | |
| grok + codex raced | **gemini audits both** | | one auditor, two diffs, one vendor family neither worker used |

Config shape: replace scalar `[audit] vendor` with an ordered preference list
that the router filters the worker vendor out of, so the substitution is
deterministic and reportable rather than an architect judgement call each time.

```toml
[audit]
vendors = ["codex", "gemini", "claude"]   # ordered; worker vendor auto-filtered
model_codex  = "gpt-5.6-sol"
model_gemini = "gemini-3-pro-preview"
```

Second gain: **dual audit with a tiebreak**. Two vendor-distinct auditors can now
run in parallel audit worktrees on the same cold diff; on disagreement, escalate
to `foreman-advisor` (Fable) rather than defaulting to the strictest verdict.

---

## 1. Gemini CLI headless surface

Installed here: `@google/gemini-cli` **0.52.0** (`gemini --version` →
`0.52.0`, `VERIFIED-live`).

### 1.1 Non-interactive invocation

- Headless is triggered by `-p`/`--prompt`, **or** by running in a non-TTY
  environment (`VERIFIED-docs`, `docs/cli/headless.md`: "Headless mode is
  triggered when the CLI is run in a non-TTY environment or when providing a
  query with the `-p` (or `--prompt`) flag").
- A bare positional `query` "Runs in interactive mode by default; use `-p/--prompt`
  for non-interactive" (`VERIFIED-live`, `--help`) — docs add "unless the input or
  output is piped or redirected" (`VERIFIED-docs`, `automation.md`).
- **There is no `--prompt-file`.** `VERIFIED-live` — the full option list
  (§8.1) has no file-based prompt input. The only file-ish path is stdin
  (`-p` is "Appended to input on stdin (if any)", `VERIFIED-live`).
- **Consequence for Foreman:** `lane-run.sh` redirects CMD's stdin from
  `/dev/null` unconditionally, and `foreman-launch` nulls it too
  (`VERIFIED-repo`, `worker-cmd.sh` header: "THE PROMPT MUST NEVER ARRIVE ON
  STDIN"). So the Gemini adapter must pass the spec as an **argv value**:
  `gemini -p "$(cat "$PROMPT_FILE")" ...` — the same shape codex uses today, not
  the grok `--prompt-file` shape (`INFERRED` from the two verified facts).

### 1.2 Output formats and structured output

`-o, --output-format text|json|stream-json` (`VERIFIED-live`, default `text`).

- `json`: "a single JSON object containing the response and usage statistics"
  with schema `response` (string), `stats` (object), `error` (object, optional)
  (`VERIFIED-docs`, `headless.md`).
- `stream-json`: NDJSON events `init | message | tool_use | tool_result | error |
  result` (`VERIFIED-docs`, `headless.md`). This is the lane-transcript-grade
  stream, and it is the only place a `tool_use`/`tool_result` pair proves a
  write was attempted **and** executed.
- **There is no `--output-schema` / `--json-schema` equivalent.** `VERIFIED-live`
  — absent from the full option list. codex has `--output-schema FILE` and grok
  has `--json-schema SCHEMA` (both `VERIFIED-live`); Gemini has neither. A
  Gemini auditor lane therefore cannot be *schema-forced*, only
  *schema-prompted*, and the adapter must validate the parsed object against
  `adapters/verdict.schema.json` itself and treat a non-conforming reply as
  `STATUS: fail`, not as a verdict.

### 1.3 Exit codes — documented set is incomplete and partly wrong

Documented (`VERIFIED-docs`, `headless.md`): `0` success, `1` general error or
API failure, `42` input error (invalid prompt or arguments), `53` turn limit
exceeded.

Observed (`VERIFIED-live`, this host):

| Command | rc | Where the message went |
|---|---|---|
| `gemini --list-sessions` (unauthed) | **41** | stderr, plain text |
| `gemini -p "say OK"` (unauthed) | **41** | stderr, plain text |
| `gemini -p "say OK" -o json` (unauthed) | **41** | stderr, as a JSON object |
| `gemini -l` / `--list-extensions` (unauthed) | **41** | stderr |
| `echo X \| gemini -p "..."` (unauthed) | **41** | stderr |
| `gemini -p "x" --approval-mode bogus` | **1** | stderr, yargs usage block |
| `gemini mcp list` (unauthed) | **0** | stderr: "No MCP servers configured." |

Two findings the adapter must encode:

1. **`41` = "no auth method configured" and is undocumented.** It is not in the
   published exit-code list. Treat `41` as `STATUS: unavailable — not
   authenticated` (a Setup-stage finding), never as a model failure.
2. **Argument-validation errors return `1`, not the documented `42`.** So
   "nonzero rc" alone cannot distinguish *bad invocation* from *model/API
   failure*. The adapter must inspect the message, and should prefer
   `-o json` so the failure arrives as `{"error":{"type","message","code"}}`.

### 1.4 The `--output-format json` stderr trap

`VERIFIED-live`. With `-o json`, on failure **stdout is empty and the JSON
object is written to stderr**:

```
$ gemini -p "say OK" --output-format json   # stdout empty, rc=41; stderr:
{
  "session_id": "473f0428-49f7-45b0-a7ee-d68829cc8bf6",
  "error": {
    "type": "Error",
    "message": "Please set an Auth method in your /root/.gemini/settings.json or specify one of the following environment variables before running: GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_GENAI_USE_GCA",
    "code": 41
  }
}
```

The naive automation recipe Google itself publishes —
`gemini --output-format json "..." | jq -r '.response'` (`VERIFIED-docs`,
`automation.md`) — therefore yields an empty string and a **zero exit from
`jq`** when the run failed. `adapter_result_*` for gemini must capture stdout
and stderr to separate files and parse whichever contains JSON, and must never
rely on the pipeline's exit status. (Note `lane-run.sh` joins stderr into the
transcript via `2>&1` by design (`VERIFIED-repo`) — that is fine for the
transcript but means the round's *machine-readable* capture needs its own
un-merged stderr file.)

### 1.5 Approval modes, sandbox, and the policy engine

`--approval-mode default | auto_edit | yolo | plan` (`VERIFIED-live`; the exact
choice list was confirmed by feeding an invalid value). `-y/--yolo` still exists
but is "**Deprecated.** Use `--approval-mode=yolo`" (`VERIFIED-docs`,
`cli-reference.md`).

Sandboxing (`VERIFIED-docs`, `cli/sandbox.md`) is a **boolean plus a backend
choice**, not a permission ladder:

- `-s`/`--sandbox`, or `GEMINI_SANDBOX=true|docker|podman|sandbox-exec|runsc|lxc`,
  or `{"tools":{"sandbox":true}}` in settings — precedence in that order.
- macOS Seatbelt profiles via `SEATBELT_PROFILE`
  (`permissive-open` default … `strict-proxied`).
- Container backend defaults to `ghcr.io/google/gemini-cli:latest` and mounts
  cwd **at the same absolute path** inside the container.
- `tools.sandboxAllowedPaths` (extra paths) and `tools.sandboxNetworkAccess`
  (default `false`) in settings.

**This is the sharpest structural difference from codex.** codex has
`--sandbox read-only|workspace-write|danger-full-access` — a per-invocation,
one-flag ladder (`VERIFIED-live`). Gemini has no per-invocation read-only
sandbox flag; its read-only guarantee comes from the **policy engine / plan
mode**, and its filesystem confinement comes from an optional OS/container
sandbox that must be separately available. An audit lane that needs "cannot
write" gets it from `--approval-mode plan`, not from `-s`.

Policy engine (`VERIFIED-docs`, `reference/policy-engine.md`): TOML rules in
`~/.gemini/policies/*.toml` with `toolName`, `commandPrefix`, `argsPattern`,
`interactive` (bool — can scope a rule to headless only), `decision`
(`allow|deny|ask_user`), `priority` 0–999, and tiers Default(1) < Extension(2) <
Workspace(3, **currently non-functional**, issue #18186) < User(4) < Admin(5).
`--policy` / `--admin-policy` load extra policy files per invocation
(`VERIFIED-live`). `--allowed-tools` is deprecated in favour of the policy
engine (`VERIFIED-live`, marked DEPRECATED in `--help`).

Two policy facts that matter more than any flag:

- **`ask_user` in non-interactive mode is treated as `deny`** (`VERIFIED-docs`,
  `policy-engine.md`). See §1.6.
- Plan mode's read-only state is enforced by a **built-in Tier-1 policy**, with
  `write_file` and `replace` "only allowed for `.md`" files (`VERIFIED-docs`,
  `cli/plan-mode.md`). Good enough for an auditor — and conveniently lets a
  Gemini auditor write its own `FOREMAN_REPORT.md` in its audit worktree — but
  it is **not** a total write ban, so Foreman's existing post-audit
  `git status --porcelain` assertion (`VERIFIED-repo`, `lanes.md`) stays
  mandatory for gemini auditors.

Note a naming footgun: the CLI flag values are snake_case (`auto_edit`) while
policy TOML `modes` are camelCase (`autoEdit`) (`VERIFIED-live` + `VERIFIED-docs`).

### 1.6 File-write reliability and "wrote nothing" — the same class of bug as grok

Foreman already carries a hard-won finding: grok's `--permission-mode acceptEdits`
"is silently ignored by the CLI; without `--allow "Write" --allow "Edit"` every
write is prompt-cancelled while the model narrates success" (`VERIFIED-repo`,
`lanes.md`).

Gemini has a **structurally identical failure mode from a different cause**: in
the default approval mode, a write tool resolves to `ask_user`; in headless there
is nobody to ask; and `ask_user` in non-interactive mode "is treated as `deny`"
(`VERIFIED-docs`). The model sees a denied tool call, may narrate around it, and
the round ends with zero file changes and, plausibly, `rc=0`.

**Mandatory for any gemini implement lane** (`INFERRED`, but directly from two
verified facts):

- `--approval-mode auto_edit` — auto-approves edit tools while shell stays
  gated. This is the exact analogue of grok's `--allow Write --allow Edit`, and
  is the right default; `yolo` also auto-approves shell and should be reserved
  for containerized hard mode.
- `--skip-trust` — see §1.7.
- A git-status digest check after the round (`vendor-multiround.sh`), because
  the vendor's own narration is not evidence. Same rule Foreman already applies
  to grok.

Also relevant: with `model.maxSessionTurns` set, "**Non-interactive mode:** The
CLI exits with an error" when the limit is reached (`VERIFIED-docs`,
`session-management.md`) — that is the documented exit `53`.

### 1.7 Folder trust — a lane-killing default, with contradictory docs

`security.folderTrust.enabled` is documented **both ways**:

- `docs/cli/settings.md` settings table: default **`true`** (`VERIFIED-docs`).
- `docs/cli/trusted-folders.md`: "The Trusted Folders feature is **disabled by
  default**" (`VERIFIED-docs`).

When enabled, an unseen folder raises a trust dialog and, if declined, the CLI
"will operate in a restricted 'safe mode'"; the answer is cached in
`~/.gemini/trustedFolders.json` (`VERIFIED-docs`). Every Foreman lane runs in a
**freshly created worktree** — a folder Gemini has never seen — and a per-lane
`GEMINI_CLI_HOME` means an empty `trustedFolders.json` every time.

Adapter rule: **always pass `--skip-trust`** ("Trust the current workspace for
this session", `VERIFIED-live`) on both implement and audit lanes. It is
session-scoped, so it does not mutate host trust state. Related env vars exist
for enterprise control: `GEMINI_CLI_TRUST_WORKSPACE`,
`GEMINI_CLI_TRUSTED_FOLDERS_PATH` (`VERIFIED-docs`).

### 1.8 Sessions, resume, checkpointing, worktrees

- `-r, --resume latest|<index>|<uuid>`, `--session-id <uuid>` (start a new
  session with a chosen UUID), `--session-file <json>`, `--list-sessions`,
  `--delete-session <index>` (`VERIFIED-live`).
- Sessions are stored at `~/.gemini/tmp/<project_hash>/chats/` where
  `project_hash` derives from the **project root directory**, and are
  project-scoped (`VERIFIED-docs`, `session-management.md`). Distinct worktrees
  therefore get distinct hashes — the same path-keyed isolation property grok's
  session records have (`VERIFIED-repo`, T5b results).
- Default retention 30 days / `general.sessionRetention` (`VERIFIED-docs`).
- Checkpointing writes a **shadow git repo** at `~/.gemini/history/<project_hash>`
  plus JSON at `~/.gemini/tmp/<project_hash>/checkpoints`; **disabled by
  default** (`VERIFIED-docs`, `cli/checkpointing.md`). My live probe created
  `~/.gemini/history/<name>/.project_root` and `~/.gemini/tmp/<name>/.project_root`
  even unauthenticated (`VERIFIED-live`) — so the directories are laid down
  eagerly regardless. Foreman should leave checkpointing off: `lane-run.sh` owns
  checkpointing already, and a second shadow repo is redundant state.
- `-w, --worktree [NAME]` creates a git worktree under `.gemini/worktrees/`, and
  needs `experimental.worktrees: true` (`VERIFIED-docs`, `cli/git-worktrees.md`).
  **Do not use it.** Foreman owns worktree lifecycle through `wt-new.sh` /
  `wt-merge.sh` / `wt-cleanup.sh`; Gemini's own worktrees are never cleaned up
  automatically by design ("Gemini … **does not automatically delete** your
  worktree or branch") and would collide with `merge-gate.sh`'s freshness model.

### 1.9 Config locations, env vars, and per-lane isolation — the key enabler

`GEMINI_CLI_HOME` "Specifies the root directory for Gemini CLI's user-level
configuration and storage. … The CLI will create a `.gemini` folder inside this
directory. … Useful for shared compute environments or keeping CLI state
isolated." (`VERIFIED-docs`, `reference/configuration.md`).

**`VERIFIED-live` — I confirmed this redirects everything**, which is what makes
gemini viable as a Foreman lane vendor at all:

```
$ T=$(mktemp -d /tmp/gemhome.XXXX)
$ GEMINI_CLI_HOME="$T" gemini --list-sessions ; echo rc=$?
Please set an Auth method in your /tmp/gemhome.WFEA/.gemini/settings.json or specify one of the following environment variables before running: GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_GENAI_USE_GCA
rc=41
$ find "$T"
/tmp/gemhome.WFEA
/tmp/gemhome.WFEA/.gemini
/tmp/gemhome.WFEA/.gemini/projects.json
/tmp/gemhome.WFEA/.gemini/history
/tmp/gemhome.WFEA/.gemini/history/charl/.project_root
/tmp/gemhome.WFEA/.gemini/tmp
/tmp/gemhome.WFEA/.gemini/tmp/charl/.project_root
```

Both the settings path in the error message **and** the created state tree
moved. This is a true peer of `GROK_HOME` / `CODEX_HOME`, and unlike
`CLAUDE_CONFIG_DIR` (which Foreman's T5b research rules insufficient because it
"does not cover top-level session state", `VERIFIED-repo`) it relocates the
root that `.gemini` is created *inside*, so there is no residual `~/.gemini` for
a lane to race on.

Config surface under the root (`VERIFIED-docs` unless noted):
`settings.json` (user), `policies/*.toml`, `trustedFolders.json`, `GEMINI.md`
(context), `.env`, `bin/`, `hooks/`, `plans/`, `system.md`, `tmp/`, plus
project-level `.gemini/` in the repo. Live host also has `config/config.json`,
`config/mcp_config.json`, `projects.json` (`VERIFIED-live`).

Env vars discovered across the docs (`VERIFIED-docs`): `GEMINI_API_KEY`,
`GOOGLE_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`,
`GOOGLE_CLOUD_LOCATION`, `GOOGLE_GENAI_API_VERSION`, `GOOGLE_GEMINI_BASE_URL`,
`GOOGLE_VERTEX_BASE_URL`, `GEMINI_CLI_HOME`, `GEMINI_CLI_SURFACE`,
`GEMINI_CLI_SYSTEM_SETTINGS_PATH`, `GEMINI_CLI_SYSTEM_DEFAULTS_PATH`,
`GEMINI_CLI_TRUSTED_FOLDERS_PATH`, `GEMINI_CLI_TRUST_WORKSPACE`,
`GEMINI_CLI_IDE_PID`, `GEMINI_MODEL`, `GEMINI_SANDBOX`, `GEMINI_SANDBOX_IMAGE`,
`GEMINI_SYSTEM_MD`, `GEMINI_WRITE_SYSTEM_MD`, `GEMINI_PLANS_DIR`,
`GEMINI_TELEMETRY_*`.

### 1.10 Auth modes and this host's state

Auth methods (`VERIFIED-docs`, `get-started/authentication.mdx`):

1. **Sign in with Google** (OAuth, browser required, creds cached locally) —
   recommended for interactive; Workspace/Code-Assist-licence accounts also need
   `GOOGLE_CLOUD_PROJECT`.
2. **Gemini API key** — `GEMINI_API_KEY` from AI Studio.
3. **Vertex AI** — ADC via `gcloud`, service-account JSON, or a Cloud API key;
   needs `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION`.

The docs' own auth-selection table lists, for the **Headless mode** row:
"Use Gemini API Key or Vertex AI" (`VERIFIED-docs`) — i.e. Google explicitly does
not recommend OAuth for headless. That aligns with Foreman's needs (§7.2).

**There is no `gemini login` subcommand** (`VERIFIED-live` — the subcommand list
is `mcp | extensions | skills | hooks | gemma | [query]`, and a
case-insensitive grep for "login" over `--help` returns 0 hits). Setup-stage
instruction for a NOT-READY gemini is therefore either
`export GEMINI_API_KEY=…` or "run `gemini` once interactively and choose Sign in
with Google" — **not** a login command Foreman can name in a one-liner the way
it names `grok login --device-code` / `codex login`.

**Live auth state on this host, unchanged by this lane** (`VERIFIED-live`):

| Vendor | State | Probe used |
|---|---|---|
| gemini | **NOT authenticated** — no `~/.gemini/settings.json`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`/`GOOGLE_GENAI_USE_VERTEXAI`/`GOOGLE_CLOUD_PROJECT` all unset | `gemini --list-sessions` → rc 41 |
| codex | authenticated — "Logged in using ChatGPT" | `codex login status` → rc 0 |
| grok | authenticated — "You are logged in with grok.com. Default model: grok-4.5" | `grok models` → rc 0 |

**Recommended `vendor_authed gemini` for `env/tool-check.sh`** (`INFERRED` for
the authed branch, `VERIFIED-live` for the unauthed branch): run
`gemini --list-sessions` under `timeout`, treat rc `41` (or the "set an Auth
method" substring) as not-authenticated, rc `0` as authenticated. It makes **no
model call**, so it is free and safe — strictly better than grok's `grok models`,
which does hit the network. Do **not** use `gemini mcp list` as the probe: it
returns rc 0 while unauthenticated (`VERIFIED-live`).

### 1.11 Models

`-m/--model`, default alias `auto` (`VERIFIED-live` + `VERIFIED-docs`).

| Alias | Resolves to |
|---|---|
| `auto` (default) | `gemini-2.5-pro` **or** `gemini-3-pro-preview` if preview features are enabled |
| `pro` | same pair |
| `flash` | `gemini-2.5-flash` |
| `flash-lite` | `gemini-2.5-flash-lite` |

Gemini 3 family: `gemini-3-pro-preview`, `gemini-3-flash-preview`; and
`gemini-3.1-pro-preview` is "rolling out" and directly launchable with
`-m gemini-3.1-pro-preview` (`VERIFIED-docs`, `get-started/gemini-3.md`). For
Code Assist Standard/Enterprise, Gemini 3 needs an admin release-channel change
plus per-user "Preview Features = true".

Two routing hazards (`VERIFIED-docs`, `gemini-3.md` + `model.md`):

- **Auto routing silently downgrades.** "For simple prompts, it will
  automatically use Gemini 2.5 Flash." A lane left on `auto` can therefore be
  served by Flash without saying so in any machine-readable field. **Pin `-m`
  explicitly in every Foreman lane.**
- **`--model` does not override sub-agent models** — "even when using the
  `/model` flag you may see other models used in your model usage reports". So
  a pinned auditor model is not a guarantee about the whole run.

### 1.12 MCP, skills, hooks, extensions, ACP

- MCP: `gemini mcp add|remove|list|enable|disable`, stdio and `--transport http`,
  `--env`, `--scope user`, `--include-tools`; per-invocation
  `--allowed-mcp-server-names` (`VERIFIED-live` + `VERIFIED-docs`).
- **Agent Skills**: `gemini skills list|install|link|enable|disable|uninstall`,
  installable "from a git repository URL or a local path" (`VERIFIED-live`).
  Notable for Foreman: the Foreman skill itself is installable into Gemini CLI,
  which is a different integration axis than a lane adapter (out of R3 scope,
  worth a separate lane).
- **Hooks**: `gemini hooks migrate` — "Migrate hooks from Claude Code to Gemini
  CLI" (`VERIFIED-live`).
- Extensions: `gemini extensions …`, `-e/--extensions`, `-l/--list-extensions`.
- ACP mode: `--acp` (`--experimental-acp` deprecated) (`VERIFIED-live`).
- `gemini gemma` — local Gemma model routing (`VERIFIED-live`); analogous to
  codex `--oss`/`--local-provider`.

### 1.13 Concurrency behaviour

**No published concurrency cap or documented multi-instance guidance exists** —
I found none in any fetched doc (`VERIFIED-docs`, negative result). What can be
said:

- Session/checkpoint state is keyed by **project hash** (`VERIFIED-docs`), so
  lanes in distinct worktrees do not share those files. Same property that made
  grok green at N=3.
- `settings.json`, `trustedFolders.json`, `policies/`, and cached OAuth
  credentials all live at the **user root** and are shared by every instance
  under one `GEMINI_CLI_HOME` — structurally the same shape as the
  `.claude.json` corruption class Foreman already rules `REQUIRES-SEPARATE-HOME`
  (`VERIFIED-repo`). `GEMINI_CLI_HOME` per lane removes the sharing
  (`VERIFIED-live` that it redirects), but then each lane's home has **no
  credentials** unless auth is env-var-based.
- Therefore: **`GEMINI_API_KEY` (or Vertex ADC) is the concurrency-clean auth
  mode for Foreman lanes**, because the credential travels in the environment
  and is naturally per-process, while `GEMINI_CLI_HOME` isolates all the mutable
  state (`INFERRED`).
- Quota is **requests per user per day** (§7.1), shared across concurrent lanes
  regardless of isolation.

**Verdict: cap gemini at 1 until a T5b-style destructive run is recorded.** The
existing protocol in `docs/research/vendor-concurrency-results.md` transfers
verbatim; `vendor-concurrency-test.sh` needs one new case mapping
`gemini -> GEMINI_CLI_HOME` and an auth re-probe of
`gemini --list-sessions`. Foreman's own doctrine is explicit that caps rise only
on a recorded green row (`VERIFIED-repo`), and there is no gemini row.

---

## 2. GPT / Codex current surface

Installed: `codex-cli` **0.145.0** (`VERIFIED-live`; Foreman's prior research
was written against 0.144.x, `VERIFIED-repo`).

### 2.1 `codex exec` — implement and audit

Full option list verbatim in §8.2. What matters:

| Capability | Flag | Note |
|---|---|---|
| Prompt | positional `[PROMPT]`, or stdin / `-` | Foreman passes a positional to keep stdin out of play (`VERIFIED-repo`) |
| Model | `-m/--model` | `gpt-5.6-sol` pinned today |
| Reasoning effort | `-c model_reasoning_effort=low\|medium\|high` | config override, not a first-class flag (`VERIFIED-live`: no `--reasoning-effort` in `codex exec --help`) |
| Sandbox | `-s/--sandbox read-only\|workspace-write\|danger-full-access` | three-rung ladder, per invocation |
| Escape hatch | `--dangerously-bypass-approvals-and-sandbox` | for externally-sandboxed envs only |
| Structured output | `--output-schema FILE` | JSON Schema for the **final response shape** — this is what makes the verdict schema-*forced* rather than schema-*prompted* |
| Event stream | `--json` | JSONL events to stdout |
| Final message | `-o/--output-last-message FILE` | |
| Working root | `-C/--cd DIR`, `--add-dir DIR` | `--add-dir` = extra writable dirs |
| Repo guard | `--skip-git-repo-check` | |
| **Statelessness** | `--ephemeral` | "Run without persisting session files to disk" |
| Config hygiene | `--ignore-user-config`, `--ignore-rules`, `--strict-config` | |
| Profiles | `-p/--profile NAME` | layers `$CODEX_HOME/<name>.config.toml` over the base config |
| Features | `--enable/--disable FEATURE` | sugar for `-c features.<name>=…` |

New/underused since Foreman's last pass (`VERIFIED-live`):

- **`--ephemeral`** is a direct concurrency lever: no session files on disk means
  no SQLite/session contention between lanes at all. Recommended default for
  **audit** lanes (which never need resume) and a candidate for implement lanes
  that Foreman already checkpoints itself.
- **`-p/--profile`** gives a clean way to express "the GPT lane, but a different
  model/effort/sandbox preset" without new adapter code — see §2.4.

### 2.2 Headless resume / threads

`codex exec resume [SESSION_ID|--last] [PROMPT] [--all]` (`VERIFIED-live`) —
session id is "Conversation/session id (UUID) or thread name", `--last` picks
the newest, `--all` disables cwd filtering. So codex **does** support headless
multi-turn continuation, at parity with `grok -r` and `gemini -r`. Foreman's
`resume.sh` currently recovers a DEAD lane by re-running from a checkpoint
(`VERIFIED-repo`); wiring `codex exec resume --last` into the codex adapter
would let a resumed round keep its reasoning context instead of restarting cold
(`INFERRED` — worth a v-next task, not a claim that it works today).

### 2.3 Native audit subcommand

`codex exec review [PROMPT] [--uncommitted | --base BRANCH | --commit SHA]
[--title TITLE] [-m MODEL]` (`VERIFIED-live`). Combined with `--output-schema`
and `--sandbox read-only`, this is a first-class cold-diff auditor that needs no
prompt engineering to select the diff — `--base` in particular matches Foreman's
worktree-branch-vs-base model exactly. `agents/codex-auditor.md` already
documents it as the "Alternate (native review subcommand)" path (`VERIFIED-repo`);
the adapter should expose it as `adapter_audit_argv codex … --base "$BASE"` and
make it the default for hard-mode cold-diff audit.

### 2.4 Auth modes, and: is a non-Codex plain-GPT path worth having?

`codex login` subcommands (`VERIFIED-live`):

- `codex login` — interactive; Foreman's research records it falling back to a
  **localhost:1455** browser callback whose local server dies when the launching
  shell detaches, so it must be operator-run in a persistent foreground shell
  (`VERIFIED-repo`).
- `codex login --with-api-key` — "Read the API key from stdin
  (e.g. `printenv OPENAI_API_KEY | codex login --with-api-key`)".
- `codex login --with-access-token` — same, for `CODEX_ACCESS_TOKEN`. **Not in
  Foreman's existing notes** — a second headless auth path worth recording.
- `codex login status` — the non-billing auth probe.

**Recommendation: do not add a separate plain-GPT lane.** There is no
first-party non-Codex GPT CLI; a plain-GPT path means Foreman writes and
maintains its own Responses-API client, its own tool loop, and its own file-write
layer — re-implementing the thing the adapter contract exists to avoid, and
losing the sandbox for free. "Broaden GPT" is better served by making the codex
adapter **model- and profile-parameterized**:

- `WC_CODEX_MODEL` already exists (`VERIFIED-repo`); promote it to
  `[worker] model` / `[audit] model_codex` config so any GPT model the CLI
  exposes is reachable without new code.
- Add `-p/--profile` passthrough so a repo can pin
  `$CODEX_HOME/audit.config.toml` with model + effort + sandbox in one place.
- Keep `--oss`/`--local-provider` (lmstudio/ollama) as an explicitly
  unsupported-for-now branch — it changes the trust and cost model entirely.

(`INFERRED` — this is a recommendation, not an observation.)

---

## 3. Grok — parity check on today's constraints

Installed: `grok` **0.2.112 (9bbd559437) [stable]** (`VERIFIED-live`).
`grok models` → "You are logged in with grok.com. Default model: grok-4.5.
Available models: * grok-4.5 (default)" (`VERIFIED-live`) — the account exposes
exactly one model, so `-m` is currently a no-op in practice.

Confirmed still present in 0.2.112 (`VERIFIED-live`, from `grok --help`):
`-p/--single`, `--prompt-file`, `--prompt-json`, `--output-format
plain|json|streaming-json`, `--json-schema SCHEMA` (implies `--output-format
json`), `--allow`/`--deny` rules, `--permission-mode
default|acceptEdits|auto|dontAsk|bypassPermissions|plan`, `--always-approve`,
`--sandbox PROFILE` (env `GROK_SANDBOX`), `-r/--resume`, `-c/--continue`,
`--fork-session`, `-s/--session-id`, `--max-turns N`, `--reasoning-effort`,
`--cwd`, `-w/--worktree`, `--agent`/`--agents`, `--tools`/`--disallowed-tools`,
`--rules`, `--system-prompt-override`, `--disable-web-search`.

**Single-burst / empty-burst constraint: unchanged and still real.**
`grok --prompt-file` is one agentic burst; a spec that must read before writing
can spend the burst on orientation and write nothing (`VERIFIED-repo`,
`worker-cmd.sh` + `agents/grok-implementer.md`). Mitigation remains
`grok-multiround.sh`: bounded re-prompt loop, round-1 spec verbatim, rounds 2+
prefixed with "PRIOR ROUND PRODUCED no file changes … do NOT read first — Write
the deliverable now", success detected by a **sha256 of `git status --porcelain`**
in the target worktree, never by parsing grok's narration; exit 1 =
`EMPTY-BURST FAILED` (`VERIFIED-repo`, read in full). It hard-fails up front if
`--cwd` is not a git work tree, because the digest would otherwise be silently
empty every round.

`--permission-mode acceptEdits` silently ignored → always use
`--allow "Write" --allow "Edit"` (`VERIFIED-repo`, `lanes.md`). Shell tool stays
prompt-cancelled headless, so grok cannot delete/rename/chmod or run commands —
verification is the wrapper's job and deletions go to `ARCHITECT_ACTIONS`
(`VERIFIED-repo`).

Two small corrections/additions for the vNext docs:

- **`--no-auto-update` is a valid but hidden flag.** It appears in
  `references/lanes.md`'s headless recipe but **not** in `grok --help` for
  0.2.112. I checked this rather than assuming: `grok --definitely-not-a-flag
  --version` errors with `error: unexpected argument … found`, while
  `grok --no-auto-update doctor` runs normally (`VERIFIED-live`). So the flag is
  accepted, merely undocumented — the recipe is fine, but the doc should say
  "hidden flag" so a future reader does not delete it as dead.
- **`grok agent` has a leader mode with a shared socket.**
  `grok agent stdio|headless|serve|leader`, plus `--leader`/`--no-leader` and
  `--leader-socket PATH` defaulting to **`~/.grok/leader.sock`**
  (`VERIFIED-live`). A shared leader process is a cross-lane coupling point: N
  lanes defaulting to `[cli] use_leader` would share one backend. Per-lane
  `GROK_HOME` moves the default socket path with it (`INFERRED`), and Foreman's
  lanes use the top-level `grok` invocation rather than `grok agent`, so this is
  latent rather than active — but the adapter should pass `--no-leader`
  defensively.

Recorded caps (`VERIFIED-repo`, `vendor-concurrency-results.md` + `lane-queue.sh`):
grok **3** (live authenticated GREEN at N=2 and N=3), codex **2** (GREEN at N=2;
N=3 not run), claude 3 in pueue but `REQUIRES-SEPARATE-HOME` by ruling.

---

## 4. Cross-vendor comparison

| | **grok** 0.2.112 | **codex** 0.145.0 | **gemini** 0.52.0 | **claude** |
|---|---|---|---|---|
| **Headless flag** | `-p/--single`, `--prompt-file`, `--prompt-json` | `codex exec [PROMPT]` (positional or stdin) | `-p/--prompt` (or any non-TTY) — **no prompt-file** | `-p` |
| **Prompt from file** | native `--prompt-file` | `"$(cat f)"` | `"$(cat f)"` | `"$(cat f)"` |
| **Structured output** | `--output-format json\|streaming-json`; **`--json-schema` (forced)** | `--json` JSONL; **`--output-schema FILE` (forced)** | `-o json\|stream-json`; **no schema flag — prompt-forced only** | `--output-format stream-json`, `--json-schema` |
| **Where results land** | stdout (single object) | `--output-last-message FILE` | stdout `.response`; **errors to stderr** | stdout |
| **File-write reliability** | writes silently cancelled unless `--allow Write --allow Edit`; single-burst empty-burst risk | reliable under `--sandbox workspace-write` | writes silently **denied** in headless unless `--approval-mode auto_edit\|yolo` (`ask_user`→`deny`) | reliable in container |
| **Headless resume** | `-r/--resume`, `-c/--continue`, `--fork-session`, `-s/--session-id` | `codex exec resume [ID\|--last] [--all]` | `-r/--resume latest\|idx\|uuid`, `--session-id`, `--session-file` | `--resume` |
| **Sandbox** | `--sandbox PROFILE` / `GROK_SANDBOX` | **3-rung ladder** `read-only\|workspace-write\|danger-full-access` | boolean `-s` + backend (`docker\|podman\|sandbox-exec\|runsc\|lxc`); read-only comes from **plan mode**, not the sandbox | container (hard mode) |
| **Read-only audit mode** | `--permission-mode plan` | `--sandbox read-only` | `--approval-mode plan` (Tier-1 policy; **`.md` writes still allowed**) | disallowed write tools |
| **Native review subcommand** | no | **`codex exec review --uncommitted\|--base\|--commit`** | no | no |
| **Config-home isolation var** | `GROK_HOME` | `CODEX_HOME` | **`GEMINI_CLI_HOME`** (`VERIFIED-live`) | `CLAUDE_CONFIG_DIR` (insufficient) |
| **Concurrency evidence** | **GREEN N=2, N=3** live authed (2026-07-18) → cap 3 | **GREEN N=2** live authed → cap 2 (N=3 not run) | **none** — no run, no published guidance → **cap 1** | `REQUIRES-SEPARATE-HOME` (public issue record) |
| **Auth mode** | OAuth via `grok login --device-code`, or `XAI_API_KEY` | ChatGPT OAuth (`codex login`), or `--with-api-key` / `--with-access-token` on stdin | **no `login` subcommand**: interactive Google OAuth, or `GEMINI_API_KEY`, or Vertex ADC/SA/API-key | `claude auth login` |
| **Non-billing auth probe** | `grok models` (network) | `codex login status` | `gemini --list-sessions` → rc **41** if unauthed (no model call) | `claude auth status` |
| **Cost model** | grok.com subscription / xAI API key | ChatGPT subscription / OpenAI API key | Google account subscription (**requests/day**), Gemini API key (250/day free, Flash-only), or Vertex PAYG | Anthropic subscription / API key |
| **Model pinning hazard** | only `grok-4.5` exposed on this account | pin `-m gpt-5.6-sol` | **`auto` silently routes simple prompts to 2.5-flash** — always pin `-m`; `--model` does not bind sub-agents | — |
| **Known failure modes** | acceptEdits silently ignored; empty-burst; shell prompt-cancelled; may narrate success without writing; may attempt git commits | no writes outside workspace / no network installs under `workspace-write`; NTSTATUS exit-code masking via launcher on Windows | `ask_user`→`deny` silent zero-write; JSON error on stderr with empty stdout; exit 41 undocumented; arg errors return 1 not the documented 42; folder-trust default contradicts itself across docs; workspace-tier policies non-functional (#18186) | `.claude.json` non-atomic write races across instances |
| **Live auth state here** | authed | authed | **NOT authed** | not probed |

---

## 5. Recommended adapter interface (detail)

### 5.1 Minimal common contract

Two verbs. Everything else is a capability query.

```
implement(spec_file, worktree, vendor, model, effort) -> {rc, transcript, wrote_files:bool}
audit(prompt_file, worktree, vendor, model, base_ref) -> {rc, verdict_json, mutated_tree:bool}
```

Invariants the contract must enforce structurally, not by prompt:

1. **stdin is never the prompt channel.** Already a hard rule
   (`VERIFIED-repo`); it now also rules out the `cat file | gemini` idiom the
   Gemini docs push, so the adapter is the only place that knows this.
2. **`wrote_files` is a git-status digest, never vendor narration.** Generalize
   `grok-multiround.sh::snap()` into `lib/evidence.sh`. Applies to all four
   vendors; gemini needs it for the same reason grok does.
3. **`mutated_tree` is asserted after every audit** — `git status --porcelain`
   must be empty. Required even in gemini plan mode, which permits `.md` writes.
4. **A non-conforming verdict is `STATUS: fail`, not a verdict.** For codex and
   grok the schema is vendor-forced; for gemini it is prompt-forced and must be
   validated against `adapters/verdict.schema.json` by the adapter.
5. **Vendor unavailability and vendor substitution are always reported.** Never
   silently absorbed (`VERIFIED-repo`, existing doctrine) — with four vendors
   and an ordered auditor preference list, substitution becomes common, so the
   round report should carry `auditor_vendor` + `auditor_selected_because`.

### 5.2 Concrete argv per vendor

```bash
# --- implement -------------------------------------------------------------
grok   --prompt-file "$SPEC" -m "$MODEL" --allow Write --allow Edit \
       --output-format plain --no-leader --cwd "$WT"

codex  exec --sandbox workspace-write --skip-git-repo-check \
       --output-last-message "$WT/.foreman-last.txt" \
       --model "$MODEL" -c "model_reasoning_effort=$EFFORT" -C "$WT" \
       "$(cat "$SPEC")"

gemini -p "$(cat "$SPEC")" -m "$MODEL" \
       --approval-mode auto_edit --skip-trust \
       --output-format stream-json          # tee stdout AND stderr separately

# --- audit -----------------------------------------------------------------
codex  exec --model "$MODEL" -c model_reasoning_effort=high \
       --sandbox read-only --skip-git-repo-check --ephemeral -C "$WT" \
       --output-schema "$SCHEMA" --output-last-message "$OUT" - < "$PROMPT"
#   or: codex exec review --base "$BASE" --sandbox read-only \
#       --output-schema "$SCHEMA" --output-last-message "$OUT"

gemini -p "$(cat "$PROMPT")" -m "$MODEL" \
       --approval-mode plan --skip-trust --output-format json \
       > "$OUT.stdout" 2> "$OUT.stderr"      # then: jq -r .response, validate

grok   --prompt-file "$PROMPT" -m "$MODEL" --permission-mode plan --no-leader \
       --json-schema "$(cat "$SCHEMA")" --cwd "$WT"
```

Every invocation runs under `timeout`/`gtimeout` ~600s and under
`lane-run.sh --round`, unchanged (`VERIFIED-repo`).

### 5.3 Config additions

```toml
[worker]
vendors = ["grok", "codex", "gemini"]    # eligible implementers, ordered
[audit]
vendors = ["codex", "gemini", "claude"]  # ordered; worker vendor auto-filtered
[vendor.gemini]
model    = "gemini-3-pro-preview"        # never leave this on "auto"
cap      = 1                             # until a T5b green row exists
auth     = "api_key"                     # api_key | oauth | vertex
```

`lane-queue.sh` gains a `gemini:1` group alongside `grok:3 codex:2 claude:3
misc:2 gate:1` (`VERIFIED-repo` for the current topology).

---

## 6. Risks

### 6.1 Rate limits and quota shape
Gemini's limit is **requests per user per day**, not tokens: Code Assist
individual 1,000/day; AI Pro 1,500; AI Ultra 2,000; Gemini API key free tier
**250/day and Flash-only**; Vertex Express varies; "Requests are limited per user
per minute" additionally (`VERIFIED-docs`, `quota-and-pricing.md`). One agentic
round issues many model requests, so a fanned-out gemini lane set can exhaust a
day's budget in a way token-priced vendors do not. **The free API-key tier is
Flash-only** — a Foreman gemini lane on a free key is *not* getting Pro-class
reasoning, which quietly breaks the "auditor runs at the highest reasoning
level" doctrine (`VERIFIED-repo`). Setup must report which gemini auth tier is
active, not merely that gemini is authenticated.

Related: at the Gemini 3 Pro daily limit the CLI "will tell you … you'll be given
the option to switch to Gemini 2.5 Pro, upgrade, or stop", and on capacity errors
it "will ask you to decide" (`VERIFIED-docs`). In headless there is nobody to
answer. Whether that surfaces as a clean nonzero exit or a silent downgrade is
**untested** (`INFERRED` — this is the single most important thing to check the
first time gemini is authenticated here).

### 6.2 Auth-state collisions between concurrent lanes
- gemini: `settings.json` / `trustedFolders.json` / cached OAuth creds are all
  user-root-scoped; N lanes under one root share them. `GEMINI_CLI_HOME` fixes
  the state sharing (`VERIFIED-live`) but leaves each isolated home
  credential-less unless auth is env-var-based. **Use `GEMINI_API_KEY` (or Vertex
  ADC) for lanes**; treat OAuth-only gemini as cap-1, no-isolation.
- grok: `~/.grok/leader.sock` is a shared default path; pass `--no-leader`.
- codex: SQLite session store serializes writers natively (`VERIFIED-repo`);
  `--ephemeral` removes the question entirely for audit lanes.
- claude: unchanged `REQUIRES-SEPARATE-HOME` ruling.

### 6.3 Per-vendor sandbox differences are not interchangeable
codex gives a per-invocation `read-only` sandbox — a kernel/OS-level guarantee
selectable per run. Gemini's read-only is a **policy decision inside the agent
process**, and it still permits `.md` writes; its OS-level sandbox is a separate
opt-in that requires Docker/Podman (or macOS Seatbelt) to be present. An
orchestrator that assumes "audit lane ⇒ cannot touch the tree" will be wrong for
gemini. Hence contract point 3 in §5.1: assert the empty `git status --porcelain`
every time. Additionally, workspace-tier policies are **currently non-functional**
(`VERIFIED-docs`, issue #18186) — so a repo-local `.gemini/policies/` hardening
file silently does nothing; policy must be injected via `--policy` per
invocation or written into the lane's own `GEMINI_CLI_HOME` user tier.

### 6.4 Silent no-op rounds
Two distinct silent-zero-write mechanisms now exist (grok: prompt-cancelled
writes + single-burst; gemini: `ask_user`→`deny`), and both can end `rc=0` with
confident narration. The git-status digest is the only cross-vendor defence and
must be promoted from a grok-specific script to a contract point.

### 6.5 Non-determinism and model drift
Gemini `auto` routing can serve Flash for prompts it judges simple, and `--model`
does not bind sub-agents (`VERIFIED-docs`). Pinning `-m` is necessary but not
sufficient; the round report should record the model(s) actually reported in the
`result` event's per-model token breakdown (`VERIFIED-docs`, `headless.md`) so a
downgrade is visible after the fact.

### 6.6 Exit-code semantics are not portable
gemini `41` (undocumented, auth), `1` (arg error, contradicting the documented
`42`), `53` (turn limit); codex passes the child's code through
`foreman-launch` with NTSTATUS byte-masking on Windows (`VERIFIED-repo`);
grok/clap returns its own codes. `adapter_caps` should publish a per-vendor
`rc_unavailable` set so `lane-run.sh` can distinguish
`STATUS: unavailable` (Setup problem) from `STATUS: fail` (round problem)
without vendor-specific code at the call site.

### 6.7 Doc quality
Gemini's own docs contradict themselves on the folder-trust default and
under-document exit codes; the published `jq` automation recipe is unsafe on
failure. Treat `VERIFIED-docs` for gemini as weaker evidence than for codex, and
prefer a live probe wherever a claim gates a lane.

---

## 7. What still needs to be run before this becomes doctrine

1. **Authenticate gemini** (operator action, Setup stage — API key preferred) and
   re-run: `gemini --list-sessions` rc, one trivial `-p` smoke, and the
   `-o json` success shape (does `.response` land on stdout on success?).
2. **T5b for gemini**: `vendor-concurrency-test.sh gemini 2` then `3`, with the
   `GEMINI_CLI_HOME` mapping and the `--list-sessions` auth re-probe. Cap stays
   1 until green.
3. **Empty-burst probe for gemini**: run an exploratory spec under
   `--approval-mode default` (expect zero writes) and under `auto_edit` (expect
   writes) to confirm §1.6 empirically rather than by inference.
4. **Quota-exhaustion behaviour** in headless (§6.1) — the fallback prompt.
5. **codex `exec resume`** wired into `resume.sh` as a warm-recovery path.

---

## 8. Verbatim `--help` excerpts

### 8.1 `gemini --help` (0.52.0, `VERIFIED-live`, 2026-07-28)

```
Usage: gemini [options] [command]

Gemini CLI - Defaults to interactive mode. Use -p/--prompt for non-interactive (headless) mode.

Commands:
  gemini mcp                   Manage MCP servers
  gemini extensions <command>  Manage Gemini CLI extensions.  [aliases: extension]
  gemini skills <command>      Manage agent skills.  [aliases: skill]
  gemini hooks <command>       Manage Gemini CLI hooks.  [aliases: hook]
  gemini gemma                 Manage local Gemma model routing
  gemini [query..]             Launch Gemini CLI  [default]

Positionals:
  query  Initial prompt. Runs in interactive mode by default; use -p/--prompt for non-interactive.

Options:
  -d, --debug                     Run in debug mode (open debug console with F12)  [boolean] [default: false]
  -m, --model                     Model  [string]
  -p, --prompt                    Run in non-interactive (headless) mode with the given prompt. Appended to input on stdin (if any).  [string]
  -i, --prompt-interactive        Execute the provided prompt and continue in interactive mode  [string]
      --skip-trust                Trust the current workspace for this session.  [boolean] [default: false]
  -w, --worktree                  Start Gemini in a new git worktree. If no name is provided, one is generated automatically.  [string]
  -s, --sandbox                   Run in sandbox?  [boolean]
  -y, --yolo                      Automatically accept all actions (aka YOLO mode, ...)?  [boolean] [default: false]
      --approval-mode             Set the approval mode: default (prompt for approval), auto_edit (auto-approve edit tools), yolo (auto-approve all tools), plan (read-only mode)  [string] [choices: "default", "auto_edit", "yolo", "plan"]
      --policy                    Additional policy files or directories to load (comma-separated or multiple --policy)  [array]
      --admin-policy              Additional admin policy files or directories to load (comma-separated or multiple --admin-policy)  [array]
      --acp                       Starts the agent in ACP mode  [boolean]
      --experimental-acp          Starts the agent in ACP mode (deprecated, use --acp instead)  [boolean]
      --allowed-mcp-server-names  Allowed MCP server names  [array]
      --allowed-tools             [DEPRECATED: Use Policy Engine instead ...] Tools that are allowed to run without confirmation  [array]
  -e, --extensions                A list of extensions to use. If not provided, all extensions are used.  [array]
  -l, --list-extensions           List all available extensions and exit.  [boolean]
  -r, --resume                    Resume a previous session. Use "latest" for most recent or index number (e.g. --resume 5)  [string]
      --session-file              Load a session from a JSON file  [string]
      --session-id                Start a new session with a manually provided UUID.  [string]
      --list-sessions             List available sessions for the current project and exit.  [boolean]
      --delete-session            Delete a session by index number (use --list-sessions to see available sessions).  [string]
      --include-directories       Additional directories to include in the workspace (comma-separated or multiple --include-directories)  [array]
      --screen-reader             Enable screen reader mode for accessibility.  [boolean]
  -o, --output-format             The format of the CLI output.  [string] [choices: "text", "json", "stream-json"]
      --raw-output                Disable sanitization of model output (e.g. allow ANSI escape sequences). WARNING: This can be a security risk if the model output is untrusted.  [boolean]
      --accept-raw-output-risk    Suppress the security warning when using --raw-output.  [boolean]
  -v, --version                   Show version number  [boolean]
  -h, --help                      Show help  [boolean]
```

### 8.2 `codex exec --help` (codex-cli 0.145.0, `VERIFIED-live`, 2026-07-28)

```
Run Codex non-interactively

Usage: codex exec [OPTIONS] [PROMPT]
       codex exec [OPTIONS] <COMMAND> [ARGS]

Commands:
  resume  Resume a previous session by id or pick the most recent with --last
  review  Run a code review against the current repository
  help    Print this message or the help of the given subcommand(s)

Arguments:
  [PROMPT]
          Initial instructions for the agent. If not provided as an argument (or if `-` is used),
          instructions are read from stdin. If stdin is piped and a prompt is also provided, stdin
          is appended as a `<stdin>` block

Options:
  -c, --config <key=value>        Override a configuration value ... (dotted path, TOML-parsed)
      --enable <FEATURE>          Enable a feature (repeatable). Equivalent to `-c features.<name>=true`
      --disable <FEATURE>         Disable a feature (repeatable)
      --strict-config             Error out when config.toml contains unrecognized fields
  -i, --image <FILE>...           Optional image(s) to attach to the initial prompt
  -m, --model <MODEL>             Model the agent should use
      --oss                       Use open-source provider
      --local-provider <OSS_PROVIDER>   lmstudio or ollama
  -p, --profile <CONFIG_PROFILE_V2>     Layer $CODEX_HOME/<name>.config.toml on top of the base user config
  -s, --sandbox <SANDBOX_MODE>    Select the sandbox policy ...
                                  [possible values: read-only, workspace-write, danger-full-access]
      --dangerously-bypass-approvals-and-sandbox
      --dangerously-bypass-hook-trust
  -C, --cd <DIR>                  Tell the agent to use the specified directory as its working root
      --add-dir <DIR>             Additional directories that should be writable alongside the primary workspace
      --skip-git-repo-check       Allow running Codex outside a Git repository
      --ephemeral                 Run without persisting session files to disk
      --ignore-user-config        Do not load `$CODEX_HOME/config.toml`; auth still uses `CODEX_HOME`
      --ignore-rules              Do not load user or project execpolicy `.rules` files
      --output-schema <FILE>      Path to a JSON Schema file describing the model's final response shape
      --color <COLOR>             [default: auto] [possible values: always, never, auto]
      --json                      Print events to stdout as JSONL
  -o, --output-last-message <FILE>  Specifies file where the last message from the agent should be written
  -h, --help                      Print help (see a summary with '-h')
  -V, --version                   Print version
```

### 8.3 `codex exec review --help` (excerpt, `VERIFIED-live`)

```
Run a code review against the current repository

Usage: codex exec review [OPTIONS] [PROMPT]

Arguments:
  [PROMPT]   Custom review instructions. If `-` is used, read from stdin

Options:
      --uncommitted      Review staged, unstaged, and untracked changes
      --base <BRANCH>    Review changes against the given base branch
      --commit <SHA>     Review the changes introduced by a commit
      --title <TITLE>    Optional commit title to display in the review summary
  -m, --model <MODEL>
```

### 8.4 `codex login --help` (excerpt, `VERIFIED-live`)

```
Commands:
  status  Show login status

Options:
      --with-api-key         Read the API key from stdin (e.g. `printenv OPENAI_API_KEY | codex login --with-api-key`)
      --with-access-token    Read the access token from stdin (e.g. `printenv CODEX_ACCESS_TOKEN | codex login --with-access-token`)
```

---

## 9. Sources fetched

All fetches performed 2026-07-28 from WSL. GitHub docs retrieved via
`raw.githubusercontent.com` and `gh api` per the lane's tooling rule.

| URL / command | Status | Date |
|---|---|---|
| `gemini --help`, `--version` (local, 0.52.0) | OK — live | 2026-07-28 |
| `gemini mcp --help`, `skills --help`, `hooks --help` (local) | OK — live | 2026-07-28 |
| `gemini --list-sessions` / `-p` / `-p -o json` / `-l` / `mcp list` (local, unauthenticated) | OK — live, rc 41/41/41/41/0 | 2026-07-28 |
| `GEMINI_CLI_HOME=<tmp> gemini --list-sessions` (local isolation probe) | OK — live, redirect confirmed | 2026-07-28 |
| `codex --help`, `codex exec --help`, `codex exec resume --help`, `codex exec review --help`, `codex login --help`, `codex login status`, `codex --version` (local, 0.145.0) | OK — live | 2026-07-28 |
| `grok --help`, `grok agent --help`, `grok models`, `grok --version` (local, 0.2.112) | OK — live | 2026-07-28 |
| `grok --no-auto-update doctor` + `grok --definitely-not-a-flag --version` (hidden-flag control test) | OK — live | 2026-07-28 |
| `gh api repos/google-gemini/gemini-cli/git/trees/main?recursive=1` (docs tree enumeration) | 200 | 2026-07-28 |
| `raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/headless.md` | 200 | 2026-07-28 |
| `…/docs/cli/cli-reference.md` | 200 | 2026-07-28 |
| `…/docs/cli/sandbox.md` | 200 | 2026-07-28 |
| `…/docs/cli/settings.md` | 200 | 2026-07-28 |
| `…/docs/cli/model.md` | 200 | 2026-07-28 |
| `…/docs/cli/model-routing.md` | 200 | 2026-07-28 |
| `…/docs/cli/session-management.md` | 200 | 2026-07-28 |
| `…/docs/cli/checkpointing.md` | 200 | 2026-07-28 |
| `…/docs/cli/git-worktrees.md` | 200 | 2026-07-28 |
| `…/docs/cli/plan-mode.md` | 200 | 2026-07-28 |
| `…/docs/cli/trusted-folders.md` | 200 | 2026-07-28 |
| `…/docs/cli/tutorials/automation.md` | 200 | 2026-07-28 |
| `…/docs/reference/configuration.md` | 200 | 2026-07-28 |
| `…/docs/reference/policy-engine.md` | 200 | 2026-07-28 |
| `…/docs/resources/quota-and-pricing.md` | 200 | 2026-07-28 |
| `…/docs/get-started/authentication.mdx` | 200 | 2026-07-28 |
| `…/docs/get-started/gemini-3.md` | 200 | 2026-07-28 |
| `…/docs/tools/file-system.md` | 200 | 2026-07-28 |
| `…/docs/cli/index.md`, `configuration.md`, `authentication.md`, `commands.md`, `quota-and-pricing.md` (guessed paths) | **404 — wrong paths**; real paths found via `gh api` tree and refetched | 2026-07-28 |
| `…/docs/get-started/authentication.md` (guessed) | **404** — the file is `.mdx` | 2026-07-28 |
| Foreman repo (local reads): `skills/foreman/SKILL.md`, `references/lanes.md`, `scripts/lane-run.sh`, `scripts/lib/worker-cmd.sh`, `scripts/grok-multiround.sh`, `scripts/lane-queue.sh`, `scripts/adapters/verdict.schema.json`, `agents/codex-auditor.md`, `config/foreman.toml.example`, `docs/research/vendor-concurrency-results.md`, `env/tool-check.sh` | OK | 2026-07-28 |

**Not fetched / gaps:** `geminicli.com/plans/` (subscription tier comparison —
referenced by the quota doc, not retrieved); `developers.google.com/gemini-code-assist/resources/quotas`
(authoritative per-tier request limits); `ai.google.dev/gemini-api/docs/rate-limits`
(per-minute API-key limits). All three would sharpen §6.1 but none change the
adapter contract. `docs/research/openai_codex_exec.txt` and
`xai_grok_headless.txt` were superseded for this lane by direct live `--help`
capture against the currently installed 0.145.0 / 0.2.112 binaries.
