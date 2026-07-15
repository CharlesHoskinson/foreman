# Foreman Skill Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: This plan executes through the **foreman skill** (approach A per the spec): each task becomes a five-part spec routed to a Grok implementer in an isolated worktree, verified by the architect, cold-audited by codex-auditor. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden foreman's implementer lanes, make worktree isolation the soft-mode default with a tested merge-back script, add an iterative docs/comment-quality stage, vendor three reference skills, and keep installers/manifest/site truthful.

**Architecture:** Four changesets. CS1 (doctrine/lane contracts) lands first because CS2–CS4 workers must obey it. CS2 builds the machinery (bats harness, `wt-merge.sh`, `docs-check.sh`) that CS3/CS4 merges then use. CS3 (vendoring+installers) and CS4 (site) are independent of each other and run parallel to CS2.

**Tech Stack:** bash (`set -euo pipefail`, `lib/common.sh` conventions), bats-core, PowerShell, TOML manifest, markdownlint-cli2 (npm), codespell (pip), lychee (winget/cargo), static HTML/CSS.

**Spec:** `docs/superpowers/specs/2026-07-15-foreman-enhancement-design.md`

## Global Constraints

- Workers never run git write commands (`commit|add|reset|branch|push|rebase|merge|tag`); read-only git allowed. Architect owns all git writes.
- Workers never delete or rename files — they list them under `ARCHITECT_ACTIONS`.
- All new bash scripts: `#!/usr/bin/env bash`, `set -euo pipefail`, source `lib/common.sh`, shdoc headers (`# @description`, `# @arg`, `# @exitcode`) on every function, top-of-file purpose comment.
- Vendored skill dirs (`skills/scrapling`, `skills/graphify`, `skills/superpowers`) are excluded from all lint/docs checks and never locally modified.
- `site/index.html` keeps zero external asset references and the verbatim sentence "Containers (hard mode) share the host/WSL2 kernel — defense-in-depth, not a hard boundary."
- Verification commands run from repo root under Git Bash unless stated WSL.
- The verbatim doctrine text blocks below are contracts — insert them exactly.

---

### Task 1 (CS1): Harden implementer agent contracts

**Files:**

- Modify: `agents/grok-implementer.md`
- Modify: `agents/codex-implementer.md`

**Interfaces:**

- Produces: report fields `EVIDENCE` and `ARCHITECT_ACTIONS` that Task 6's audit checklist and the architect's verification rely on.

- [ ] **Step 1: Add the three doctrine blocks to `agents/grok-implementer.md`**

Insert after the `## Contract` section, before `## Run grok`:

````markdown
## Git discipline (standing rule)

You and Grok NEVER run git write commands: `commit`, `add`, `reset`, `branch`,
`push`, `rebase`, `merge`, `tag`. Read-only git (`status`, `diff`, `log`,
`show`) is allowed. The architect owns all git writes. If the spec or Grok's
output implies a commit, leave changes in the working tree and note it.

## Evidence contract

Record BEFORE invoking grok, and AGAIN after it exits:

```bash
HEAD_B=$(git log -1 --format=%H 2>/dev/null || echo none)
DIG_B=$(git status --porcelain | sha256sum | cut -d' ' -f1)
# ... run grok ...
HEAD_A=$(git log -1 --format=%H 2>/dev/null || echo none)
DIG_A=$(git status --porcelain | sha256sum | cut -d' ' -f1)
```

Report all four values. If `HEAD_B != HEAD_A`, set
`unauthorized_git_activity: true` and list `git log --oneline HEAD_B..HEAD_A`.

## Known limits (Grok headless)

Grok's shell tool is cancelled (`PermissionCancelled`) under headless
`--permission-mode acceptEdits`. Therefore Grok CANNOT: delete or rename
files, chmod, or run verification commands. Do not retry these — you run
verification yourself; deletions/renames go in `ARCHITECT_ACTIONS`. Specs
should never ask Grok for deletions; if one does, report the gap.
````

- [ ] **Step 2: Extend the report template in `agents/grok-implementer.md`**

Replace the existing ` ```\nGROK REPORT ... ``` ` block with:

```text
GROK REPORT
STATUS: complete | partial | timeout | unavailable
OBJECTIVE: [one line]
CHANGES: [file — summary, per file, from actual diff]
VERIFIED: [command you re-ran — actual output]
EVIDENCE:
  head_before: <sha|none>  head_after: <sha|none>
  status_digest_before: <sha256>  status_digest_after: <sha256>
  unauthorized_git_activity: true|false
ARCHITECT_ACTIONS: [delete <path> | rename <a> -> <b> | none]
GROK SAID: [one-line summary]
GAPS: [ambiguities or none]
```

- [ ] **Step 3: Mirror the same three blocks + report fields in `agents/codex-implementer.md`**

Same text with s/grok/codex/ in prose and `CODEX REPORT` fields extended identically. Known-limits block for Codex reads:

```markdown
## Known limits (Codex exec)

`codex exec --sandbox workspace-write` cannot write outside the workspace,
cannot run network installs, and receives the prompt on stdin. Deletions and
renames inside the workspace ARE allowed for Codex; still report them under
ARCHITECT_ACTIONS so the architect can verify intent.
```

- [ ] **Step 4: Verify**

