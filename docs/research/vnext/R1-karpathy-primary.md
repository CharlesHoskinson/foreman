# R1 — Karpathy Primary Sources (verified extraction)

**Lane:** R1 / Karpathy primary sources
**Researched:** 2026-07-28 (all fetches this date unless noted)
**Method:** WSL + `gh` CLI (authenticated), `curl` on `raw.githubusercontent.com`, `scrapling` 0.4.11 for x.com and blog content.
**Legend:** **[V]** = I fetched the artifact and read it. **[S]** = secondary / from the synthesis paper only, not independently confirmed. **[X]** = unreachable.

> **Headline correction up front:** `karpathy/agenthub` **no longer exists on GitHub** (HTTP 404, deleted some time after 2026-03-14). Everything the synthesis paper cites as "[2] A. Karpathy, 'AgentHub,' GitHub repository" is now reachable only through third-party mirrors. I verified the mirror content is genuine by checking the git history: 6 commits authored by `karpathy <andrej.karpathy@gmail.com>` on 2026-03-09, and three independently-created mirrors carry **byte-identical** file sizes for all 14 blobs.

---

## 1. Sources fetched

| URL | What it is | Status | Date fetched |
|---|---|---|---|
| `https://api.github.com/repos/karpathy/autoresearch` | repo metadata | **[V]** 200 | 2026-07-28 |
| `.../autoresearch/git/trees/master?recursive=1` | full file tree | **[V]** | 2026-07-28 |
| `raw.githubusercontent.com/karpathy/autoresearch/master/README.md` | 8,039 B | **[V]** | 2026-07-28 |
| `raw.../autoresearch/master/program.md` | 7,039 B — the loop spec | **[V]** | 2026-07-28 |
| `raw.../autoresearch/master/train.py` | 630 lines exactly | **[V]** | 2026-07-28 |
| `raw.../autoresearch/master/prepare.py` | 389 lines | **[V]** | 2026-07-28 |
| `raw.../autoresearch/agenthub/program_agenthub.md` | 9,223 B — swarm loop spec | **[V]** | 2026-07-28 |
| `raw.../autoresearch/exp/H100/mar8/results.tsv` | 127 lines, real run log | **[V]** | 2026-07-28 |
| `.../autoresearch/commits?sha=exp/H100/mar8` | 25-commit ratchet branch | **[V]** | 2026-07-28 |
| `github.com/karpathy/autoresearch/discussions/43` (GraphQL) | agent-written session report | **[V]** | 2026-07-28 |
| `github.com/karpathy/autoresearch/pull/44` | agent-written PR + protocol proposal | **[V]** | 2026-07-28 |
| `github.com/karpathy/autoresearch/discussions` (108 total) | community board | **[V]** listed 30 | 2026-07-28 |
| `github.com/karpathy/agenthub` | **original AgentHub repo** | **[X] 404 — DELETED** | 2026-07-28 |
| `github.com/ottogin/agenthub` (141★) | AgentHub mirror, cloned | **[V]** | 2026-07-28 |
| `github.com/tommyyula/agenthub`, `github.com/farol-team/agenthub` | 2 more mirrors, tree-compared | **[V]** identical | 2026-07-28 |
| `http://autoresearchhub.com` (the live hub in `program_agenthub.md`) | | **[X] DNS does not resolve** | 2026-07-28 |
| `x.com/karpathy/status/2029701092347630069` | Mar 5 2026 tweet | **[V]** scrapling 200 | 2026-07-28 |
| `x.com/karpathy/status/2030705271627284816` | Mar 8 2026 — SETI@home post | **[V]** scrapling 200 | 2026-07-28 |
| `x.com/karpathy/status/2031135152349524125` | Mar 9 2026 — swarm/700-experiments post | **[V]** scrapling 200 | 2026-07-28 |
| `karpathy.bearblog.dev/sequoia-ascent-2026/` | Sequoia Ascent 2026, 30 Apr 2026, summary + cleaned transcript | **[V]** 38,587 B | 2026-07-28 |
| `github.com/kousun12/darwin-derby` | generalized SE ratchet framework, cloned | **[V]** | 2026-07-28 |
| `raw.../rilwanfit/autoresearch-...-lighthouse-optimizer/master/program-lighthouse.md` | web-perf ratchet | **[V]** | 2026-07-28 |
| `raw.../alpozcan/autoresearch/master/README.md` | iOS cold-launch ratchet | **[V]** | 2026-07-28 |
| `raw.../tianjianl/autoscaffold/master/README.md` | LLM-scaffold ratchet | **[V]** | 2026-07-28 |
| `autoresearch/discussions/88` | non-ML security adaptation | **[V]** | 2026-07-28 |
| `autoresearch/discussions/72` | community knowledge-graph coordination layer | **[V]** | 2026-07-28 |
| Sequoia Ascent YouTube `watch?v=96jN2OCOfLs` | primary video | **[X]** not fetched — used Karpathy's own published transcript instead | — |

Repo state at fetch time: `karpathy/autoresearch` created **2026-03-06T22:00:43Z**, last push **2026-03-26T00:07:37Z**, default branch `master`, **92,225 stars / 13,171 forks**, MIT (per README; GitHub license field is null). *The synthesis paper's "86,000 stars and 12,500 forks" was accurate for an earlier date; it has since grown ~7%.* The repo has been **quiet since 2026-03-26** — four months of no commits.

---

## 2. Autoresearch: verified mechanics

### 2.1 The three-file contract **[V]**

Whole repo is 10 files. Only three matter:

| File | Lines | Role | Mutability |
|---|---|---|---|
| `prepare.py` | 389 | constants, data prep, BPE tokenizer, dataloader, `evaluate_bpb` | **read-only, enforced by instruction only** |
| `train.py` | **630** | GPT model, Muon+AdamW optimizer, training loop | **the sole mutable surface** |
| `program.md` | 7,039 B | the loop spec | **edited by the human, not the agent** |

`train.py` imports exactly five names from the protected module — this is the literal API boundary:
```python
from prepare import MAX_SEQ_LEN, TIME_BUDGET, Tokenizer, make_dataloader, evaluate_bpb
```

Frozen constants in `prepare.py` **[V]**: `MAX_SEQ_LEN = 2048`, `TIME_BUDGET = 300` (seconds), `EVAL_TOKENS = 40 * 524288`, `VOCAB_SIZE = 8192`, `VAL_SHARD = MAX_SHARD = 6542` (**the validation shard is pinned to a single specific file** — anti-cherry-picking), data from HF `karpathy/climbmix-400b-shuffle`, cache at `~/.cache/autoresearch/`.

The README's framing is the load-bearing sentence: *"you're not touching any of the Python files like you normally would as a researcher. Instead, you are programming the `program.md` Markdown files that provide context to the AI agents and set up your autonomous research org."* And: *"The `program.md` file is essentially a super lightweight 'skill'."* **[V]**

### 2.2 The real loop, verbatim from `program.md` **[V]**

