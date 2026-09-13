[Claude Cookbook](/cookbook/)

[Claude Agent SDK](/cookbook/?category=Claude+Agent+SDK)[Agent Patterns](/cookbook/?category=Agent+Patterns)

[View on GitHub](https://github.com/anthropics/claude-cookbooks/blob/main/claude_agent_sdk/scheduled_repository_reviewer/scheduled_repository_reviewer.ipynb)

Build a scheduled repository reviewer
=====================================

Build a scheduled, read-only review agent that resumes its session and returns schema-validated verdicts linking each review to the last.

![Cody Anthony](https://avatars.githubusercontent.com/u/307781013?v=4)

Cody Anthony

@codyanthony736

Published on August 26, 2026

Was this page helpful?

Build a Scheduled Repository Reviewer
=====================================

Introduction
------------

Turn recurring review toil into an unattended job you control. Even a well-reviewed repository changes between passes, and the changes can carry issues no earlier review flagged. This recipe hands that job to an agent.

On a schedule you choose, the agent sweeps your repository and returns a verdict and findings that a program can read. Continuity between runs comes from resumed sessions, the Agent SDK feature at the center of this recipe. Resuming is one design choice for a scheduled reviewer. A resumed session carries the whole prior pass forward, with no separate store to build. Each run begins with the findings and everything the reviewer read already loaded rather than starting empty. The section *When to resume and when to start fresh* maps each choice to the jobs it fits.

The repository gets one full baseline review on the first run. Every later run resumes the previous run's session and starts from the findings the agent already reported. You read a short follow-up each cycle, and every follow-up proves the continuity by echoing the prior review's findings. This notebook runs the first two cycles by hand and ends by putting the same reviewer on a schedule.

What you'll learn
-----------------

By the end of this recipe, you'll be able to:

* Run a bounded, read-only review agent unattended, under `permission_mode="dontAsk"` with `max_turns` and `max_budget_usd` set for a scheduler
* Prove continuity across runs by resuming with `ClaudeAgentOptions(resume=...)` and asserting the `RESUME-LINK` fields from `output_format` schema replies, with a fixed finding moving to `resolved` and a newly planted bug caught
* Put the reviewer on cron with `scheduled_review.py`, greppable `VERDICT` and completion lines, and a narrow `except ResultError` path that exits non-zero

When to use this recipe
-----------------------

Use this recipe for a recurring review that remembers its previous pass, such as a dependency audit or a docs-freshness sweep. You run the scheduler yourself, and Claude Code provides the read tools, permission rules, and resumable sessions.

If you don't want to run the scheduler or the infrastructure, one of these managed options may fit better:

* [Claude Code routines(opens in new tab)](https://code.claude.com/docs/en/routines) fit solo developers who want their own GitHub repositories reviewed on a schedule. You configure a prompt, repositories, and connectors once, and Claude runs the routine on managed infrastructure. Routines are in research preview and run on Claude subscription plans.
* [Managed Agents(opens in new tab)](https://platform.claude.com/docs/en/managed-agents/overview) fits when you want managed hosting configured through the Claude API. It hosts the agent loop and its workspace, and a [scheduled deployment(opens in new tab)](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments) starts a session on a cron cadence you set. Managed Agents is in beta, and the repository under review enters the hosted session workspace.

If you want to run the scheduler and the review environment yourself, use this recipe.

Prerequisites
-------------

Before following this guide, ensure you have:

**Required Knowledge:**

* Python fundamentals: comfortable with async/await, functions, and basic data structures
* Basic understanding of agentic patterns: we recommend reading [Building effective agents(opens in new tab)](https://www.anthropic.com/engineering/building-effective-agents)
* Basic familiarity with the Agent SDK's `query()` function: see [the one-liner research agent(opens in new tab)](https://github.com/anthropics/claude-cookbooks/blob/main/claude_agent_sdk/scheduled_repository_reviewer/../00_The_one_liner_research_agent.ipynb) if the SDK is new to you

**Required Tools:**

* Python 3.11 or later
* claude-agent-sdk 0.2.140 or later, the release that adds the typed `ResultError` this recipe catches on its failure path
* An Anthropic API key ([get one here(opens in new tab)](https://platform.claude.com/settings/keys))

Run this notebook from its own directory, so the files it writes land beside it.

**Cost note:** a full pass of this notebook's live runs typically costs about a dime in API usage, and the companion script's runs are similar. Each run prints its own cost in its summary line.

Setup
-----

First, install the required dependencies:

%%capture

%pip install -U "claude-agent-sdk>=0.2.140" python-dotenv

**Note:** Ensure your `.env` file contains:

ANTHROPIC\_API\_KEY=your\_key\_here

Load your environment variables:

from dotenv import load\_dotenv

\_ = load\_dotenv()

Create a sample repository to review
------------------------------------

Create a repository with known defects so that you can check what the reviewer reports. The code below plants a small service in `demo_repo/` for the reviews in this notebook to work against. Each file's source appears as a string constant that the code writes to disk. The files are never imported, so the bugs stay inert, and the Clean up section at the end removes `demo_repo/` when you finish. The service's two application files each carry one real bug:

* `app/config.py` builds its config by copying in the entire environment, then prints the result. Together, those two lines log every environment variable the process holds, secrets included.
* `app/math_utils.py` computes an average by dividing by `len(values)`. Hand it an empty list and it raises `ZeroDivisionError`.

from pathlib import Path

REPO\_DIR = Path("demo\_repo").resolve()

README\_MD = """# sample-repo

A small service kept here so the scheduled reviewer has something to read.

"""

CONFIG\_PY = """import os

def load\_config(path):

config = {"source": path}

config["environment"] = dict(os.environ)

print("loaded config:", config)

return config

"""

MATH\_UTILS\_PY = """def divide(numerator, denominator):

return numerator / denominator

def average(values):

return divide(sum(values), len(values))

"""

SAMPLE\_REPO\_FILES = {

"README.md": README\_MD,

"app/config.py": CONFIG\_PY,

"app/math\_utils.py": MATH\_UTILS\_PY,

}

for relative\_path, body in SAMPLE\_REPO\_FILES.items():

target = REPO\_DIR / relative\_path

target.parent.mkdir(parents=True, exist\_ok=True)

target.write\_text(body, encoding="utf-8")

seeded = sorted(str(path.relative\_to(REPO\_DIR)) for path in REPO\_DIR.rglob("\*") if path.is\_file())

print("sample repo:", seeded)

```
sample repo: ['README.md', 'app/config.py', 'app/math_utils.py']
```

Define what a review returns
----------------------------

With the sample repository in place, the next piece is the review's answer contract. Every consumer of a scheduled review is a program, so the reviewer answers with a JSON object read by field. `output_format` takes a JSON schema, and the reply arrives on `ResultMessage.structured_output` already shaped to it. Each review carries a review id, a verdict from a closed set, and findings that each carry an id of their own.

The finding ids drive the continuity proof. The follow-up review names the previous run's ids, showing the reviewer carried those findings forward.

from enum import StrEnum

class Verdict(StrEnum):

"""The two verdicts a scheduled review may report."""

OK = "ok"

CONCERNS = "concerns"

VERDICT\_VALUES = [verdict.value for verdict in Verdict]

FINDING\_SCHEMA = {

"type": "object",

"properties": {

"id": {"type": "string"},

"file": {"type": "string"},

"summary": {"type": "string"},

},

"required": ["id", "file", "summary"],

}

FIRST\_REVIEW\_SCHEMA = {

"type": "object",

"properties": {

"review\_id": {"type": "string"},

"verdict": {"type": "string", "enum": VERDICT\_VALUES},

"findings": {"type": "array", "items": FINDING\_SCHEMA},

},

"required": ["review\_id", "verdict", "findings"],

}

Extend the schema for the follow-up
-----------------------------------

The recipe runs two reviews, and the second needs a way to point back at the first. `previous_review_id` and `previous_finding_ids` point back at the first review, and `resolved` lists the previous finding ids that no longer apply. Merging the first schema keeps the shared half in one place, so the two schemas can't drift apart.

`previous_review_id` and `previous_finding_ids` carry the continuity assertion. When the reviewer carries the earlier review forward, the fields come back holding the first run's review id and finding ids. When the reviewer starts over, the fields say so, and you find out from that run's log line.

CONTINUITY\_PROPERTIES = {

"previous\_review\_id": {"type": "string"},

"previous\_finding\_ids": {"type": "array", "items": {"type": "string"}},

"resolved": {"type": "array", "items": {"type": "string"}},

}

FOLLOW\_UP\_REVIEW\_SCHEMA = FIRST\_REVIEW\_SCHEMA | {

"properties": FIRST\_REVIEW\_SCHEMA["properties"] | CONTINUITY\_PROPERTIES,

"required": [\*FIRST\_REVIEW\_SCHEMA["required"], \*CONTINUITY\_PROPERTIES.keys()],

}

print("follow-up required fields:", FOLLOW\_UP\_REVIEW\_SCHEMA["required"])

```
follow-up required fields: ['review_id', 'verdict', 'findings', 'previous_review_id', 'previous_finding_ids', 'resolved']
```

Configure the bounded, read-only reviewer
-----------------------------------------

With both schemas defined, the agent configuration is next. These options fit an agent that runs unattended:

* **`tools`**: decides which built-in tools exist for the agent. Restricting the list to `Read`, `Glob`, and `Grep` leaves the reviewer no write tool.
* **`allowed_tools`**: decides which tool calls run without a permission prompt. The `Read` grant is scoped to the repository path, and under `dontAsk` a read outside it is denied as a tool error. `Glob` and `Grep` enter as bare grants that approve the whole tool, and the `deny_reads_outside_repo` hook is what confines them. The `StructuredOutput` entry in the run summaries comes from `output_format` rather than this list, and it only carries the reply.
* **`permission_mode="dontAsk"`**: never prompts and denies anything not pre-approved. The `auto` permission mode also runs without routine prompts, approving or denying each call with a model classifier at runtime. This reviewer uses `dontAsk` to keep its tool surface fixed to the allow rules.
* **`model`**: pins the review to a named model. Without a pin the SDK uses the environment's default model, which can change over time. The pin keeps a scheduled job's cost and review behavior where you set them until you choose to change them.
* **`strict_mcp_config=True`**: limits the session to the MCP servers this configuration declares, which is none. Without it, MCP servers configured on the machine or account attach to the session, and their tool definitions enter every request.
* **`max_turns` and `max_budget_usd`**: cap the agentic loop and the spend. Exceeding either ends the run with a terminal error result, `error_max_turns` or `error_max_budget_usd`, which the SDK raises to your code as a `ResultError`. The run stops once spend has already exceeded the budget, so a cycle can end over the cap.
* **`hooks`**: registers `deny_reads_outside_repo` as a [`PreToolUse`(opens in new tab)](https://code.claude.com/docs/en/agent-sdk/hooks) callback. The callback sees every `Read`, `Grep`, and `Glob` call and denies any whose path resolves outside the repository, and any Glob pattern that starts with `/` or `~`, carries a `..` segment, or contains a `{` brace.
* **`setting_sources=[]`**: keeps the run off the machine's filesystem settings. A scheduled review then behaves the same on your laptop and on the box that runs the cron job. The empty list also keeps the reviewed repository's own `.claude/settings.json` and `CLAUDE.md` out of the session. The reviewer's `cwd` is that repository, and a repository you don't control should not configure its own reviewer.
* **`output_format` and `resume`**: `output_format` asks for a reply matching the schema you pass in, and `resume` carries continuity between runs. Pass `None` on a cold run and the previous run's session id on a scheduled follow-up.

### The safeguards these options implement

The option set above implements several safeguards for running an agent unattended. The read-only tool grant, the MCP and settings isolation, and the turn and budget caps bound what a run can do. The scheduled session reset limits how long a session's context persists.

Reads are scoped twice. The `allowed_tools` grant confines `Read` to the repository path in both the notebook and the script, and reads still follow the job user's own file access. Run the deployment steps under a user whose access is limited to what the review needs.

Claude Code applies `Read` rules to `Grep` and `Glob` best-effort. `deny_reads_outside_repo` makes the read confinement hold without depending on that coverage.

The companion script installs the same hook, and the hook already denies reads of the service directory. The script also adds a `disallowed_tools` rule as an independent second layer, blocking the `Read` tool on that directory, where the env and session files live. The rule is set only when the `service_dir` parameter is passed, and the notebook's calls leave it unset.

The same safeguards protect against prompt injection, covered in [Protect against prompt injection(opens in new tab)](https://code.claude.com/docs/en/security#protect-against-prompt-injection). With `tools` restricted to `Read`, `Glob`, and `Grep`, the session has no shell and no network tool, and content the reviewer reads has nowhere to go but the reply itself. That is why the answer key checks replies in this notebook, and why `review.log` gets the same handling as the repository it reviews.

from typing import Any

from claude\_agent\_sdk import (

AssistantMessage,

ClaudeAgentOptions,

HookContext,

HookMatcher,

ResultError,

ResultMessage,

TextBlock,

ToolUseBlock,

query,

)

READ\_ONLY\_TOOLS = ["Read", "Glob", "Grep"]

MODEL = "claude-sonnet-5"

FIRST\_RUN\_BUDGET\_USD = 0.25

FOLLOW\_UP\_BUDGET\_USD = 0.20

FIRST\_RUN\_MAX\_TURNS = 20

FOLLOW\_UP\_MAX\_TURNS = 14

TEXT\_LOG\_CHARS = 400

def clip(text: Any) -> str:

"""Flatten text onto one bounded log line, marking the cut when one happens.

Findings arrive as free text and land in a log other tools grep. Dropping

unprintable characters and collapsing whitespace keeps each field on one

log line of its own.

"""

printable = "".join(char if char.isprintable() else " " for char in str(text))

flat = " ".join(printable.split())

return flat if len(flat) <= TEXT\_LOG\_CHARS else flat[:TEXT\_LOG\_CHARS] + "..."

REVIEWER\_SYSTEM\_PROMPT = (

"You are a repository review agent running on a schedule with nobody "

"watching. Inspect the files with your read-only tools, keep the review "

"short, and answer with the JSON object the caller's schema describes."

)

def deny\_reads\_outside\_repo(repo: Path):

"""Deny any Read, Grep, or Glob call whose path resolves outside repo.

The hook confines Grep and Glob deterministically instead of relying

on Read-rule coverage of those tools. Candidate paths resolve

symlinks, so a Read through an in-repository link is denied when it

lands outside. Absolute Glob patterns, patterns carrying a `..` segment, and

patterns carrying brace syntax the segment check can't reason about are

denied rather than trusted to stay inside their search root.

"""

def denial(reason: str) -> dict[str, Any]:

return {

"hookSpecificOutput": {

"hookEventName": "PreToolUse",

"permissionDecision": "deny",

"permissionDecisionReason": reason,

}

}

async def deny(

input\_data: dict[str, Any], tool\_use\_id: str | None, context: HookContext

) -> dict[str, Any]:

tool\_input = input\_data.get("tool\_input") or {}

raw = tool\_input.get("file\_path") or tool\_input.get("path")

if raw:

candidate = Path(raw).expanduser()

if not candidate.is\_absolute():

candidate = repo / candidate

candidate = candidate.resolve()

if not candidate.is\_relative\_to(repo):

return denial(f"path outside the repository under review: {candidate}")

if input\_data.get("tool\_name") == "Glob":

pattern = tool\_input.get("pattern")

if isinstance(pattern, str) and (

pattern.startswith(("/", "~")) or "{" in pattern or ".." in pattern.split("/")

):

return denial(f"glob pattern may leave the repository under review: {pattern}")

return {}

return deny

def review\_options(

repo: Path,

schema: dict[str, Any],

max\_turns: int,

resume\_session\_id: str | None = None,

service\_dir: Path | None = None,

) -> ClaudeAgentOptions:

"""Build the options for one scheduled review pass."""

options = ClaudeAgentOptions(

# The agent works inside the reviewed repository.

cwd=str(repo),

system\_prompt=REVIEWER\_SYSTEM\_PROMPT,

tools=READ\_ONLY\_TOOLS,

# The //-anchored form is deliberate: with a single leading slash

# the rule anchors at the settings source, not the filesystem

# root, matches nothing, and every read is denied under dontAsk.

# repo is absolute, so the rendered rule keeps the double slash.

allowed\_tools=[f"Read(/{repo}/\*\*)", "Glob", "Grep"],

permission\_mode="dontAsk",

model=MODEL,

# Keep machine- and account-configured MCP servers out of the

# session.

strict\_mcp\_config=True,

max\_turns=max\_turns,

max\_budget\_usd=FOLLOW\_UP\_BUDGET\_USD if resume\_session\_id else FIRST\_RUN\_BUDGET\_USD,

hooks={

"PreToolUse": [

HookMatcher(matcher="Read|Grep|Glob", hooks=[deny\_reads\_outside\_repo(repo)])

]

},

# Same behavior on a laptop and on the box that runs the cron job.

setting\_sources=[],

output\_format={"type": "json\_schema", "schema": schema},

# None on a cold run, and the persisted session id on a follow-up.

resume=resume\_session\_id,

)

if service\_dir is not None:

# A second, independent layer beside the hook, which already

# denies these reads: block the Read tool on the service

# directory, where the env and session files live.

options.disallowed\_tools = [f"Read(/{service\_dir}/\*\*)"]

return options

Read the reply with fallbacks
-----------------------------

The reply arrives already validated against the review schema. The two readers below, `verdict_of` and `finding_ids`, repeat that check at the point of use for `verdict` and `findings`, the two fields the code acts on. Each reader matches the shape its field needs and falls back to a fixed default otherwise. The cell also defines `RunOutcome`, the container the runner fills, and `string_items`, the list reader the continuity checks use.

A missing or unrecognized verdict reads as `concerns`, the state that draws attention. A findings list that arrives in any other shape yields no ids rather than a partial guess. The code ends by exercising both defaults on malformed input, so the output below shows the fallbacks.

from dataclasses import dataclass, field

@dataclass

class RunOutcome:

"""What one scheduled run reported back."""

session\_id: str | None = None

subtype: str = "no\_result"

num\_turns: int = 0

total\_cost\_usd: float | None = None

denials: int = 0

payload: dict[str, Any] = field(default\_factory=dict)

tools\_attempted: list[str] = field(default\_factory=list)

def sequence\_of(value: Any) -> list[Any]:

"""Return a list-shaped field's items, or nothing when it isn't one."""

match value:

case [\*items]:

return items

case \_:

return []

def verdict\_of(payload: dict[str, Any]) -> Verdict:

"""Read the verdict from the structured reply, falling back to concerns

when the field is missing or unrecognized."""

match payload:

case {"verdict": str(value)} if value in VERDICT\_VALUES:

return Verdict(value)

case \_:

return Verdict.CONCERNS

def finding\_ids(payload: dict[str, Any]) -> list[str]:

"""Collect finding ids from the structured reply."""

ids: list[str] = []

for finding in sequence\_of(payload.get("findings")):

match finding:

case {"id": str(finding\_id)}:

ids.append(finding\_id)

return ids

def string\_items(value: Any) -> list[str]:

"""Collect the plain strings from a list-shaped field."""

return [item for item in sequence\_of(value) if isinstance(item, str)]

print("fallbacks:", verdict\_of({}), finding\_ids({"findings": "not-a-list"}))

```
fallbacks: concerns []
```

Build the review runner
-----------------------

The schemas, options, and readers come together in the runner. The runner streams the messages, prints what the reviewer says, lists the tools the reviewer reaches for, and keeps the final `ResultMessage`'s `session_id` and `structured_output`.

The report at the end of each run prints the verdict and then each finding on its own line, read through the reply readers. The per-block print is capped, with a visible marker on any cut line, and the cap keeps one long reply from flooding a scheduled log. A structured-output run usually emits little prose, and a run may narrate a line or two before its tool calls. In the recorded runs, both cycles stream only tool calls. Either way the findings in the log come from the reply's payload rather than from streamed text.

This same runner ships beside the notebook as [`scheduled_review.py`(opens in new tab)](https://github.com/anthropics/claude-cookbooks/blob/main/claude_agent_sdk/scheduled_repository_reviewer/scheduled_review.py), the companion you deploy when you put the reviewer on a schedule.

A run that fails exits non-zero and never prints its completion line. Both failure classes end that way:

* **Exceeding a bound**: `max_turns` or `max_budget_usd` ends the run with a terminal error result and a non-zero CLI exit. The SDK surfaces that result to your code as a raised `ResultError` carrying the result's subtype.
* **Failing with no terminal result**: a CLI process killed mid-run or a connection that never opens raises its own exception type, which escapes the typed catch, so no failure line prints.

Each review run catches `ResultError` around its `run_review` call, prints one `REVIEW-CYCLE-INCOMPLETE` line, and re-raises. The notebook stops on the failure instead of continuing to a success line. The induced run in Prove the failure path catches the `ResultError` without re-raising it. Triggering the failure is that cell's point.

async def run\_review(

\*,

repo: Path,

label: str,

prompt: str,

schema: dict[str, Any],

max\_turns: int,

resume\_session\_id: str | None = None,

service\_dir: Path | None = None,

) -> RunOutcome:

"""Run one review pass and return its structured result."""

options = review\_options(repo, schema, max\_turns, resume\_session\_id, service\_dir)

outcome = RunOutcome()

async for message in query(prompt=prompt, options=options):

match message:

case AssistantMessage(content=blocks):

for block in blocks:

match block:

case TextBlock(text=text):

line = text.strip()

if line:

# Cap what a scheduled log absorbs per block.

print(f"[{label}] {clip(line)}")

case ToolUseBlock(name=tool\_name):

outcome.tools\_attempted.append(tool\_name)

case ResultMessage() as result:

outcome.session\_id = result.session\_id

outcome.subtype = result.subtype

outcome.num\_turns = result.num\_turns

outcome.total\_cost\_usd = result.total\_cost\_usd

outcome.denials = len(result.permission\_denials or [])

if isinstance(result.structured\_output, dict):

outcome.payload = result.structured\_output

return outcome

def report(label: str, outcome: RunOutcome) -> Verdict:

"""Print the scheduler-shaped lines for one run and return its verdict."""

cost = f"{outcome.total\_cost\_usd:.4f}" if outcome.total\_cost\_usd is not None else "n/a"

print(

f"{label} session={outcome.session\_id} subtype={outcome.subtype} "

f"turns={outcome.num\_turns} denials={outcome.denials} "

f"cost\_usd={cost} "

f"tools\_attempted={','.join(dict.fromkeys(outcome.tools\_attempted)) or 'none'}"

)

verdict = verdict\_of(outcome.payload)

print(f"VERDICT: {verdict}")

for finding in sequence\_of(outcome.payload.get("findings")):

match finding:

case {"id": str(finding\_id), "file": str(file\_path), "summary": str(summary)}:

print(f" {clip(finding\_id)} {clip(file\_path)}: {clip(summary)}")

return verdict

Run the cold review
-------------------

The two live runs start here as the schedule's first two cycles, with the interval collapsed. The first review runs cold. With no `resume` set, the run reads the whole repository and answers with the first-review schema. The run ends with a verdict, a set of finding ids, and the `session_id` the next run resumes.

**Expected output:** a `RUN-1` summary line with `subtype=success`, then `VERDICT: concerns` with finding lines covering both planted defects under it. One defect can split into more than one finding, though the recorded run prints one per planted defect. The session id in the summary line is what run 2 resumes.

A non-zero `denials` count in the summary line is the read confinement working. The hook denies root-anchored `Read` attempts, such as `/app/config.py`, and the reviewer retries with in-repository paths. A `Glob` pattern using brace expansion, such as `**/*.{py,md}`, lands in the same count. Whether a run shows any denials depends on which paths and patterns the reviewer tries first.

Denials cost retries inside the turn budget. If your repository's reviews lean on brace patterns, adapt the hook to expand them and run the same checks on each expansion, instead of denying the pattern outright.

import uuid

FIRST\_REVIEW\_ID = f"review-{uuid.uuid4().hex[:8]}"

FIRST\_PROMPT = (

f"Scheduled review {FIRST\_REVIEW\_ID} of the repository in the current "

"directory. "

"Read the source files and report correctness or security problems you can "

"point at a specific file and function. Give each finding a summary of "

"one or two sentences and an id of the form "

'F1, F2, and so on. Use the verdict "concerns" when you report at least one '

'finding and "ok" when the repository looks clean. Echo '

f"{FIRST\_REVIEW\_ID} back as review\_id."

)

try:

first = await run\_review(

repo=REPO\_DIR,

label="run-1",

prompt=FIRST\_PROMPT,

schema=FIRST\_REVIEW\_SCHEMA,

max\_turns=FIRST\_RUN\_MAX\_TURNS,

)

except ResultError as exc:

cost = (exc.data or {}).get("total\_cost\_usd")

cost\_str = f"{cost:.4f}" if isinstance(cost, (int, float)) else "n/a"

print(

f"REVIEW-CYCLE-INCOMPLETE stage=run-1 subtype={exc.subtype} "

f"reason={exc.terminal\_reason} cost\_usd={cost\_str}"

)

raise

if first.subtype != "success" or first.session\_id is None or not first.payload:

print(f"REVIEW-CYCLE-INCOMPLETE stage=run-1 subtype={first.subtype}")

raise RuntimeError("run 1 did not complete; there is no session to resume")

first\_verdict = report("RUN-1", first)

```
RUN-1 session=2d83a97b-27ff-403e-a067-2fb5b6474d9b subtype=success turns=10 denials=3 cost_usd=0.0278 tools_attempted=Glob,Read,StructuredOutput
VERDICT: concerns
  F1 app/math_utils.py: divide() does not guard against denominator being zero, and average() calls divide(sum(values), len(values)) which raises ZeroDivisionError when values is an empty list.
  F2 app/config.py: load_config() copies the entire process environment (os.environ) into the config dict and prints it via print(), which can leak secrets/credentials (API keys, tokens) into logs.
```

Change the repository between cycles
------------------------------------

In deployment, a change that lands between cycles either fixes a finding the reviewer reported or introduces a problem the reviewer has not seen. The code below makes one change of each kind before the follow-up runs.

The code fixes the zero guard in `app/math_utils.py`, the finding that should come back resolved. It plants a new file, `app/retry.py`, whose retry loop has no limit, the problem the follow-up should catch as new. The new problem sits in a file run 1 never read. Catching it proves the follow-up looked at the repository as it stands now instead of answering from the files it already knew.

MATH\_UTILS\_FIXED = """def divide(numerator, denominator):

if denominator == 0:

raise ValueError("denominator must be non-zero")

return numerator / denominator

def average(values):

if not values:

return 0.0

return divide(sum(values), len(values))

"""

RETRY\_PY = """import time

def fetch\_with\_retry(fetch):

while True:

try:

return fetch()

except ConnectionError:

time.sleep(1)

"""

(REPO\_DIR / "app/math\_utils.py").write\_text(MATH\_UTILS\_FIXED, encoding="utf-8")

(REPO\_DIR / "app/retry.py").write\_text(RETRY\_PY, encoding="utf-8")

changed = sorted(str(path.relative\_to(REPO\_DIR)) for path in REPO\_DIR.rglob("\*") if path.is\_file())

print("repository now:", changed)

```
repository now: ['README.md', 'app/config.py', 'app/math_utils.py', 'app/retry.py']
```

Run the resumed review
----------------------

The next scheduled run passes the first run's `session_id` as `resume` and asks for the follow-up schema. The prompt's first instruction is to list the repository's files again. Without that step, a resumed agent can answer from the files it read in run 1 and never notice that `app/retry.py` is new. The code below checks the reply against run 1 and prints a `RESUME-LINK` line carrying the continuity proof in three fields:

* `same_session`: the two runs share one session to show that the resume itself worked
* `prior_review_id_echoed`: the follow-up named the first review's id
* `recalled_findings`: how many of the first run's finding ids the follow-up carried back

When all three hold, the reviewer answered from the review it already did. When one of the three fails, the code prints a `RESUME-LINK-BROKEN` marker on its own line. The reply also lists `resolved`, the previous finding ids that no longer apply.

**Expected output:**

* a `RESUME-LINK` line with `same_session=True`, `prior_review_id_echoed=True`, and a full `recalled_findings` count
* a `resolved` list holding the zero-guard finding ids
* findings that keep the config leak and add the new retry bug
* the `REVIEW-CYCLE-COMPLETE` line to close the cycle

SECOND\_REVIEW\_ID = f"review-{uuid.uuid4().hex[:8]}"

FOLLOW\_UP\_PROMPT = (

f"Scheduled review {SECOND\_REVIEW\_ID} of the same repository, one cycle "

"later. List the repository's files again, then read the source files as "

"they stand now. Answer from the most recent review you did in this "

"conversation: put its review id in previous\_review\_id and the ids of the "

"findings it reported in previous\_finding\_ids. Report the findings that "

"still apply, keeping the ids you gave them earlier, list in resolved the "

"ids of previous findings that no longer apply, and report anything newly "

"wrong as a new finding with a summary of one or two sentences. Echo "

f"{SECOND\_REVIEW\_ID} back as review\_id."

)

try:

second = await run\_review(

repo=REPO\_DIR,

label="run-2",

prompt=FOLLOW\_UP\_PROMPT,

schema=FOLLOW\_UP\_REVIEW\_SCHEMA,

max\_turns=FOLLOW\_UP\_MAX\_TURNS,

resume\_session\_id=first.session\_id,

)

except ResultError as exc:

cost = (exc.data or {}).get("total\_cost\_usd")

cost\_str = f"{cost:.4f}" if isinstance(cost, (int, float)) else "n/a"

print(

f"REVIEW-CYCLE-INCOMPLETE stage=run-2 subtype={exc.subtype} "

f"reason={exc.terminal\_reason} cost\_usd={cost\_str}"

)

raise

if second.subtype != "success" or second.session\_id is None or not second.payload:

print(f"REVIEW-CYCLE-INCOMPLETE stage=run-2 subtype={second.subtype}")

raise RuntimeError("run 2 did not complete")

second\_verdict = report("RUN-2", second)

prior\_ids = finding\_ids(first.payload)

recalled\_ids = string\_items(second.payload.get("previous\_finding\_ids"))

matched = sorted(set(recalled\_ids) & set(prior\_ids))

echoed = second.payload.get("previous\_review\_id") == FIRST\_REVIEW\_ID

print(

f"RESUME-LINK run1\_session={first.session\_id} "

f"run2\_session={second.session\_id} "

f"same\_session={second.session\_id == first.session\_id} "

f"prior\_review\_id\_echoed={echoed} "

f"recalled\_findings={len(matched)}/{len(set(prior\_ids))}"

)

print(f"resolved={[clip(i) for i in string\_items(second.payload.get('resolved'))]}")

if second.session\_id != first.session\_id or not echoed or (prior\_ids and not matched):

# Prints on a completed run by design, mirroring the script's marker.

print(

f"RESUME-LINK-BROKEN same\_session={second.session\_id == first.session\_id} "

f"recalled\_findings={len(matched)}/{len(set(prior\_ids))}"

)

print(f"REVIEW-CYCLE-COMPLETE runs=2 verdicts={first\_verdict},{second\_verdict}")

```
RUN-2 session=2d83a97b-27ff-403e-a067-2fb5b6474d9b subtype=success turns=7 denials=0 cost_usd=0.0339 tools_attempted=Glob,Read,StructuredOutput
VERDICT: concerns
  F2 app/config.py: load_config() still copies the entire process environment (os.environ) into the config dict and prints it via print(), which can leak secrets/credentials into logs.
  F3 app/retry.py: fetch_with_retry() retries in an unbounded infinite loop with a fixed 1-second sleep and no max attempt limit or exponential backoff, risking indefinite hangs/resource exhaustion if the underlying fetch keeps raising ConnectionError; other exceptions are also not handled.
RESUME-LINK run1_session=2d83a97b-27ff-403e-a067-2fb5b6474d9b run2_session=2d83a97b-27ff-403e-a067-2fb5b6474d9b same_session=True prior_review_id_echoed=True recalled_findings=2/2
resolved=['F1']
REVIEW-CYCLE-COMPLETE runs=2 verdicts=concerns,concerns
```

Check the findings against the planted changes
----------------------------------------------

The repository's bugs and the between-cycle changes are known in advance, so they serve as an answer key for both runs.

### Check run 1's report

Run 1 reports at least the two planted bugs:

* `app/config.py`: the loader copies the whole environment into the config and prints it
* `app/math_utils.py`: `divide` has no zero guard, so `average([])` raises `ZeroDivisionError`

`config["environment"] = dict(os.environ)` is a single innocuous line. The leak exists because the `print` on the next line publishes it and environment variables are where deployments keep their secrets. Reporting it means the reviewer connected those three facts across the file. The zero guard tests only that the reviewer reads carefully.

### Check the follow-up's delta

The follow-up's report splits the between-cycle changes into three parts:

* the config leak stays in `findings` with its earlier id
* the fixed zero guard's id moves to `resolved`
* `app/retry.py`'s unbounded retry arrives as a new finding

`prior_review_id_echoed=True` means the resumed reviewer named the id it was given in run 1, and `recalled_findings` counts how many of run 1's finding ids came back.

### Expect variation between runs

Model output varies between runs. The reviewer may:

* phrase the findings differently
* assign different ids
* split one planted bug into several findings (the zero guard can arrive as one finding or as separate `divide` and `average` findings)
* report additional lower-severity observations

Ids in `resolved` follow what the change fixed, however the reviewer split them. However phrased, a correct first run reports both planted bugs, a correct follow-up reports the three-part delta, and the `RESUME-LINK` fields carry the continuity proof.

Change something else in `demo_repo/` and run the follow-up again to watch the delta shift. The notebook pins its baseline to run 1, and a repeated follow-up reports `prior_review_id_echoed=False` and prints the `RESUME-LINK-BROKEN` marker even though the resume worked. The companion script saves a new baseline after every run, and a repeated follow-up there keeps its link intact.

Prove the failure path
----------------------

The runner section describes what a failed run looks like. The cell below triggers one deliberately, running a fresh review against the same repository under `max_turns=1`, a cap one full review cannot fit. The run ends with a terminal error result, the SDK raises it as a `ResultError`, and the `except` block prints the failure line carrying the result's `subtype` and `terminal_reason`.

**Expected output:** a `REVIEW-CYCLE-INCOMPLETE` line with `stage=induced subtype=error_max_turns reason=max_turns` and the cost the failed run consumed, and no completion line.

try:

await run\_review(

repo=REPO\_DIR,

label="induced",

prompt=FIRST\_PROMPT,

schema=FIRST\_REVIEW\_SCHEMA,

max\_turns=1,

)

except ResultError as exc:

cost = (exc.data or {}).get("total\_cost\_usd")

cost\_str = f"{cost:.4f}" if isinstance(cost, (int, float)) else "n/a"

print(

f"REVIEW-CYCLE-INCOMPLETE stage=induced subtype={exc.subtype} "

f"reason={exc.terminal\_reason} cost\_usd={cost\_str}"

)

else:

raise RuntimeError("the run completed under max\_turns=1")

```
REVIEW-CYCLE-INCOMPLETE stage=induced subtype=error_max_turns reason=max_turns cost_usd=0.0032
```

Put the reviewer on a schedule
------------------------------

The two cycles above ran by hand. On a schedule, each cycle is one invocation of [`scheduled_review.py`(opens in new tab)](https://github.com/anthropics/claude-cookbooks/blob/main/claude_agent_sdk/scheduled_repository_reviewer/scheduled_review.py), the companion script beside this notebook. It runs from its own service directory, takes the repository to review as its argument, and carries the same schemas and reply readers.

The script's marker lines say `REVIEW-RUN` where the notebook's cycles say `REVIEW-CYCLE`, and the notebook's markers never appear in a scheduled log. The script reviews cold when its session file, `.last_review_session`, is absent from the service directory and resumes when the file is present. Its `read_state` function holds the persistence that notebook variables stood in for here.

Read the script once before you schedule it.

Run the reviewer on a persistent host. Give the job a user whose file access is limited to what the review needs, and run every step below as that user. Resuming depends on two local files surviving between cycles:

* `.last_review_session`, the session file the script keeps beside itself in the service directory
* the session transcript the SDK writes under `~/.claude/projects/`, or under the `projects/` directory in `CLAUDE_CONFIG_DIR` when you set that variable

Keep the service directory outside the repository you review. With that layout, a clean checkout or branch switch cannot delete the session file, and the file never shows up among the files the reviewer reads. A trial run from this recipe's own directory, `python scheduled_review.py demo_repo`, is refused at startup with a `reason=repository-inside-service-directory` usage line. A service directory inside the repository is refused the same way, with a `reason=service-directory-inside-repository` usage line.

### Schedule the script

1. Create the service directory with its own environment. The notebook's `%pip` install reaches only the notebook's own environment, and cron runs whatever interpreter the command names. The service directory carries its own virtual environment with the SDK installed:

   sudo mkdir -p /srv/reviewer && sudo chown $USER /srv/reviewer && cd /srv/reviewer

   python3 -m venv .venv

   .venv/bin/pip install "claude-agent-sdk>=0.2.140"

   cp /path/to/scheduled\_review.py .

   Use a `python3` of 3.11 or later, the floor the prerequisites name, since an older interpreter fails at the script's first import.
2. Create the environment file the cron job sources, at `/srv/reviewer/reviewer.env`. The scheduler has to supply the environment, because cron starts with almost none. Use `export` lines, since a plain `KEY=value` assignment sets a shell variable that the Python process never inherits. Cron strips `PATH` to a minimum. Set it to cover the directories holding the binaries the job needs:

   # /srv/reviewer/reviewer.env, sourced by the cron job

   export PATH=/usr/local/bin:$PATH

   export ANTHROPIC\_API\_KEY=your\_key\_here

   Before the key goes in, create the file empty and restrict it with `touch /srv/reviewer/reviewer.env && chmod 600 /srv/reviewer/reviewer.env`, then add the lines above. By default the script also denies itself `Read` access to the service directory, keeping the key file out of any finding. The same denial would blind a review of any repository inside the service directory. The script refuses that layout outright. Keep the key out of the crontab line itself, because anyone who can list the crontab can read it.
3. Run the script once by hand from the service directory, pointed at the repository you want reviewed:

   cd /srv/reviewer && . ./reviewer.env && .venv/bin/python scheduled\_review.py /path/to/your/repo

   This first run reviews cold, prints `REVIEW-RUN-COMPLETE: cold`, and creates the `.last_review_session` file and the session transcript that every scheduled run resumes. If the run exits 1 with `error_max_budget_usd`, raise `FIRST_RUN_BUDGET_USD` before scheduling. A cold run that can't fit its budget never establishes a baseline, and every scheduled cycle then repeats the same failure.
4. Add a crontab entry with `crontab -e` for a nightly review at 02:00. Schedule it as the same user who ran step 3, because the session transcript lives under that user's home:

   0 2 \* \* \* cd /srv/reviewer && . ./reviewer.env && flock -n -E 99 .review.lock .venv/bin/python scheduled\_review.py /path/to/your/repo >> /srv/reviewer/review.log 2>&1 || echo "REVIEW-RUN-EXIT: $?" >> /srv/reviewer/review.log

   The entry's tail turns a failing invocation's exit status into a log line. Both redirects name the log by absolute path, and a marker never lands in a file relative to the directory cron starts in.

   `flock -n` skips an invocation while the previous one still holds the lock, and `-E 99` gives the skip its own exit code. A skipped run logs `REVIEW-RUN-EXIT: 99` and never masquerades as a failed one. `flock` comes from util-linux on Linux hosts. macOS has no flock by default, and Homebrew's [flock formula(opens in new tab)](https://formulae.brew.sh/formula/flock) provides one.

   Findings quote repository content, so give `review.log` the same handling as the repository it reviews. Rotate the log the way you rotate your other service logs. The next section's `REVIEW-RUN-EXIT` row shows how to read it.

### Read the output lines

Your scheduler reads these lines:

| Line | Fires when | Exit code | Alert |
| --- | --- | --- | --- |
| `VERDICT: ok` or `VERDICT: concerns` | A completed review reports the structured reply's verdict. A failed run never prints one | 0 | Alert on `concerns` |
| `RESUME-LINK ...` | Every resumed run. `same_session=True` with a steady `recalled_findings` count is continuity working, and `current_findings` counts the follow-up's own findings | 0 | Threshold `recalled_findings` in your own alerting. A gradually collapsing count prints no marker and is the reset signal the Reset the session on a schedule section describes |
| `RESUME-LINK-BROKEN ...` | The link breaks outright: the session was lost, the echo was lost, or recall hit zero. The marker leads its line, the form to grep | 0 | Alert. The run has already saved a new baseline for the next cycle |
| `REVIEW-RUN-COMPLETE: cold` or `: resumed` | A review verifiably succeeded | 0 | None. Its presence means the cycle closed |
| `REVIEW-RUN-INCOMPLETE ...` | The run ended on a terminal error result, most often an exceeded bound. `subtype` names what ended it; bounds and schema failures add `reason`. After a session crash the line can print `cost_usd=0.0000`, which means the cost is unknown rather than zero | 1 | Alert. A bounds failure keeps the session file, and its fix is a config change |
| `REVIEW-RUN-INCOMPLETE ... subtype=error_max_structured_output_retries` | The reply repeatedly failed schema validation, or a [model fallback(opens in new tab)](https://code.claude.com/docs/en/model-config#automatic-model-fallback) retracted a completed reply with no retry left to replace it. Neither is a session problem | 1 | Alert. The session file is kept |
| `REVIEW-RUN-INCOMPLETE stage=usage ...` | The invocation itself is wrong, such as a missing repository argument | 2 | Alert. Fix the crontab entry |
| `SESSION-FILE-CLEARED: next run reviews cold` | A resumed run failed with `subtype=error_during_execution`, most often a saved session that no longer resumes; a transient connection failure lands here too, trading one cold rebuild for self-healing | 1 | None beyond the failure alert. The next cycle rebuilds the baseline cold |
| `SESSION-STATE-NOT-SAVED ...` | The review completed but its state could not be written, most often a full or read-only disk. The findings above the marker are valid. A following `SESSION-FILE-CLEARED` means the next run rebuilds cold; `SESSION-FILE-STALE` means it will resume the previous session | 1 | Alert. Fix the disk; the review itself needs no rerun |
| `REVIEW-RUN-EXIT: <code>` | The crontab entry's tail records a non-zero exit, including the `99` a skipped overlapping run leaves | n/a | Alert on any code other than 99 |
| No line at all | The run died before a terminal result, such as a killed process or a connection that never opens | non-zero | Alert on a missing completion line with no `99` skip explaining it |

An induced `max_turns=1` run prints a line beginning `REVIEW-RUN-INCOMPLETE stage=cold subtype=error_max_turns reason=max_turns`, the prefix to grep, with the run's `cost_usd` completing the line. The Prove the failure path section triggered the same terminal result in the notebook.

A successful cycle leaves `REVIEW-RUN-COMPLETE` in the log and a failed cycle leaves a `REVIEW-RUN-EXIT` marker. Alert on any `REVIEW-RUN-EXIT` code other than 99, or on a cycle whose completion line is missing with no `99` skip explaining it. A skip is normal overlap, and repeated skips mean runs are outlasting the schedule. Anchor greps at the start of the line for every marker. Finding text is clipped onto single indented lines, so a marker only ever begins its own line. A `stage=resumed` failure followed by a `SESSION-FILE-CLEARED` line means the saved session no longer resumed, most often because its transcript under `~/.claude/projects/` is gone.

### Customize the reviewer

* **The prompts**: point the follow-up prompt at what the review should track, such as new dependencies, breaking API changes, or TODO debt.
* **The schema**: add the fields your alerts need, such as a severity per finding. The reply comes back validated against whatever you declare. The script carries its own copy of the schemas and readers. Change both when you customize either.
* **The bounds**: `max_turns` and `max_budget_usd` live at the top of the script. Both bounds in this notebook's cells are sized for the three-file sample repository, with headroom above the recorded runs' own `cost_usd` figures. The script's defaults leave headroom for a real repository. The budget is a runaway backstop, split like the turn caps. The baseline review runs under `FIRST_RUN_BUDGET_USD` and every follow-up under `FOLLOW_UP_BUDGET_USD`. The follow-up cap is the one a schedule multiplies. At the defaults, a nightly job's worst month is about 30 × 0.50=0.50 = 15 plus the occasional cold rebuild, against recorded runs that cost a few cents each. Watch the `cost_usd` figure in the summary line across a few cycles to find the ceilings that fit. The figure is a client-side estimate rather than billing data. [Track cost and usage(opens in new tab)](https://code.claude.com/docs/en/agent-sdk/cost-tracking) covers the difference. The [`effort` option(opens in new tab)](https://code.claude.com/docs/en/agent-sdk/agent-loop#effort-level) is one more cost lever. The docs recommend `"low"` for agents that only read files, and this reviewer is one.
* **The model**: swap the `MODEL` alias to trade cost against capability. The pin keeps the change deliberate.

Reset the session on a schedule
-------------------------------

A long-lived session gathers context by design. That context also grows cost and can anchor the reviewer on old conclusions. Delete the session file beside the script on a regular schedule, weekly or whenever the repository changes shape, and the next run reviews cold and rebuilds the baseline.

The follow-up's `recalled_findings` count is the operational signal. When the count drops off, the session has degraded and it is time to reset.

When to resume and when to start fresh
--------------------------------------

A scheduled review job resumes the previous run's session, starts fresh each cycle, or starts fresh with the prior findings fed in. The table below maps each choice to the jobs it fits:

| Reach for | When |
| --- | --- |
| A fresh session per invocation | Each unit of work gets judged on its own. A CI reviewer that gates pull requests needs this: no old opinions and no carried context steering the current verdict. |
| A fresh session with the prior findings fed in | The job needs only what the last run reported. A TODO-debt tracker that reports which of last week's items are still open fits this shape: the reply's finding ids carry everything the comparison needs, each cycle judges the code fresh, and no saved session can go stale or missing between cycles. |
| A resumed session | The job compares against everything the last pass saw. A nightly dependency audit that flags only packages added or changed since the last pass checks the full inventory the reviewer read, and most of that inventory never entered the reply. Feeding it forward yourself would mean serializing everything the reviewer observed, which is the work resume saves. |

Clean up
--------

The notebook wrote four files into `demo_repo/`, the two-cycle fixture plus the between-cycle change. The code below removes them after checking that the directory holds the fixture. To run the delta experiment from the answer key first, hold off on this cleanup, and run the sample-repository code again later if you need the files back.

If you also ran the companion script, delete the `.last_review_session` file from its service directory too. The runs also wrote session transcripts under `~/.claude/projects/`. Delete the matching project folder there to remove them.

import shutil

config\_path = REPO\_DIR / "app" / "config.py"

if config\_path.exists() and config\_path.read\_text(encoding="utf-8") == CONFIG\_PY:

shutil.rmtree(REPO\_DIR, ignore\_errors=True)

print("removed", REPO\_DIR.name)

else:

print("left", REPO\_DIR.name, "in place: it does not hold the seeded fixture")

```
removed demo_repo
```

What you learned
----------------

* **Bounding an unattended agent**: `tools` and `allowed_tools` decide what exists and what runs unprompted, and `max_turns` with `max_budget_usd` cap the loop and the spend, so a scheduled run can only misbehave within limits you chose.
* **Proving continuity**: an agent that resumes its previous session remembers what it already found. Make each run prove that by echoing the previous run's findings back in its reply. A broken resume then shows up in the log the moment it happens.
* **Putting the reviewer on a schedule**: a review that runs unattended reports to a program, so its output is exit codes and fixed lines a scheduler can grep. For this reviewer, that means a verdict line that answers for the repository, a completion line that prints only after a successful run, and a non-zero exit that marks every failure.

Learn more
----------

* [Get structured output from agents(opens in new tab)](https://code.claude.com/docs/en/agent-sdk/structured-outputs): the full documentation of the `output_format` schemas and `structured_output` field this recipe's replies used
* [Work with sessions(opens in new tab)](https://code.claude.com/docs/en/agent-sdk/sessions): the session lifecycle beyond the resume this recipe used, including forking a session down two paths
* [Configure permissions(opens in new tab)](https://code.claude.com/docs/en/agent-sdk/permissions): the permission-mode model behind this recipe's `dontAsk`, and the modes built for interactive use
* [Security(opens in new tab)](https://code.claude.com/docs/en/security): Claude Code's security safeguards, including best practices for working with untrusted content
* [Track cost and usage(opens in new tab)](https://code.claude.com/docs/en/agent-sdk/cost-tracking): the cost surface behind `max_budget_usd` and the summary lines' cost figures

Was this page helpful?

[Back to Cookbook](/cookbook/)[View on GitHub](https://github.com/anthropics/claude-cookbooks/blob/main/claude_agent_sdk/scheduled_repository_reviewer/scheduled_repository_reviewer.ipynb)