```bash
grep -c "unauthorized_git_activity" agents/grok-implementer.md agents/codex-implementer.md
# expect 2 per file
grep -c "ARCHITECT_ACTIONS" agents/grok-implementer.md agents/codex-implementer.md
# expect ≥2 per file
grep -c "Known limits" agents/grok-implementer.md agents/codex-implementer.md
# expect 1 per file
```

- [ ] **Step 5: Architect commits** `feat(agents): git-write ban, evidence contract, known-limits for implementer lanes`

### Task 2 (CS1): Standing constraints in spec template + lane known-limits table

**Files:**

- Modify: `skills/foreman/references/five-part-spec.md`
- Modify: `skills/foreman/references/lanes.md`

**Interfaces:**

- Produces: the "Standing constraints" block name used by SKILL.md (Task 6) and by every future spec the architect writes.

- [ ] **Step 1: Add standing constraints to `five-part-spec.md`**

Insert immediately after the template code fence, before `## Quality bar`:

```markdown
## Standing constraints (copy into EVERY spec's Constraints section)

- NEVER run git write commands (`commit`, `add`, `reset`, `branch`, `push`,
  `rebase`, `merge`, `tag`). Changes stay uncommitted in the working tree.
- Do not delete or rename files. List needed deletions/renames in your
  report under `ARCHITECT_ACTIONS`.
- Work only inside the provided worktree path. Never write outside it.
- No network access unless the spec explicitly grants it.
- Documentation and comments are part of the deliverable: markdown passes
  markdownlint-cli2; bash functions carry shdoc headers (`# @description`
  minimum); scripts carry a top-of-file purpose comment.
```

- [ ] **Step 2: Add known-limits table to `lanes.md`**

Append a new section at the end:

```markdown
## Known limits per CLI (soft mode, headless)

| Lane | Limit | Consequence for specs |
|---|---|---|
| Grok headless | Shell tool cancelled (`PermissionCancelled`) under `acceptEdits`; cannot delete/rename/chmod or run commands | Wrapper runs verification; deletions go to `ARCHITECT_ACTIONS`; never spec a deletion to Grok |
| Grok headless | May narrate success without writing; may attempt git commits | Evidence contract (head/status digests) is mandatory; git-write ban is standing |
| Codex exec | `workspace-write` sandbox: no writes outside workspace, no network installs | Keep file set inside the worktree; pre-install deps via bootstrap |
| Both | No conversation context | Five-part spec must be self-contained; include Standing constraints verbatim |
```

- [ ] **Step 3: Verify**

```bash
grep -c "Standing constraints" skills/foreman/references/five-part-spec.md   # ≥1
grep -c "Known limits per CLI" skills/foreman/references/lanes.md            # 1
grep -c "ARCHITECT_ACTIONS" skills/foreman/references/five-part-spec.md skills/foreman/references/lanes.md  # ≥1 each
```

- [ ] **Step 4: Architect commits** `feat(references): standing spec constraints + per-CLI known-limits`

### Task 3 (CS2): bats harness bootstrap + wt-new suite

**Files:**

- Create: `tests/run.sh`
- Create: `tests/helpers.bash`
- Create: `tests/wt-new.bats`
- Modify: `env/reference-manifest.toml` (bats entry)
- Modify: `env/bootstrap-wsl.sh` (install bats-core)

**Interfaces:**

- Produces: `setup_tmp_repo` helper (exports `REPO`, `SCRIPTS`, `FOREMAN_HOME`) consumed by Tasks 4–5 test suites; `tests/run.sh` as the suite entry point.

- [ ] **Step 1: Write `tests/helpers.bash`**

```bash
#!/usr/bin/env bash
# @description Shared bats helpers: throwaway git repo + isolated FOREMAN_HOME.

# @description Create a disposable git repo and point FOREMAN_HOME at test tmp.
# @set REPO absolute path of the throwaway repo
# @set SCRIPTS absolute path of skills/foreman/scripts in the real checkout
# @set FOREMAN_HOME isolated run-state dir under bats tmp
setup_tmp_repo() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/foreman-home"
  mkdir -p "$FOREMAN_HOME"
  REPO="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$REPO"
  git -C "$REPO" init -q -b main
  git -C "$REPO" config user.email test@example.com
  git -C "$REPO" config user.name "Foreman Test"
  echo "# fixture" > "$REPO/README.md"
  git -C "$REPO" -c core.hooksPath= add README.md
  git -C "$REPO" -c core.hooksPath= commit -qm init
  SCRIPTS="$(cd "$BATS_TEST_DIRNAME/../skills/foreman/scripts" && pwd)"
  export REPO SCRIPTS
}
```

- [ ] **Step 2: Write `tests/run.sh`**

```bash
#!/usr/bin/env bash
# @description Run the Foreman bats suite. Finds bats on PATH or ~/.foreman/tools/bats-core.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
BATS="${BATS:-$(command -v bats || true)}"
if [[ -z "$BATS" && -x "$HOME/.foreman/tools/bats-core/bin/bats" ]]; then
  BATS="$HOME/.foreman/tools/bats-core/bin/bats"
fi
if [[ -z "$BATS" ]]; then
  echo "bats not found. Install: git clone https://github.com/bats-core/bats-core ~/.foreman/tools/bats-core" >&2
  exit 2