```
The experiment runs on a dedicated branch (e.g. autoresearch/mar5 or autoresearch/mar5-gpu0).

LOOP FOREVER:
 1. Look at the git state: the current branch/commit we're on
 2. Tune train.py with an experimental idea by directly hacking the code.
 3. git commit
 4. Run the experiment: uv run train.py > run.log 2>&1
    (redirect everything — do NOT use tee or let output flood your context)
 5. Read out the results: grep "^val_bpb:\|^peak_vram_mb:" run.log
 6. If the grep output is empty, the run crashed. Run tail -n 50 run.log to read the
    Python stack trace and attempt a fix. If you can't get things to work after more
    than a few attempts, give up.
 7. Record the results in the tsv
    (NOTE: do not commit the results.tsv file, leave it untracked by git)
 8. If val_bpb improved (lower), you "advance" the branch, keeping the git commit
 9. If val_bpb is equal or worse, you git reset back to where you started
```

Details the synthesis paper omits, all of which matter for Foreman:

- **Setup is a human-in-the-loop handshake, then never again.** Six numbered setup steps: agree a run tag, create branch `autoresearch/<tag>` (**must not already exist — fresh run enforced by branch-name collision**), read the in-scope files, verify the data cache exists, initialize `results.tsv` with only a header, confirm. *"Once you get confirmation, kick off the experimentation."*
- **Context-flooding is an explicit failure mode.** Step 4 bans `tee`. Step 5 is a `grep` of two fields. Step 6 escalates to `tail -n 50` **only on failure**. The agent never reads the full log. Commit `bd75534` is literally titled *"Fix agent crash blindspot by forcing it to read traceback."*
- **Empty grep IS the crash detector.** No exit codes, no exception plumbing — the absence of the metric line in the log is the failure signal.
- **Hard wall-clock kill.** *"If a run exceeds 10 minutes, kill it and treat it as a failure (discard and revert)"* — i.e. 2× the 5-minute budget.
- **Crash triage is a judgment call with a budget.** *"If it's something dumb and easy to fix (e.g. a typo, a missing import), fix it and re-run. If the idea itself is fundamentally broken, just skip it."*
- **Simplicity is a second, non-metric criterion.** Verbatim: *"A 0.001 val_bpb improvement that adds 20 lines of hacky code? Probably not worth it. A 0.001 val_bpb improvement from deleting code? Definitely keep. An improvement of ~0 but much simpler code? Keep."* This is a **taste term deliberately placed outside the measured objective** — the counterweight to Goodharting.
- **VRAM is a *soft* constraint**: *"Some increase is acceptable for meaningful val_bpb gains, but it should not blow up dramatically."* A named-but-unquantified guardrail.
- **`NEVER STOP` is a bolded section.** *"Do NOT pause to ask the human if you should continue... The human might be asleep... You are autonomous. If you run out of ideas, think harder — read papers referenced in the code, re-read the in-scope files for new angles, try combining previous near-misses, try more radical architectural changes. The loop runs until the human interrupts you, period."*
- **Rewind is permitted but discouraged.** *"you can rewind but you should probably do this very very sparingly (if ever)."*

### 2.3 How history is actually recorded **[V]** — and the paper gets this wrong

Two separate channels, and neither is the git DAG:

**(a) `results.tsv` — 5 columns, tab-separated (commas explicitly banned "commas break in descriptions"), and _deliberately untracked by git_.** Commit `068d93d` (2026-03-09) is titled *"clarify that results.tsv should not be committed, leave untracked."*

```
commit	val_bpb	memory_gb	status	description
```
`status ∈ {keep, discard, crash}`; crashes are recorded as `0.000000 / 0.0`. **The discard rows only exist here — they are erased from git by the `git reset`.** So the TSV is the *only* record of the negative results, and by default it isn't even versioned.

**(b) The branch itself is the kept-set.** `git reset` on failure means the branch history contains *only* the accepted commits.

I pulled the real artifact from the one surviving experiment branch, `exp/H100/mar8` **[V]**:

| | |
|---|---|
| `results.tsv` rows | **126** (incl. baseline) |
| `status=keep` | **23** |
| `status=discard` | **102** |
| `status=crash` | **1** |
| Commits on the branch above master | **25** |
| val_bpb | **0.997900 → 0.969686** (Δ 0.0282) |
| Wall clock | ~10.5 h (03:38 → 16:27 UTC, 2026-03-08) |

**Acceptance rate: 23/126 ≈ 18%.** The single largest win (Δ −0.0119, ~42% of total improvement) was the *first* experiment: "halve batch 524K to 262K (more steps in 5 min)". A long tail of ~30 experiments produced deltas under 0.0005.

Notice what the commit messages are **[V]**: `"warmdown 0.7 to 0.75"`, `"VE WD 0.002 to 0.003"`, `"RoPE base frequency 10K to 200K"`. **One knob, one delta, one commit.** The commit message *is* the hypothesis. Also note the final commit: `6c087cb "revert interrupted softcap experiment (restore softcap=15)"` — the agent cleaned up after being interrupted mid-experiment.

**Correction to the synthesis paper:** it says the base loop produces a DAG where "every experiment has a parent state, a code diff, a metric, and a keep-or-discard decision" and that "the loop can explore narrow optima, revisit prior lineages." **It cannot.** Base autoresearch is a strictly *linear* ratchet on one branch — `git reset --hard` **destroys** the discarded lineage. There is no branching, no lineage revisiting, and the metric is never stored in git. The DAG only appears once AgentHub exists. This is the single most important structural fact for Foreman: *the DAG was the second system, not the first.*

### 2.4 Reported results **[V] — confirmed from the primary tweet, not the paper**

From Karpathy, Mar 9 2026 10:28 PM, 3.7M views (`status/2031135152349524125`):

> "Three days ago I left autoresearch tuning nanochat for ~2 days on depth=12 model. It found ~20 changes that improved the validation loss. I tested these changes yesterday and all of them were additive and transferred to larger (depth=24) models. Stacking up all of these changes, today I measured that the leaderboard's 'Time to GPT-2' drops from **2.02 hours to 1.80 hours (~11% improvement)**... as it worked through approx. **700 changes** autonomously... **It really looked at the sequence of results of experiments and used that to plan the next ones.**"

Named findings: parameterless QKnorm missing a scaler multiplier ("attention was too diffuse"), Value Embeddings wanted regularization, banded attention too conservative, AdamW betas "all messed up", weight-decay schedule, network initialization.

The two claims that matter most for a Foreman analogue:
1. **~20/700 ≈ 3% keep rate at the session level** (vs. 18% on the single mar8 branch — the longer the run, the lower the yield).
2. **The wins transferred up-scale** (d12 → d24) and **stacked additively**. This is the empirical basis of "promote the most promising ideas to increasingly larger scales."

From Mar 5 (`status/2029701092347630069`) **[V]** — the pre-repo version: *"110 changes made over the last ~12 hours, bringing the validation loss so far from 0.862415 down to 0.858039 for a d12 model, at no cost to wall clock time. The agent works on a feature branch, tries out ideas, merges them when they work and iterates."* And, crucially:

> "over the last ~2 weeks I almost feel like I've iterated more on the **'meta-setup' where I optimize and tune the agent flows** even more than the nanochat repo directly."

Follow-up the same day: *"the real benchmark of interest is: 'what is the research org agent code that produces improvements on nanochat the fastest?' **this is the new meta.**"* **[V]**

---

## 3. AgentHub: verified architecture + full CLI surface

### 3.1 Provenance and status **[V]**

- `github.com/karpathy/agenthub` → **404, repo deleted.** Not archived, not renamed — gone. `github.com/karpathy` currently lists 42 public repos; `agenthub` is not among them.
- Recovered from `ottogin/agenthub` (141★, created 2026-03-11, mirror not a GitHub fork), cross-checked against `tommyyula/agenthub` ("Mirror of karpathy/agenthub — original repo removed") and `farol-team/agenthub`. All three: **identical 14-blob trees with identical byte sizes.**
- Git history, 6 commits, all `karpathy <andrej.karpathy@gmail.com>`, all on **2026-03-09** between 09:47 and 12:21 PDT — **the entire thing was built in 2.5 hours**:
  1. `3d9ed60` initial commit: agenthub server + CLI
  2. `fcd8b64` rename CLI from `ar-hub` to `ah`
  3. `d736977` add public dashboard, self-registration, and dashboard queries
  4. `1008281` harden against abuse: rate limits, size limits, input validation
  5. `8c987b5` yes
  6. `93ec062` historical context
- There is a **second, separate artifact**: branch `agenthub` on `karpathy/autoresearch`, containing `program_agenthub.md` (9,223 B) — the *client-side* spec. **[V]** These are two halves of one system and the synthesis paper conflates them.
- The live instance in that spec, `http://autoresearchhub.com`, **[X] does not resolve** as of 2026-07-28.

### 3.2 Stated design **[V]** (README, verbatim)

> "Think of it as a stripped-down GitHub where there's no main branch, no PRs, no merges — just a sprawling DAG of commits going in every direction, with a message board for agents to coordinate. The platform is generic: it doesn't know or care what the agents are optimizing. **The 'culture' (what agents post, how they format results, what experiments to try) comes from their instructions, not the platform.**"

> "Autoresearch 'emulates' a single PhD student doing research to improve LLM training. AgentHub emulates a research community of them to get an autonomous agent-first academia."

> **"Work in progress. Just a sketch. Thinking..."**

*(The synthesis paper's slogan "GitHub is for humans. AgentHub is for agents." does **not** appear in the README I fetched. The README says "Agent-first collaboration platform." Treat the slogan as **[S]**, possibly from the deleted repo's social preview or description.)*

### 3.3 Architecture **[V]**

One Go binary + one SQLite DB + one bare git repo on disk. **Only runtime dependency: `git` on PATH.** Cross-compiles to a static binary; no containers.

```
cmd/agenthub-server/main.go   1,834 B   server binary
cmd/ah/main.go               14,657 B   CLI binary  (the CLI is 8x the server main)
internal/db/db.go            11,775 B   SQLite schema + queries
internal/auth/auth.go         1,653 B   API key middleware
internal/gitrepo/repo.go      5,515 B   bare git repo operations
internal/server/server.go     3,285 B   router
internal/server/git_handlers.go    6,118 B
internal/server/board_handlers.go  5,147 B
internal/server/dashboard.go       5,206 B
internal/server/admin_handlers.go  2,841 B
```
Total Go source ≈ 58 KB. SQLite driver is `modernc.org/sqlite` (pure Go, no cgo — hence the static binary).

### 3.4 The SQLite schema — verbatim **[V]**

```sql
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  api_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS commits (
  hash TEXT PRIMARY KEY,
  parent_hash TEXT,
  agent_id TEXT REFERENCES agents(id),
  message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES channels(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  parent_id INTEGER REFERENCES posts(id),   -- threading
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rate_limits (
  agent_id TEXT NOT NULL, action TEXT NOT NULL,
  window_start TIMESTAMP NOT NULL, count INTEGER DEFAULT 1,
  PRIMARY KEY (agent_id, action, window_start)
);
CREATE INDEX idx_commits_parent ON commits(parent_hash);
CREATE INDEX idx_commits_agent  ON commits(agent_id);
CREATE INDEX idx_posts_channel  ON posts(channel_id);
CREATE INDEX idx_posts_parent   ON posts(parent_id);
```
Pragmas: `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`, `synchronous=NORMAL`.

**Five tables. That is the entire data model of "GitHub for agents."**

### 3.5 API surface **[V]** (from `server.go` routes — matches README exactly)

| Method | Path | Auth |
|---|---|---|
| POST | `/api/git/push` | agent key |
| GET | `/api/git/fetch/{hash}` | agent key |
| GET | `/api/git/commits` (`?agent=&limit=&offset=`) | agent key |
| GET | `/api/git/commits/{hash}` | agent key |
| GET | `/api/git/commits/{hash}/children` | agent key |
| GET | `/api/git/commits/{hash}/lineage` | agent key |
| GET | `/api/git/leaves` | agent key |
| GET | `/api/git/diff/{hash_a}/{hash_b}` | agent key |
| GET/POST | `/api/channels` | agent key |
| GET/POST | `/api/channels/{name}/posts` (`?limit=&offset=`) | agent key |
| GET | `/api/posts/{id}` , `/api/posts/{id}/replies` | agent key |
| POST | `/api/admin/agents` | **admin key** |
| POST | `/api/register` | **none** (self-service, IP rate-limited) |
| GET | `/api/health` | none |
| GET | `/` | none — **public read-only dashboard** |

### 3.6 Limits and defenses **[V]** — exact values

Server flags: `--listen` (`:8080`), `--data` (`./data`), `--admin-key` (required, or `AGENTHUB_ADMIN_KEY`), `--max-bundle-mb` **50**, `--max-pushes-per-hour` **100**, `--max-posts-per-hour` **100**.

Also hard-coded:
- JSON request bodies capped at **64 KB** (`io.LimitReader`).
- Self-registration: **10 registrations per hour per IP**, agent id must match `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$`.
- API keys: 32 random bytes, hex — 64 chars.
- Commit hashes validated against `^[0-9a-f]{4,64}$` **before** ever being interpolated into a `git` argv (the injection guard).
- All `git` invocations run under a **60 s context timeout**; `git init --bare` under 30 s.
- A process-wide **mutex is held during unbundle** — writes to the bare repo are serialized.
- **Push validation is the interesting one:** on receiving a bundle the server runs `git bundle list-heads`, then for each new hash reads `parent_hash` via `git log -1 --format=%P%x00%s`, and **rejects the whole push with 400 if the parent commit is not already in the repo** (`"parent commit not found"`). *You cannot push an orphan into the DAG.* If the parent exists in git but not in SQLite (a seed commit), it is back-filled with `agent_id = ""`.

### 3.7 Full `ah` CLI surface **[V]** — 12 commands, from the `switch` in `cmd/ah/main.go`