fi
exec "$BATS" "$@" .
```

- [ ] **Step 3: Write `tests/wt-new.bats`**

```bash
#!/usr/bin/env bats
load helpers

setup() { setup_tmp_repo; cd "$REPO"; }

@test "wt-new creates worktree, branch, and report scaffold" {
  run bash "$SCRIPTS/wt-new.sh" run1 implement slug1
  [ "$status" -eq 0 ]
  WT="${lines[-1]}"
  [ -d "$WT" ]
  [ -f "$WT/FOREMAN_REPORT.md" ]
  [ -f "$WT/FOREMAN_REPORT.json" ]
  git -C "$REPO" show-ref --verify --quiet refs/heads/foreman/run1/implement/slug1
}

@test "wt-new rejects malformed run id" {
  run bash "$SCRIPTS/wt-new.sh" "bad id" search
  [ "$status" -ne 0 ]
}

@test "wt-new rejects unknown role" {
  run bash "$SCRIPTS/wt-new.sh" run1 hacker
  [ "$status" -ne 0 ]
}

@test "wt-new refuses duplicate worktree path" {
  bash "$SCRIPTS/wt-new.sh" run1 plan
  run bash "$SCRIPTS/wt-new.sh" run1 plan
  [ "$status" -ne 0 ]
}
```

- [ ] **Step 4: Run the suite (WSL or Git Bash with bats)**

Run: `bash tests/run.sh`
Expected: 4 tests, all pass (wt-new.sh already exists; this suite pins current behavior).

- [ ] **Step 5: Manifest + bootstrap entries**

Append to `env/reference-manifest.toml` (before `[profiles.soft]`), matching existing `[[tools]]` format:

```toml
[[tools]]
id = "bats"
profile = ["full"]
where = ["wsl"]
check = "bats --version || ~/.foreman/tools/bats-core/bin/bats --version"
install_wsl = "git clone --depth 1 https://github.com/bats-core/bats-core ~/.foreman/tools/bats-core"
required = true
notes = "Test harness for skills/foreman/scripts (tests/run.sh)"
```

In `env/bootstrap-wsl.sh`, add an install step following the file's existing per-tool pattern that performs the same clone when `bats` is absent.

- [ ] **Step 6: Verify + architect commits**

```bash
grep -c 'id = "bats"' env/reference-manifest.toml   # 1
grep -c "bats-core" env/bootstrap-wsl.sh            # ≥1
bash tests/run.sh                                    # all pass
```

Commit: `feat(tests): bats harness + wt-new suite; manifest/bootstrap bats entry`

### Task 4 (CS2): wt-merge.sh — TDD

**Files:**

- Create: `tests/wt-merge.bats`
- Create: `skills/foreman/scripts/wt-merge.sh`

**Interfaces:**

- Consumes: `setup_tmp_repo` from `tests/helpers.bash`; run-dir metadata JSON written by `wt-new.sh` (`~/.foreman/runs/<RUN>/worktrees/<role>[-slug].json` with keys `branch`, `worktree`, `base_sha`, `status`).
- Produces: `wt-merge.sh RUN_ID ROLE [SLUG] [--commit]` — exit 0 staged-apply; exit 3 missing metadata; exit 4 dirty target index; exit 5 overlap refusal; exit 7 squash conflict. Metadata `status` becomes `"merged"`. Used to land CS3/CS4.

- [ ] **Step 1: Write the failing tests `tests/wt-merge.bats`**

```bash
#!/usr/bin/env bats
load helpers

setup() { setup_tmp_repo; cd "$REPO"; }

# @description helper: create implement worktree with one committed change
make_work() {  # $1 filename  $2 content
  WT="$(bash "$SCRIPTS/wt-new.sh" run1 implement fix | tail -1)"
  echo "${2:-work}" > "$WT/${1:-new-file.txt}"
  git -C "$WT" -c core.hooksPath= add -A
  git -C "$WT" -c core.hooksPath= commit -qm work
}

@test "wt-merge stages changes without committing by default" {
  make_work new-file.txt
  run bash "$SCRIPTS/wt-merge.sh" run1 implement fix
  [ "$status" -eq 0 ]
  git -C "$REPO" diff --cached --name-only | grep -q new-file.txt
  [ "$(git -C "$REPO" rev-list --count HEAD)" -eq 1 ]
}

@test "wt-merge --commit creates exactly one commit" {
  make_work new-file.txt
  run bash "$SCRIPTS/wt-merge.sh" run1 implement fix --commit
  [ "$status" -eq 0 ]
  [ "$(git -C "$REPO" rev-list --count HEAD)" -eq 2 ]
  git -C "$REPO" diff --cached --quiet
}

@test "wt-merge refuses when target has uncommitted overlap" {
  make_work README.md changed-in-worktree
  echo dirty-local >> "$REPO/README.md"
  run bash "$SCRIPTS/wt-merge.sh" run1 implement fix
  [ "$status" -eq 5 ]
  git -C "$REPO" diff --cached --quiet   # nothing staged
}

@test "wt-merge refuses when target index already has staged changes" {
  make_work new-file.txt
  echo staged > "$REPO/staged.txt"
  git -C "$REPO" -c core.hooksPath= add staged.txt
  run bash "$SCRIPTS/wt-merge.sh" run1 implement fix
  [ "$status" -eq 4 ]
}

@test "wt-merge fails on missing metadata" {
  run bash "$SCRIPTS/wt-merge.sh" nosuchrun implement
  [ "$status" -eq 3 ]
}

@test "wt-merge marks metadata merged" {
  make_work new-file.txt
  bash "$SCRIPTS/wt-merge.sh" run1 implement fix
  grep -q '"status": *"merged"' "$FOREMAN_HOME/runs/run1/worktrees/implement-fix.json"
}
```

- [ ] **Step 2: Run to verify failure**

Run: `bash tests/run.sh wt-merge.bats`
Expected: all 6 FAIL (`wt-merge.sh: No such file`).

- [ ] **Step 3: Implement `skills/foreman/scripts/wt-merge.sh`**

```bash
#!/usr/bin/env bash
# @description Squash-apply a Foreman worktree branch onto the current branch
#   as staged changes (no commit by default). Fail-closed: refuses dirty
#   indexes, uncommitted overlap, and merge conflicts.
# Usage: wt-merge.sh RUN_ID ROLE [SLUG] [--commit]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/worktree.sh
source "$SCRIPT_DIR/lib/worktree.sh"

COMMIT=0
POS=()
for a in "$@"; do
  case "$a" in
    --commit) COMMIT=1 ;;
    *) POS+=("$a") ;;
  esac
done
RUN_ID="${POS[0]:?usage: wt-merge.sh RUN_ID ROLE [SLUG] [--commit]}"
ROLE="${POS[1]:?role required}"
SLUG="${POS[2]:-}"

# @description Read one string field from the worktree metadata JSON.
# @arg $1 metadata file path
# @arg $2 field name
# @stdout field value
meta_get() {
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$2" '.[$k]' "$1"
  else
    python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"
  fi
}

RD="$(run_dir "$RUN_ID")"
META="$RD/worktrees/${ROLE}${SLUG:+-$SLUG}.json"
[[ -f "$META" ]] || { echo "wt-merge: no metadata: $META" >&2; exit 3; }
BRANCH="$(meta_get "$META" branch)"

ROOT="$(git_nohooks rev-parse --show-toplevel)"

git_nohooks -C "$ROOT" diff --cached --quiet \
  || { echo "wt-merge: target index has staged changes — commit or reset first" >&2; exit 4; }

BASE="$(git_nohooks -C "$ROOT" merge-base HEAD "$BRANCH")"
INCOMING="$(git_nohooks -C "$ROOT" diff --name-only "$BASE" "$BRANCH" | sort)"
DIRTY="$(git_nohooks -C "$ROOT" status --porcelain | sed 's/^...//' | sort)"
OVERLAP="$(comm -12 <(printf '%s\n' "$INCOMING") <(printf '%s\n' "$DIRTY") | sed '/^$/d')"
if [[ -n "$OVERLAP" ]]; then
  echo "wt-merge: uncommitted target changes overlap incoming files:" >&2
  printf '  %s\n' $OVERLAP >&2
  exit 5
fi

if ! git_nohooks -C "$ROOT" merge --squash "$BRANCH" >/dev/null 2>&1; then
  git_nohooks -C "$ROOT" reset --merge >/dev/null 2>&1 || true
  echo "wt-merge: squash merge conflict against $BRANCH" >&2
  exit 7
fi

if [[ "$COMMIT" -eq 1 ]]; then
  git_nohooks -C "$ROOT" commit -m "foreman(${RUN_ID}/${ROLE}${SLUG:+/$SLUG}): merge worktree" >/dev/null
fi

# @description Mark the metadata status merged (jq or python3 fallback).
mark_merged() {
  if command -v jq >/dev/null 2>&1; then
    jq '.status = "merged"' "$META" > "$META.tmp" && mv "$META.tmp" "$META"
  else
    python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["status"]="merged"; json.dump(d, open(p,"w"), indent=2)' "$META"
  fi
}
mark_merged
log "merged: $BRANCH -> $(git_nohooks -C "$ROOT" rev-parse --abbrev-ref HEAD) (${COMMIT:+committed}${COMMIT:-staged})"
```

Note for implementer: `run_dir`, `git_nohooks`, `log` come from `lib/common.sh` / `lib/worktree.sh` — read those first and match their conventions; if `run_dir` resolves via `$FOREMAN_HOME`, tests inherit isolation automatically.

- [ ] **Step 4: Run tests to verify pass**

Run: `bash tests/run.sh wt-merge.bats`
Expected: 6 pass.

- [ ] **Step 5: Full suite** `bash tests/run.sh` — all pass.

- [ ] **Step 6: Architect commits** `feat(scripts): wt-merge squash-apply with overlap refusal (TDD)`

### Task 5 (CS2): docs-check stage — configs, script, tests, toolchain

**Files:**

- Create: `.markdownlint-cli2.jsonc`
- Create: `.codespellrc`
- Create: `skills/foreman/scripts/docs-check.sh`
- Create: `tests/docs-check.bats`
- Modify: `env/reference-manifest.toml` (docs tool group)
- Modify: `env/bootstrap-wsl.sh`, `env/bootstrap-windows.ps1` (install docs tools)
- Modify: `env/tool-check.sh`, `env/tool-check.ps1` (docs group reporting)

**Interfaces:**

- Produces: `docs-check.sh [--online] [--json PATH]` — exit 0 all green, 1 findings, 2 tool missing (fail closed). JSON schema: `{"schema":"foreman.docs-check.v1","status":"pass|fail","tools":{"markdownlint":{"status":"pass|fail|missing","findings":N},"codespell":{...},"lychee":{...},"comments":{...}}}`. Consumed by Task 6 (`checks-run.sh`/`gate-eval.sh`) and every implement round.

- [ ] **Step 1: Write `.markdownlint-cli2.jsonc`**

```jsonc
{
  // Foreman docs style: permissive on line length/HTML (doctrine tables), strict on structure.
  "config": { "default": true, "MD013": false, "MD033": false, "MD041": false },
  "ignores": [
    "skills/scrapling/**", "skills/graphify/**", "skills/superpowers/**",
    "docs/research/**", "sandbox/**", "node_modules/**"
  ]
}
```

- [ ] **Step 2: Write `.codespellrc`**

```ini
[codespell]
skip = .git,./skills/scrapling,./skills/graphify,./skills/superpowers,./docs/research,./sandbox,./site/style.css
ignore-words-list = grok,codex,worktree,worktrees,shdoc,bats,toml,fable,jsonc
```

- [ ] **Step 3: Write failing tests `tests/docs-check.bats`**

```bash
#!/usr/bin/env bats
load helpers