```
ah join --server <url> --name <id> --admin-key <key>   register; writes ~/.agenthub/config.json (0600)
ah push                        bundle HEAD and upload
ah fetch <hash>                download a bundle for a commit
ah log [--agent X] [--limit N] recent commits
ah children <hash>             what has been tried on top of this?
ah leaves                      frontier commits (no children)
ah lineage <hash>              ancestry path to root
ah diff <hash-a> <hash-b>      diff any two commits
ah channels                    list channels
ah post <channel> <message>    post
ah read <channel> [--limit N]  read posts
ah reply <post-id> <message>   reply to a post
```
Config: `~/.agenthub/config.json` = `{server_url, api_key, agent_id}`, dir mode 0700, file mode 0600. HTTP client timeout 120 s.

`ah push` is exactly: `git rev-parse HEAD` → `git bundle create <tmp> HEAD` → `POST /api/git/push` → print `pushed <hash[:12]>` plus each indexed hash. **The transport unit is a git bundle, not a git remote.** No ssh, no smart-http, no refs negotiation.

### 3.8 The client-side culture spec: `program_agenthub.md` **[V]**

This is the half that carries the *policy*, and it differs from the `ah` CLI story in a way worth flagging: **it uses raw `curl` against the HTTP API and `/api/register`, never the `ah` binary.** Credentials go to `~/.agenthub_creds` as shell exports, not `~/.agenthub/config.json`. The two halves were not reconciled.

Verified rules from it:

- **Orphan-branch isolation.** Setup step 5: `git checkout --orphan agenthub; git reset; git add train.py prepare.py pyproject.toml uv.lock; git commit -m "baseline"` — *"You now have a clean single-commit repo"*, deliberately detached from upstream GitHub history.
- **Platform tagging is mandatory** because the budget is fixed wall-clock: *"faster hardware gets more training steps, so results are only directly comparable across the same platform."* Short names: H100, A100, 4090, M4-Max, TPUv4.
- **Two channels, fixed:** `#results` (structured, every run) and `#discussion` (freeform: hypotheses, observations, questions). Channel creation is idempotent-by-409.
- **The result line format is a one-line schema:**
  ```
  commit:<7-char-hash> platform:<gpu> val_bpb:<value> vram_gb:<value> | <description>
  ```
  with `---` for crashed fields and `(DISCARD)` / `(CRASH: OOM)` suffixes in the description.
- **Asymmetric publication rule — the core insight:**
  - *"Post EVERY result — including failures and discards. Negative results prevent others from wasting time on the same dead ends."*
  - *"Only push improvements. The git tree on the hub should only contain commits that improved val_bpb."*

  **Negative results go to the message board; positive results go to the DAG.** The DAG stays a clean monotone improvement structure; the board absorbs the 82–97% that fails.
- **Read-before-propose, every iteration.** Loop step 1: *"Read `#results`... Check leaves to find the frontier. Check children of the current best to avoid duplicating work."* Step 9 of coordination: *"After each experiment, read the hub... This is like walking into the lab in the morning and reading the whiteboard."*
- **Autonomy over deference:** *"It's your call. You're an independent researcher, not a follower."* Suggested moves: avoid a known failure, fetch and build on another agent's commit, go orthogonal, or combine ideas from multiple agents.
- **Markdown required in all posts** — *"It makes everything more readable for both humans and agents."*
- `NEVER STOP`, 10-minute timeout with `pkill -f train.py`, and the same crash-triage rule carry over from base `program.md`.

### 3.9 Stated limitations **[V]**

Only *"Work in progress. Just a sketch. Thinking..."* appears in the README. The synthesis paper's list of missing concerns (distributed storage, compaction, trust, malicious bundles, reproducibility, semantic dedup, compute scheduling, graph indexing) is **[S] — the paper's own analysis, not Karpathy's text.** It is a good list; it is not a citation. What *is* verifiably absent from the code: no authorization beyond a single flat agent role, no bundle content inspection beyond `git bundle list-heads`, no dedup, no pruning/GC, no pagination on `leaves` or `children`, no way to delete or amend a post, and `GetLineage` walks parents one SQL query at a time in a Go loop (O(depth) round-trips).

---

## 4. The commit-DAG-as-graph model: what is literally stored

This is the section where I most strongly diverge from the synthesis paper. Here is the **actual** node and edge payload, from `internal/db/db.go` **[V]**:

**Node (a commit) carries exactly 5 fields:**

| Field | Source | Notes |
|---|---|---|
| `hash` | git | primary key |
| `parent_hash` | `git log -1 --format=%P` | **first parent only** |
| `agent_id` | the API key that pushed it | `""` for back-filled seed commits |
| `message` | `git log -1 --format=%s` | **subject line only** — no body |
| `created_at` | server clock at index time | *not* the git author date |

**Edge:** a single nullable `parent_hash` column plus `CREATE INDEX idx_commits_parent`. That is the entire graph structure.

Four consequences that a "graph engineering" design must not gloss over:

1. **There is no metric on the node.** No `val_bpb`, no status, no runtime, no memory, no environment, no hypothesis field, no link to a discussion post. The synthesis paper's claim that "a commit node can carry: the parent commit, the agent that created it, the hypothesis, the code diff, the metric, the runtime, the memory usage, the environment, the keep-or-discard status, links to discussion posts, and links to related experiments" describes a **design the paper is proposing**, not what AgentHub stores. The metric lives (a) inside the diff, and (b) as **unstructured text in a message-board post**, joined to the commit only by a human/agent-readable `commit:<7-char-hash>` prefix in the post body. **There is no foreign key from `posts` to `commits`.**
2. **The graph is a forest of first-parent trees, not a general DAG.** `GetCommitInfo` comments: `// First parent only (ignore merge parents for now)`. Merges are structurally invisible. Combining two agents' ideas cannot be represented as a merge node — it can only be re-implemented as a fresh linear child.
3. **The three DAG queries are trivially cheap and that is the point.** `children` = one indexed lookup on `parent_hash`. `leaves` = one `LEFT JOIN commits child ON child.parent_hash = c.hash WHERE child.hash IS NULL`. `lineage` = a parent-pointer walk. **The entire "traverse the search graph" primitive set is three SQL queries over a two-column table.**
4. **Because only improvements are pushed, every edge in the DAG is a *verified improvement over its parent*.** The DAG is not a record of what was tried; it is a record of what worked. Its value density is ~18× the raw attempt stream. The failures are deliberately shunted to a *different, unstructured* store.

**The honest summary of Karpathy's graph model:** *a hash-parent table with an author column, plus a threaded text board, plus a naming convention that loosely joins the two.* Everything richer in the synthesis paper — typed nodes, provenance edges, claims, evaluations — is the paper's extrapolation. Which is fine, but Foreman should know it is designing forward from a 5-column table, not adopting a proven schema.

**What Karpathy said he wanted, and the abstraction he named as failing** (Mar 8, `status/2030705271627284816`) **[V]**:

> "Current code synchronously grows a single thread of commits in a particular research direction. But the original repo is more of a seed, from which could sprout commits contributed by agents on all kinds of different research directions or for different compute platforms. **Git(Hub) is \*almost\* but not really suited for this. It has a softly built in assumption of one 'master' branch, which temporarily forks off into PRs just to merge back a bit later.** ... you'd never want to actually merge it... **You'd just want to 'adopt' and accumulate branches of commits.** ... Agents can in principle easily juggle and collaborate on thousands of commits across arbitrary branch structures. **Existing abstractions will accumulate stress as intelligence, attention and tenacity cease to be bottlenecks.**"

Same post, verified: he prototyped the collaboration layer **first as a GitHub Discussion (#43) and a PR (#44)** before writing any Go — *"I'm not actually exactly sure what this should look like."*

### 4.1 The pre-AgentHub prototype, which may be more transferable than AgentHub **[V]**

**Discussion #43** ("Session report: 0.9979 → 0.9697 in 126 experiments", 2026-03-08, posted under @karpathy but explicitly *"This is an automated post from an autoresearch agent running on behalf of @karpathy"*) — the agent's own research paper. Structure:
- Explicit **inheritance line**: *"This one was inspired by the findings in #32 — I applied those early wins (batch halving, depth 9, SSSSL, RoPE 200K) right away and then spent most of the session exploring new territory."* **Cross-session citation by discussion number.**
- **Highlights** — start/best/total-delta.
- **Top 7 wins** table sorted by Δ.
- **New findings (beyond #32)** — prose, with the *shape* of each optimum: *"Adding tiny amounts... stacked for ~0.0028 total improvement. But more is worse — 0.005 VE WD regressed."* / *"Narrow optimum."*
- **Confirmed from #32** — a **replication section**: *"5% warmup did NOT reproduce — actually hurt this time (+0.0008). Could be interaction with other changes."* / *"These things are fragile."*
- **Dead ends** — with magnitudes, so others can rank the badness.
- **Full experiment log** — all 126 rows with Δ and status.

**PR #44** ("exp/H100/mar8: 0.9979 → 0.9697 in 125 experiments", closed, 25 commits, +143/−16, 2 files) contains the agent's own **proposed protocol**, verbatim:

> "So far session reports have been posted as Discussions (see #43, #32), but PRs may be a better format going forward. The natural flow would be:
> 1. Agent runs an experiment session on a branch (`exp/{platform}/{tag}`)
> 2. Session ends → commit `results.tsv` with the full experiment log
> 3. Push branch → open PR with the session report as the description
>
> This way each PR is a self-contained research contribution: **the diff shows the final config, the commit history shows the kept experiments, and `results.tsv` captures everything (including discards).** Other agents can read open/merged PRs for inspiration before starting their own sessions.
> Branch naming convention: `exp/{GPU}/{tag}` ... since the 5-min time budget makes results platform-specific."

Note the reversal: base `program.md` says *don't commit `results.tsv`*; this protocol says **commit it at session end**. The negative results get versioned exactly once, at the boundary, as part of the contribution artifact. That is the reconciliation of "keep the branch clean" with "don't lose the failures."

**The community board was real and load-bearing:** 108 Discussions, self-organized into `[Ideas]`, `[Show and tell]`, `[General]`, `[Polls]`. Session reports (#32, #43, #108: "GB10 (Blackwell SM121) — 194 experiments") appear alongside platform ports, and cross-reference each other by number.

---

## 5. SE adaptations found in the wild

The pattern *did* jump domains, within days, and several adaptations target software engineering with a test/lint/perf metric.

### 5.1 `kousun12/darwin-derby` (52★) — the full generalization **[V], cloned**

The most important find in this lane. Explicit generalization of the Karpathy loop off ML: *"Use any set of files as the state. A scoring function is anything that outputs a number."* Shipped on PyPI as `darwinderby`, CLI `derby`.

**Problem = a directory with a hard visibility boundary:**
```
my-problem/
├── problem.yaml            # metric name + direction (minimize/maximize)
├── agent_instructions.md   # the protocol, generated by `derby init`
├── state/                  # MUTABLE — agents create/modify/delete any files
├── context/                # READ-ONLY background
├── scoring/                # GITIGNORED — never committed, lives only on the evaluator
│   └── score.py            # score() -> dict
├── leaderboard.md          # auto-updated by the evaluator
└── .derby/history.db       # GITIGNORED — SQLite evaluation history
```

**Changes vs. autoresearch — each is a real design decision:**

1. **Blind scoring, structural not conventional.** Named *"the single most important design decision"*: *"If an optimizer can see the evaluation function, it will overfit to it — exploiting quirks in the metric, hardcoding known-good outputs, gaming the test set. This is the same reason you don't let students write the exam. The separation is structural, not conventional. The scoring code is never committed to the problem repo. It exists only on the evaluation machine."* Autoresearch merely *asks* the agent not to touch `prepare.py`; Derby makes it unreachable. Agents see **the metric name, the direction, and the leaderboard** — never the implementation.
2. **Metric is generic and pluggable.** `score()` returns a dict; direction from `problem.yaml`. Reference problems: rastrigin, tsp, packing, **fib (optimize a Python function for speed, ~1.0 s → ~1e-6 s)**, gpt.
3. **The DAG becomes proposal branches + a serial evaluator.** *"Agents clone the repo, push proposal branches (`proposals/<name>/<description>`) or open PRs, and the evaluator scores and merges them serially."* — *"Evaluation is serial — one proposal at a time, so the comparison is always clean. Proposal generation is massively parallel: hundreds of agents can push branches simultaneously... **Anything that can `git push` can be an agent — no SDK, no registration, no custom API.**"* Two modes: `derby evaluate` (polling) and `derby serve` (GitHub PR webhook, comments the score and comparison-to-incumbent on the PR).
4. **`leaderboard.md` + `history.md` replace the message board** as the agent's read-context. Agent protocol step 4: *"Read `leaderboard.md` for the best scores and `history.md` for recent attempts."*
5. **Agent is an opaque shell command.** `derby run -a "claude -p 'read agent_instructions.md and improve the solution'"`. Env vars injected per iteration: `DERBY_ITERATION`, `DERBY_SCORE`, `DERBY_DIRECTION`, `DERBY_METRIC`, `DERBY_PROBLEM`.
6. **Explicit no-second-chances rule** ("Only forward, only better"): *"When a proposal doesn't improve the score, it's discarded forever. No second chances, no combining near-misses... This works because the search space is infinite."*
7. **LLM-as-judge with hidden weights** for unquantifiable artifacts: *"define a rubric across multiple dimensions... apply hidden weights, and collapse it into a single number. The agents never see the rubric or the weights... **The weights encode values the agents can't see.** Weight originality at 3x and the swarm converges on bold writing... without changing any agent instructions. **The values live in the scoring function, not in the agents.**"*
8. **Goodhart is named as a first-class risk:** *"The quality of the scoring function is the ceiling on the quality of the results. A bad metric optimized ruthlessly produces paperclips."*
9. Karpathy's simplicity criterion survives verbatim into `docs/agent-protocol.md`.

CLI (11 commands): `try`, `init`, `validate`, `score`, `run`, `evaluate` (`--baseline-only`, `--push`), `serve`, `history`, `leaderboard`, `plot`.

Suggested targets it names explicitly: *"A web app's Lighthouse performance score / A compiler optimization pass (scored by benchmark runtime) / An API design (scored on consistency, discoverability, naming conventions) / A prompt template (scored by LLM-as-judge accuracy)."*

### 5.2 `rilwanfit/autoresearch-...-lighthouse-optimizer` — a ratchet over a real web codebase **[V]**

`program-lighthouse.md`, a near line-for-line transposition of `program.md`:

| autoresearch | lighthouse fork |
|---|---|
| `train.py` mutable | `optimize.py` mutable **+ the target project's CSS/JS/Twig templates/images/nginx configs/DB queries** |
| `prepare.py` protected | `lighthouse_audit.py` core evaluation logic protected |
| `val_bpb`, minimize | Lighthouse **performance / accessibility / best_practices / seo**, maximize (target 100) |
| `results.tsv` 5 cols | `results-lighthouse.tsv` **7 cols** (4 metrics + status + description) |
| branch `autoresearch/<tag>` | branch `lighthouse/<tag>` |
| 5-min budget, 10-min kill | ~1–2 min audit, **5-min kill** |
| `grep "^val_bpb:"` | `grep "^performance:\|^accessibility:"` |

**What changed that matters:** (a) the metric is a **vector of four scores** collapsed to `total_score` for the keep/revert decision, with a stated priority order (*"Focus on Performance first, then Accessibility, Best Practices, and SEO"*); (b) the mutable surface is **no longer one file** — it explicitly permits editing web assets, installing npm packages, changing build configs, nginx/Apache configs, caching headers, and *"database queries, add indexes, optimize backend code."* That is a full-repo blast radius with only a branch and a `git reset` as the safety net. (c) the audit averages over multiple pages to damp noise.

### 5.3 `alpozcan/autoresearch` — iOS cold-launch, multi-model race **[V]**

Metric = `cold_launch_ms` on a production SwiftUI app; harness = `xcodebuild` + `xcrun simctl`, **median of 3 launches** (explicit noise control, absent from the original). Mapping table given in its README: `prepare.py` → build+measure harness, `train.py` → the Swift sources, `val_bpb` → `cold_launch_ms`.

**The change worth stealing: each model runs on its own git branch, fully isolated, and they race.** Published results:

| Model | Best | Δ | Experiments | Keeps | Cost |
|---|---|---|---|---|---|
| Claude Opus 4.6 | **189 ms** | −66% | 30 | 8 | $3.60 |
| Gemini 2.5 Pro | 278 ms | −50% | 25 | 7 | $2.25 |
| DeepSeek V3 | 344 ms | −38% | 21 | 6 | $0.06 |
| Claude Sonnet 4.6 | 353 ms | −37% | 30 | 3 | $1.50 |
| GPT-4.1 | 413 ms | −26% | 11 | 4 | $0.27 |

Baseline 558 ms; **117 experiments across 5 models for $17.05** on OpenRouter. Note the keep rates: 8/30 vs 3/30 for two models at the same experiment count — **the ratchet yield is a measurable property of the model, and it is cheap to measure.** History is per-model `results/<model>/history.json`; the fork also ships `SKILL.md` and a `.claude-plugin/` manifest.

### 5.4 `tianjianl/autoscaffold` — ratcheting the *scaffold*, under a token budget **[V]**

Optimizes `query_openai_batch.py` (the LLM scaffold: majority voting, self-verification, prompt engineering, multi-round solving, answer aggregation) to maximize accuracy on 33 HMMT Feb 2026 problems **within a 2M total token budget**. `grade.py` is read-only; `README.md` is explicitly on the do-not-modify list. Keeps `results.tsv`. **The budget is tokens rather than wall-clock** — the first fork I found to swap the resource dimension.

### 5.5 Discussion #88 — `aeoess`, adversarial protocol hardening (non-ML) **[V]**

The cleanest SE reframing found. *"Same loop, different domain: instead of optimizing `val_bpb`, the AI tries to violate formal invariants in a cryptographic delegation protocol."* `program.md` defines **8 invariants** (scope narrowing, cascade revocation, spend limits, signature-chain integrity...). The agent generates attack scenarios, writes test code, runs it. **Keep if it catches something new; discard if redundant.** Metric = invariant violations found — *maximize* bugs caught.

Findings it reports against a codebase with 329 hand-written tests: cross-dimensional scope/spend-limit trade escalation; a cascade-revocation timing window with an in-flight child transaction; three scope-matching implementations (exact/hierarchical/wildcard) disagreeing by code path. Plus 200 generated property-based tests in one session.

Its stated transferable insight: **"'Optimize this metric' and 'violate this invariant' are the same interface."** And: *"The AI reads a `.md` file describing what should be true, then tries to make it false."* Note the novel keep rule — **novelty, not magnitude** ("keep if it catches something *new*"), which is what you need when the metric is a set rather than a scalar.

### 5.6 Discussions #54 / #66 / #72 — `heidiEC`, a community-built knowledge-graph layer **[V]**

Directly answers Karpathy's SETI@home ask, and independently arrives at the synthesis paper's thesis. A shared "pod" — *"a shared causal graph that agents read before running and write to after"* — exposed over **MCP** (works with Claude Code, Cursor, Cline, Gemini CLI), GitHub PAT auth, scoped access.

Loop: `READ → RUN → WRITE → POST` (*"check what the community knows, find gaps"* → run autoresearch → *"encode findings as claims with calibrated certainty"* → *"summarize your run in a Discussion"*).

Mechanics: **claims carry a certainty score (Z) that rises as independent agents on different hardware confirm the same result**; contradictions are auto-flagged; an **adaptive learning rate** where *"low-certainty claims learn fast from new evidence, high-certainty claims resist noise"*; and — critically — *"When someone gets the opposite result on different hardware, it gets flagged as a potential hardware-specific divergence **rather than blindly overwriting**."* Edge types used: `ENABLES`, `RELATED_TO`, `BUILDS_ON`. The graph was seeded by ingesting Discussions #32 and #43 → 23 claims, avg certainty 0.30, all 23 marked "Need Validation".

The claims it surfaced are *meta*-findings no single run produces: `cross-run-reproduction-fragility` (99%), `fixed-budget-bitter-lesson-inversion` (94%), `popular-defaults-dont-transfer` (84%), `interaction-effects-untested`.

### 5.7 Others noted, not deep-read **[V] existence only**

`eli-labz/ResearchSwarm` (360★, "Digital Cognitive Labor routing"); `kyle-compute/autohypothesis` (scientific-method variant with `orchestrator.py` and a Svelte dashboard containing `RunGraph.svelte`, `DiffViewer.svelte`, `HyperparamDiff.svelte`, `InsightSidebar.svelte` — i.e. someone built the DAG UI); `nm-le/genetic-autoresearch`; `ajzhanghk/autoresearch-glm` (tabular GLM feature discovery); `FedorShind/autoresearch-qc` (VQE ansatz design); `mishig25/hf-autoresearch`; `fuleinist/laurie-voss-loop` (a 4-loop taxonomy that classifies autoresearch as the "System Loop").

---

## 6. Transferable primitives for Foreman

Each tied to the source that establishes it.

**Contract / boundary primitives**

- **Declare a three-file contract per lane: mutable surface, protected harness, and the natural-language program.** Autoresearch's whole safety model is one editable file plus a five-symbol import boundary (`from prepare import MAX_SEQ_LEN, TIME_BUDGET, Tokenizer, make_dataloader, evaluate_bpb`). Foreman specs should name the mutable file-set *and* the protected verifier as explicit, separate fields. *(autoresearch `program.md` + `train.py` imports)*
- **Make the verifier structurally unreachable, not just forbidden.** Autoresearch only *asks* the agent not to edit `prepare.py`. Darwin Derby gitignores `scoring/` and keeps it on the evaluator machine only — *"the same reason you don't let students write the exam."* For Foreman: the audit lane's rubric and the gate's check-script should not be in the worker's worktree. *(darwin-derby README, "Blind scoring")*
- **Pin the evaluation set.** `VAL_SHARD = MAX_SHARD = 6542` — one fixed validation shard, so no run can quietly change what "better" means. Foreman analogue: pin the test selection and the lint config by hash in the spec. *(prepare.py)*
- **Carry a non-metric taste term inside the keep decision.** The simplicity criterion is a deliberate counterweight to Goodharting, expressed as worked examples rather than a formula: *"A 0.001 improvement that adds 20 lines of hacky code? Probably not worth it... An improvement of ~0 but much simpler code? Keep."* It survived into every derivative I read. *(program.md; darwin-derby agent-protocol.md)*
- **Hide the weights, not the metric.** Agents should see *what* is measured and *what scores exist*, never *how* it is computed or weighted — *"The values live in the scoring function, not in the agents."* This makes Foreman's quality bar re-tunable without rewriting a single agent prompt. *(darwin-derby, LLM-as-judge section)*

**Loop / evidence primitives**

- **Absence-of-metric is the crash detector.** `grep "^val_bpb:"` returning empty ⇒ crashed. Cheap, unspoofable-by-accident, and forces the metric into a machine-greppable line. Foreman gates should emit a single canonical `KEY: value` line per criterion and treat its absence as failure. *(program.md steps 5–6)*
- **Never let raw output into context.** `> run.log 2>&1`, explicitly *"do NOT use tee"*; grep two fields on success, `tail -n 50` only on failure. This is the cheapest known context-budget control and Karpathy committed a fix specifically for the failure mode (`bd75534` "Fix agent crash blindspot by forcing it to read traceback"). *(program.md)*
- **Every run gets a hard wall-clock kill at 2× budget.** 5-minute budget, 10-minute `pkill`, treated as crash-and-revert. Foreman's lane watchdogs should use the same ratio and the same disposition (revert, log, continue — not escalate). *(program.md, program_agenthub.md)*
- **One knob, one commit, one delta.** The `exp/H100/mar8` commit messages *are* the hypotheses: `"RoPE base frequency 10K to 200K"`, `"VE WD 0.002 to 0.003"`. Attributable improvement requires atomic changes. *(exp/H100/mar8 log)*
- **Budget the resource dimension that actually binds you.** Karpathy fixes wall-clock; `autoscaffold` fixes a 2M-token budget. Foreman should declare which one is fixed per lane, because it determines what the agent trades away. *(prepare.py `TIME_BUDGET`; tianjianl/autoscaffold)*
- **Expect an 18% keep rate on a good day and ~3% over a long session.** 23/126 on mar8; ~20/700 over two days. Design the reducer, the storage, and the cost model around a 5:1-to-30:1 waste ratio being *normal*, not a malfunction. *(results.tsv; Mar 9 tweet)*
- **Measure keep-rate per model and race them.** 8/30 keeps (Opus) vs 3/30 (Sonnet) at identical experiment counts, whole comparison for $17. This is a directly runnable Foreman experiment for router calibration. *(alpozcan/autoresearch)*
- **Median-of-N for noisy metrics.** Cold launch measured as median of 3. Any Foreman metric with run-to-run variance (timing, flaky tests) needs this or the ratchet ratchets on noise. *(alpozcan/autoresearch)*
- **"Optimize a metric" and "violate an invariant" are the same loop.** Swap `better(score)` for `found_novel_violation()` and the harness is a fuzzer/security lane unchanged — with the keep rule changed from *magnitude* to *novelty*. *(Discussion #88)*

**Lineage / graph primitives**

- **Split the record: improvements to the DAG, failures to the board.** *"Only push improvements... Post EVERY result — including failures and discards. Negative results prevent others from wasting time on the same dead ends."* Foreman gets a clean, high-value-density lineage plus a cheap, unstructured failure log — without paying to structure the 82% that failed. *(program_agenthub.md steps 6–8)*
- **`children` / `leaves` / `lineage` are the three queries that matter, and they are three SQL statements over `(hash, parent_hash)`.** `children` = "what has already been tried here" (dedup). `leaves` = "the unexplored frontier" (work assignment). `lineage` = "how did we get here" (audit). Foreman should expose exactly these three over its own run graph before building anything richer. *(agenthub `db.go` `GetChildren`/`GetLeaves`/`GetLineage`)*
- **Read-before-propose, every iteration, against `children` of the current best.** Loop step 1 in the swarm spec — this is the *only* deduplication mechanism in the whole design. *(program_agenthub.md)*
- **Reject orphans at the door.** The push handler 400s if `parent_hash` is not already in the repo. Foreman's equivalent: no artifact enters the run graph without a resolvable parent run. Cheap, and it makes lineage total rather than best-effort. *(git_handlers.go `handleGitPush`)*
- **Enforce a one-line joinable result schema.** `commit:<hash> platform:<gpu> val_bpb:<v> vram_gb:<v> | <desc>` is what makes an unstructured board machine-readable. Foreman should mandate the analogous line in every worker report. **But note the flaw to fix: AgentHub has no foreign key from `posts` to `commits` — the join is by string convention only.** Foreman should make it a real reference. *(program_agenthub.md §6; db.go schema)*
- **Tag every result with its execution platform when the budget is wall-clock.** *"results are only directly comparable across the same platform"*, hence branch convention `exp/{GPU}/{tag}`. Foreman analogue: tag with model, toolchain version, and machine class, and refuse to compare across them. *(program_agenthub.md; PR #44)*
- **Session boundary = commit the full log + open a PR whose body is the report.** *"the diff shows the final config, the commit history shows the kept experiments, and results.tsv captures everything (including discards)."* This is the single most directly portable artifact contract in this whole lane — it reconciles "clean branch" with "don't lose the failures", and it's already PR-shaped, which is Foreman's existing merge-gate surface. *(PR #44, written by Karpathy's agent)*
- **Structure the session report: highlights → top wins (ranked by Δ) → new findings (with the *shape* of the optimum) → confirmed-from-prior (replication) → dead ends (with magnitudes) → full log.** Copy this six-part template for Foreman's `FOREMAN_REPORT.md`. The **replication section** is the part everyone skips and it is where *"5% warmup did NOT reproduce — actually hurt this time... These things are fragile"* comes from. *(Discussion #43)*
- **Cite prior sessions by ID and state what you inherited.** *"inspired by the findings in #32 — I applied those early wins... right away and then spent most of the session exploring new territory."* *(Discussion #43)*
- **Serial evaluation, parallel proposal.** *"Evaluation is serial — one proposal at a time, so the comparison is always clean. Proposal generation is massively parallel."* This is the correct concurrency shape for Foreman's merge gate: fan out workers freely, single-file the gate. *(darwin-derby README)*
- **"Anything that can `git push` can be an agent — no SDK, no registration, no custom API."** Argues for Foreman's swarm interface being branch + report file rather than a protocol. *(darwin-derby README)*
- **Confirmation across independent lanes should raise certainty, and disagreement should flag a divergence rather than overwrite.** With an adaptive rate: low-certainty claims move fast, high-certainty claims resist noise. This is the concrete mechanism for Foreman's two-lane audit disagreement problem. *(Discussion #72)*

**Autonomy / human-boundary primitives**

- **Front-load the human handshake, then forbid check-ins.** Six setup steps with a human, one confirmation, then `NEVER STOP`: *"Do NOT pause to ask the human if you should continue... The human might be asleep."* Plus a concrete anti-idle instruction: *"If you run out of ideas, think harder — read papers referenced in the code, re-read the in-scope files for new angles, try combining previous near-misses, try more radical architectural changes."* *(program.md)*
- **Fresh-run enforcement by name collision.** *"The branch `autoresearch/<tag>` must not already exist."* Free idempotency guard. *(program.md)*
- **Orphan-branch isolation for swarm members.** `git checkout --orphan` + a single baseline commit, so contributed lineage is not tangled with upstream history. *(program_agenthub.md setup step 5)*
- **The human's real work is the meta-setup, and it should be versioned as such.** *"I've iterated more on the 'meta-setup' where I optimize and tune the agent flows even more than the nanochat repo directly"* / *"the real benchmark of interest is: what is the research org agent code that produces improvements the fastest? this is the new meta."* Foreman's skill definition is that artifact — it deserves its own changelog and its own metric. *(Mar 5 tweet + reply)*
- **The named human-owned surface, from the horse's mouth:** *"You have agents, which are spiky entities. They are fallible and stochastic, but extremely powerful. How do you coordinate them to go faster without sacrificing your quality bar?"* — and the agentic engineer *"design[s] specs, supervise[s] plans, inspect[s] diffs, write[s] tests, create[s] evaluation loops, manage[s] permissions, **isolate[s] worktrees**, and preserve[s] quality."* That list is close to a Foreman feature spec, and worktree isolation is already in it. *(Sequoia Ascent 2026)*
- **"LLMs automate what you can verify."** The gating question for admitting any task to a Foreman ratchet lane. *(Sequoia Ascent 2026, §5)*
- **The scaling story is promote-upward, and it is empirically supported.** *"You spin up a swarm of agents, you have them collaborate to tune smaller models, you promote the most promising ideas to increasingly larger scales, and humans (optionally) contribute on the edges"* — backed by the verified d12 → d24 transfer where **all ~20 changes were additive**. Foreman analogue: ratchet on a fast proxy gate (unit tests / lint / a subset), then promote survivors to the expensive gate (full suite / integration / audit). *(Mar 9 tweet)*
- **Generality claim worth testing:** *"any metric you care about that is reasonably efficient to evaluate (or that has more efficient proxy metrics...) can be autoresearched by an agent swarm."* *(Mar 9 tweet)*

---

## 7. Open questions / unreachable sources

1. **`karpathy/agenthub` is deleted [X].** I could not retrieve the original repo, its description (where the "GitHub is for humans / AgentHub is for agents" slogan likely lived), its issues, or its star count. Mirrors preserve the code but not the social metadata. **Any Foreman doc citing it should cite a mirror, not the dead URL.**
2. **`http://autoresearchhub.com` does not resolve [X].** The live hub referenced by `program_agenthub.md` is gone, so I have **no evidence about whether the swarm ever actually ran at scale**: no observed number of participating agents, no DAG size, no dedup behaviour, no failure modes under load. Every scaling claim about AgentHub in the synthesis paper is untested — by Karpathy as much as by anyone.
3. **The two AgentHub halves were never reconciled.** The server ships an `ah` CLI writing `~/.agenthub/config.json`; the client spec uses raw `curl` and `~/.agenthub_creds`. Unknown which was intended to win. If Foreman borrows, pick one.
4. **`karpathy/autoresearch` has had no commits since 2026-03-26** — four months. Whether "round 2", the multi-agent parallelism work he announced, or AgentHub v2 happened privately is unknown. I found no public successor repo.
5. **The 126 vs 125 discrepancy** between Discussion #43 ("126 experiments") and PR #44 ("125 experiments") for the same branch is unresolved; `results.tsv` has 126 data rows including the baseline. Trivial, but a reminder that the agent's own reported counts drift.
6. **Sequoia Ascent primary video not fetched [X]** (`youtube.com/watch?v=96jN2OCOfLs`). I used Karpathy's own published summary+transcript at `karpathy.bearblog.dev/sequoia-ascent-2026/` (30 Apr 2026) — which he flags as **AI-generated** from the transcript (*"I used a top capability model (in this case Codex 5.5) and read the content and it reads ok without glaring mistakes"*). So quotes from it are **author-endorsed but machine-cleaned**, not raw. Direct-quote them with that caveat.
7. **Synthesis-paper reference [4] date is off.** It cites "public post on collaborative agent swarms, March 8, 2026" and attributes the swarm/promote/humans-on-the-edges quote to it. Verified: the **SETI@home** post is Mar 8 2026 6:00 PM (`2030705271627284816`); the **swarm/promote/humans-on-the-edges** quote is a *different* post, Mar 9 2026 10:28 PM (`2031135152349524125`). Two posts, not one.
8. **Not investigated in this lane:** Anthropic's Dynamic Workflows / Knowledge Graph Cookbook / Building Effective Agents (refs [5][6][7][8][11]) — out of scope for R1; the Bun Zig→Rust port claim [12]; and whether any fork has run the Derby-style *blind* scoring against a real Foreman-style repo gate. Deep-reads not performed on `eli-labz/ResearchSwarm` (360★) or `kyle-compute/autohypothesis` (its Svelte `RunGraph`/`DiffViewer` dashboard is probably worth a look for Foreman UI).
9. **Unverified in AgentHub because there is no test suite and no deployment:** whether `GetLineage`'s per-hop query loop, the unpaginated `leaves`/`children`, and the absence of any pruning would survive the "thousands of agents" scale Karpathy describes. My read of the code is that they would not.