setup() {
  setup_tmp_repo
  cd "$REPO"
  mkdir -p scripts
  cp "$BATS_TEST_DIRNAME/../.markdownlint-cli2.jsonc" . 2>/dev/null || true
  cp "$BATS_TEST_DIRNAME/../.codespellrc" . 2>/dev/null || true
}

@test "docs-check passes on a clean fixture" {
  cat > scripts/good.sh <<'EOF'
#!/usr/bin/env bash
# @description Fixture script that is fully documented.
set -euo pipefail
# @description Say hello.
# @stdout the greeting
hello() { echo hello; }
EOF
  run bash "$SCRIPTS/docs-check.sh" --json out.json
  [ "$status" -eq 0 ]
  grep -q '"status": *"pass"' out.json
}

@test "docs-check fails on undocumented bash function" {
  cat > scripts/bad.sh <<'EOF'
#!/usr/bin/env bash
# @description Fixture with an undocumented function.
set -euo pipefail
mystery() { echo '?'; }
EOF
  run bash "$SCRIPTS/docs-check.sh" --json out.json
  [ "$status" -eq 1 ]
  grep -q 'undocumented function' <<< "$output"
}

@test "docs-check fails on script without purpose header" {
  printf '#!/usr/bin/env bash\nset -euo pipefail\n' > scripts/naked.sh
  run bash "$SCRIPTS/docs-check.sh" --json out.json
  [ "$status" -eq 1 ]
}

@test "docs-check writes machine-readable JSON" {
  run bash "$SCRIPTS/docs-check.sh" --json out.json
  [ -f out.json ]
  grep -q '"schema": *"foreman.docs-check.v1"' out.json
}
```

- [ ] **Step 4: Run to verify failure** — `bash tests/run.sh docs-check.bats` → FAIL (script missing).

- [ ] **Step 5: Implement `skills/foreman/scripts/docs-check.sh`**

```bash
#!/usr/bin/env bash
# @description Fail-closed documentation and comment-quality gate: markdownlint-cli2,
#   codespell, lychee (offline by default), and bash comment-coverage. Emits a human
#   summary and optional JSON (--json PATH) for gate consumption.
# Usage: docs-check.sh [--online] [--json PATH]
# @exitcode 0 all checks pass
# @exitcode 1 findings
# @exitcode 2 required tool missing (fail closed)
set -euo pipefail

ONLINE=0; JSON_OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --online) ONLINE=1; shift ;;
    --json) JSON_OUT="${2:?--json needs a path}"; shift 2 ;;
    *) echo "docs-check: unknown arg $1" >&2; exit 2 ;;
  esac
done

VENDORED=(skills/scrapling skills/graphify skills/superpowers docs/research sandbox)
declare -A T_STATUS T_FINDINGS
FAIL=0; MISSING=0

# @description Record one tool result.
# @arg $1 tool key  @arg $2 status pass|fail|missing  @arg $3 finding count
record() { T_STATUS[$1]="$2"; T_FINDINGS[$1]="${3:-0}"; [[ "$2" == fail ]] && FAIL=1; [[ "$2" == missing ]] && MISSING=1; return 0; }

# markdownlint-cli2 — config supplies ignores
if command -v markdownlint-cli2 >/dev/null 2>&1; then
  if OUT=$(markdownlint-cli2 "**/*.md" 2>&1); then record markdownlint pass 0
  else record markdownlint fail "$(grep -c ':' <<<"$OUT" || true)"; echo "$OUT" | tail -20; fi
else record markdownlint missing; fi

# codespell — .codespellrc supplies skip list
if command -v codespell >/dev/null 2>&1; then
  if OUT=$(codespell 2>&1); then record codespell pass 0
  else record codespell fail "$(wc -l <<<"$OUT")"; echo "$OUT" | tail -20; fi
else record codespell missing; fi

# lychee — offline unless --online
if command -v lychee >/dev/null 2>&1; then
  LARGS=(--no-progress); [[ "$ONLINE" -eq 0 ]] && LARGS+=(--offline)
  MAPFILE=(); while IFS= read -r f; do
    skip=0; for v in "${VENDORED[@]}"; do [[ "$f" == "$v"* ]] && skip=1; done
    [[ $skip -eq 0 ]] && MAPFILE+=("$f")
  done < <(git ls-files '*.md' '*.html' 2>/dev/null || find . -name '*.md' -o -name '*.html')
  if OUT=$(lychee "${LARGS[@]}" "${MAPFILE[@]}" 2>&1); then record lychee pass 0
  else record lychee fail "$(grep -c 'ERROR\|✗' <<<"$OUT" || true)"; echo "$OUT" | tail -20; fi
else record lychee missing; fi

# comment coverage over scripts/**/*.sh (repo-relative; excludes vendored)
COV_FINDINGS=0
while IFS= read -r f; do
  skip=0; for v in "${VENDORED[@]}"; do [[ "$f" == "$v"* ]] && skip=1; done
  [[ $skip -eq 1 ]] && continue
  # top-of-file purpose comment within first 5 non-shebang lines
  if ! awk 'NR<=6 && /^#/ && !/^#!/ {found=1} END{exit !found}' "$f"; then
    echo "missing purpose header: $f"; COV_FINDINGS=$((COV_FINDINGS+1))
  fi
  # every function preceded by a comment block containing @description
  while IFS= read -r line; do
    echo "undocumented function: $f: $line"; COV_FINDINGS=$((COV_FINDINGS+1))
  done < <(awk '
    /^#/ { if ($0 ~ /@description/) doc=1; next }
    /^[[:space:]]*$/ { next }
    /^(function[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\(\)/ {
      if (!doc) print FNR": "$0
      doc=0; next
    }
    { doc=0 }
  ' "$f")
done < <(find . -path ./.git -prune -o -name '*.sh' -print | sed 's|^\./||')
if [[ "$COV_FINDINGS" -gt 0 ]]; then record comments fail "$COV_FINDINGS"; else record comments pass 0; fi

# JSON output
if [[ -n "$JSON_OUT" ]]; then
  python3 - "$JSON_OUT" <<PY
import json, sys
tools = {
  "markdownlint": {"status": "${T_STATUS[markdownlint]:-missing}", "findings": ${T_FINDINGS[markdownlint]:-0}},
  "codespell":    {"status": "${T_STATUS[codespell]:-missing}",    "findings": ${T_FINDINGS[codespell]:-0}},
  "lychee":       {"status": "${T_STATUS[lychee]:-missing}",       "findings": ${T_FINDINGS[lychee]:-0}},
  "comments":     {"status": "${T_STATUS[comments]:-missing}",     "findings": ${T_FINDINGS[comments]:-0}},
}
status = "pass" if all(t["status"] == "pass" for t in tools.values()) else "fail"
json.dump({"schema": "foreman.docs-check.v1", "status": status, "tools": tools}, open(sys.argv[1], "w"), indent=2)
PY
fi

echo "docs-check: markdownlint=${T_STATUS[markdownlint]:-?} codespell=${T_STATUS[codespell]:-?} lychee=${T_STATUS[lychee]:-?} comments=${T_STATUS[comments]:-?}"
[[ "$MISSING" -eq 1 ]] && exit 2
[[ "$FAIL" -eq 1 ]] && exit 1
exit 0
```

Implementer note: the bats fixture repo has no linters installed only if the host lacks them — the docs group is installed by this same task's bootstrap step; tests assume the three CLIs are present (tool-check enforces).

- [ ] **Step 6: Run tests to verify pass** — `bash tests/run.sh docs-check.bats` → 4 pass.

- [ ] **Step 7: Manifest docs group + bootstrap + tool-check**

Append to `env/reference-manifest.toml` (same `[[tools]]` shape): `markdownlint-cli2` (npm both, profile soft+full, required, notes "docs group"), `codespell` (pip both, required, "docs group"), `lychee` (winget windows / cargo-binstall wsl, required, "docs group"), `psscriptanalyzer` (Install-Module, windows only, required=false, "docs group — PowerShell lint"). Add matching install steps to both bootstrap scripts and a `docs` group summary line to both tool-check scripts, following each file's existing per-tool pattern.

- [ ] **Step 8: Verify + architect commits**

```bash
grep -c 'docs group' env/reference-manifest.toml     # ≥3
bash skills/foreman/scripts/docs-check.sh --json /tmp/dc.json; echo "exit=$?"
# expect exit=0 or exit=1 with real findings listed (fix findings in OUR files if trivial)
bash tests/run.sh                                     # all pass
```

Commit: `feat(docs-stage): docs-check script, lint configs, docs tool group (TDD)`

### Task 6 (CS2): Loop integration — gate, audit checklist, doctrine

**Files:**

- Modify: `skills/foreman/scripts/checks-run.sh` (run docs-check, save JSON to run dir)
- Modify: `skills/foreman/scripts/gate-eval.sh` (consume docs-check.json, fail closed)
- Modify: `skills/foreman/references/audit-checklist.md` (Documentation & comments dimension)
- Modify: `skills/foreman/SKILL.md` (worktree-by-default + docs stage)
- Modify: `skills/foreman/references/parallel-worktrees.md` (implement default + wt-merge lifecycle)

**Interfaces:**

- Consumes: `docs-check.sh --json PATH` (Task 5), `wt-merge.sh` (Task 4).
- Produces: gate behavior later tasks' merges must satisfy.

- [ ] **Step 1: `checks-run.sh`** — after existing checks succeed, add (following the script's conventions):

```bash
# Docs/comment quality gate (fail-closed; JSON consumed by gate-eval)
bash "$SCRIPT_DIR/docs-check.sh" --json "$RD/docs-check.json" || DOCS_RC=$?
```

persisting `DOCS_RC` into the run envelope the same way check results are stored.

- [ ] **Step 2: `gate-eval.sh`** — add a gate clause with the file's existing pattern: gate fails if `$RD/docs-check.json` is missing (fail closed) or its `.status != "pass"`.

- [ ] **Step 3: `audit-checklist.md`** — add dimension:

```markdown
## Documentation & comments (iterative)

- Comments explain *why*, not *what*; no narration of the diff.
- Doctrine/docs readable cold — a reader without conversation context can act on them.
- Docs not stale relative to this diff (names, paths, tables, examples).
- Bash functions carry shdoc headers (`@description` minimum) that are truthful.
- Linter results (docs-check.json) attached: findings addressed or explicitly waived.

Findings in this dimension use tag `docs`. BLOCKED is appropriate when
documentation misstates behavior; WARNING for gaps and staleness.
```

- [ ] **Step 4: `SKILL.md`** — two edits.
(a) In "Parallelism (worktree fan-out)" rules, add first bullet: `- **Implement rounds default to worktrees.** Every soft-mode implement round runs in its own tree (wt-new <RUN> implement <slug>); the main checkout is never an implementer target. Land results with wt-merge.sh (staged by default).`
(b) In "Soft verification + audit" list, insert after item 3: `4. **Docs stage (iterative):** run scripts/docs-check.sh; failures loop back to the implementer as a corrected spec, ≤ max_rework_rounds` (renumber the following items).

- [ ] **Step 5: `parallel-worktrees.md`** — in the Scripts table add `wt-merge.sh RUN_ID ROLE [SLUG] [--commit] | Squash-apply branch as staged changes (overlap-refusal)`; in Lifecycle add `→ wt-merge (implement trees)` between consolidate and cleanup; change implement row isolation from "worktree preferred" to "worktree (default)".

- [ ] **Step 6: Verify + architect commits**

```bash
grep -c "docs-check" skills/foreman/scripts/checks-run.sh skills/foreman/scripts/gate-eval.sh  # ≥1 each
grep -c "Documentation & comments" skills/foreman/references/audit-checklist.md               # 1
grep -c "wt-merge" skills/foreman/SKILL.md skills/foreman/references/parallel-worktrees.md    # ≥1 each
bash tests/run.sh   # still green
```

Commit: `feat(loop): docs-check wired into checks/gate; audit docs dimension; worktree-default doctrine`

### Task 7 (CS3): Vendor reference skills

**Files:**

- Create: `skills/scrapling/**` (copy), `skills/graphify/**` (copy), `skills/superpowers/**` (copy)
- Create: `skills/VENDORED.md`

- [ ] **Step 1: Copy, stripping VCS and local overlays** (architect-run — bulk copy, no judgment):

```bash
for s in scrapling graphify superpowers; do
  cp -r "$HOME/.claude/skills/$s" skills/
  rm -rf "skills/$s/.git"
  find "skills/$s" -name '*.local.md' -delete
done
```

- [ ] **Step 2: Write `skills/VENDORED.md`**

```markdown
# Vendored reference skills

Third-party skills vendored for a self-contained Foreman install. Do not
modify locally — update by re-vendoring from upstream.

| Skill | Upstream | Vendored | License |
|---|---|---|---|
| scrapling | https://github.com/D4Vinci/Scrapling (skill wrapper) | 2026-07-15 | see skills/scrapling |
| graphify | local skill (charl) | 2026-07-15 | see skills/graphify |
| superpowers | https://github.com/obra/superpowers | 2026-07-15 | MIT (skills/superpowers/LICENSE) |

Local-overlay files (`*.local.md`, cookie vaults) are excluded at vendor time
and must never be committed.

Re-vendor: `cp -r ~/.claude/skills/<name> skills/ && rm -rf skills/<name>/.git && find skills/<name> -name '*.local.md' -delete`
```

- [ ] **Step 3: Verify**

```bash
test -d skills/scrapling && test -d skills/graphify && test -d skills/superpowers && echo DIRS_OK
find skills -name '*.local.md' | wc -l    # 0
find skills -name '.git' -maxdepth 2 | wc -l   # 0
test -f skills/superpowers/LICENSE && echo LICENSE_OK
```

- [ ] **Step 4: Architect commits** `feat(skills): vendor scrapling, graphify, superpowers reference skills`

### Task 8 (CS3): Installers link all skills; manifest records them

**Files:**

- Modify: `install.sh`, `install.ps1`
- Modify: `env/reference-manifest.toml` (`[[skills]]` section)
- Modify: `env/tool-check.sh`, `env/tool-check.ps1` (verify links)

**Interfaces:**

- Consumes: `skills/*` layout from Task 7.

- [ ] **Step 1: `install.sh`** — replace the three fixed `link_skill` calls with a loop over `"$ROOT"/skills/*/` (skip non-directories and `VENDORED.md`), linking each `skills/<name>` to `~/.claude/skills/<name>`, `~/.agents/skills/<name>`, `~/.grok/skills/<name>`, reusing the existing `link_skill` helper (extend its signature to take src+dest).

- [ ] **Step 2: `install.ps1`** — same loop with `Get-ChildItem -Directory (Join-Path $Root 'skills')` and the existing `Ensure-Junction` helper.

- [ ] **Step 3: Manifest + tool-check** — append:

```toml
[[skills]]
id = "foreman"
path = "skills/foreman"

[[skills]]
id = "scrapling"
path = "skills/scrapling"

[[skills]]
id = "graphify"
path = "skills/graphify"

[[skills]]
id = "superpowers"
path = "skills/superpowers"
```

and in both tool-check scripts add a skills section that reports MISSING for any of the four not linked under `~/.claude/skills` (mirror list acceptable per the manifest header comment).

- [ ] **Step 4: Verify**

```bash
bash install.sh && ls -la ~/.claude/skills | grep -E "scrapling|graphify|superpowers|foreman"  # 4 links
grep -c '\[\[skills\]\]' env/reference-manifest.toml   # 4
powershell -File install.ps1   # idempotent, exit 0 (run on host)
```

- [ ] **Step 5: Architect commits** `feat(install): link all vendored skills; manifest [[skills]] + tool-check`

### Task 9 (CS4): Docs site truthfulness update

**Files:**

- Modify: `site/index.html`
- Modify: `site/README.md` (only if file table drifts)

**Interfaces:**

- Consumes: doctrine wording from Tasks 1–6 (evidence contract, worktree default, docs stage).

- [ ] **Step 1: Soft pipeline diagram** — in `#loops`, replace the `pipeline-soft` div content so stages read: `Decompose → Route (worktree lane) → Verify (diff + checks + docs-check) → Audit (codex cold diff) → Advisor → Done (with evidence)`, keeping the exact class structure (`stage`, `arrow`, `stage-done`) and updating `aria-label` to match.

- [ ] **Step 2: Lanes section** — add a short "Evidence contract" paragraph (head/status digests before+after; unauthorized git activity flagged; deletions via ARCHITECT_ACTIONS) and a 3-row known-limits mini-table (Grok headless no-shell, Codex sandbox scope, both context-free).

- [ ] **Step 3: Loops/security consistency** — mention the iterative docs stage in `#loops` copy; verbatim security sentence untouched.

- [ ] **Step 4: Verify**

```bash
for id in overview roles lanes spec loops security install lineage; do n=$(grep -c "id=\"$id\"" site/index.html); echo "$id:$n"; done  # all 1
grep -c "defense-in-depth, not a hard boundary" site/index.html   # 1
grep -c "docs-check" site/index.html                              # ≥1
grep -c "ARCHITECT_ACTIONS\|Evidence contract" site/index.html    # ≥1
grep -nE '(src|<link[^>]*href)="https?://' site/index.html || echo NO_EXTERNAL_ASSETS
```

- [ ] **Step 5: Architect commits** `docs(site): evidence contract, worktree-default routing, docs stage`

---

## Execution through foreman (approach A)

1. Preflight: `tool-check` (soft profile) + confirm `grok`/`codex`; surface the uncommitted concurrent-session edits overlapping CS1/CS2 targets (SKILL.md, roles.md, CLAUDE.md, README.md, agents/codex-auditor.md) — user must commit/stash before merges.
2. `RUN_ID=enh-20260715`; CS1 = Tasks 1–2 (one implement worktree, one spec); merge manually (`git merge --squash`, staged), commit after verification + codex-auditor APPROVED.
3. CS2 = Tasks 3–6 serial in one implement worktree (same file set); CS3 = Tasks 7–8; CS4 = Task 9 — CS2/CS3/CS4 in parallel worktrees, spawned in one turn; codex-auditor per changeset; `wt-consolidate`; merge CS2 first (brings `wt-merge.sh`), then CS3, CS4 via `wt-merge.sh`.
4. Docs-check green repo-wide + full bats suite green + advisor consulted before final done.

## Self-review notes

- Spec coverage: CS1→Tasks 1–2; CS2→Tasks 3–6; CS3→Tasks 7–8; CS4→Task 9; docs stage→Tasks 5–6; tooling preliminary→Tasks 3/5/8 manifest+bootstrap+tool-check. Vale rejection and worker-run stub: non-goals, no task — correct.
- Placeholders: none; all doctrine text and code inline. Bootstrap/tool-check edits reference "the file's existing per-tool pattern" deliberately — the pattern is in-tree and the exact lines depend on those files' current state.
- Type consistency: `wt-merge.sh RUN_ID ROLE [SLUG] [--commit]` and exit codes 3/4/5/7 match between Task 4 tests, implementation, and Task 6 doctrine; `foreman.docs-check.v1` schema matches between Task 5 script, tests, and Task 6 gate.
