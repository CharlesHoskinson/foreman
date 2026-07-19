#!/usr/bin/env bash
# @description PR stage (hard mode): once gate-eval.sh has recorded a PASS
#   decision, pushes the run's branch over HTTPS with a fine-grained GitHub
#   PAT (`FOREMAN_GH_PAT`, host-only — the worker never sees it) and opens a
#   DRAFT pull request via `gh pr create -F <body-file>`. The token reaches
#   git only through GIT_ASKPASS (a helper script git invokes and reads from
#   its own inherited env), never as a CLI argument, never via
#   `-c http.extraHeader=...` (which would put the base64 credential in
#   argv/`ps`/`/proc/*/cmdline` for any other local user to read). There is
#   NO ambient-credential fallback: no PAT means refuse outright, and origin
#   must already be an HTTPS github.com remote or this script refuses rather
#   than silently trying an SSH key or a cached credential helper. `gh pr
#   ready` is a deliberately separate, human-invoked step — never folded in
#   here.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/worktree.sh
source "$SCRIPT_DIR/lib/worktree.sh"

TASK_ID="${1:?usage: pr-open.sh TASK_ID}"
RD="$(run_dir "$TASK_ID")"
[[ -f "$RD/gate-decision.json" ]] || die "$EXIT_CONFIG" "run gate-eval.sh first"
[[ "$(jq -r .pass "$RD/gate-decision.json" 2>/dev/null || echo false)" == "true" ]] \
  || die "$EXIT_FAIL" "gate has not passed — refusing to open PR"

# require_cmd checks exactly one command per call (common.sh's $2 is an
# optional hint, not a second command) — two calls, not "require_cmd gh git".
require_cmd gh
require_cmd git

[[ -n "${FOREMAN_GH_PAT:-}" ]] \
  || die "$EXIT_FAIL" "FOREMAN_GH_PAT is not set — refusing to push/open a PR (no ambient-credential fallback)"

[[ -f "$RD/meta.json" ]] || die "$EXIT_CONFIG" "no such task: $TASK_ID (run task-new.sh first)"
WT="$(jq -r .worktree "$RD/meta.json")"
BRANCH="$(jq -r .branch "$RD/meta.json")"

# --- Origin must be HTTPS github.com — the fine-grained PAT is HTTPS-only.
# Refuse rather than let git fall back to an SSH key or an ambient/cached
# HTTPS credential helper for a remote this script never asserted.
ORIGIN_URL="$(git_nohooks -C "$WT" remote get-url origin)" \
  || die "$EXIT_CONFIG" "cannot resolve origin remote for worktree $WT"
[[ "$ORIGIN_URL" =~ ^https://([^@/[:space:]]+@)?github\.com/[^/[:space:]]+/[^/[:space:]]+(\.git)?/?$ ]] \
  || die "$EXIT_FAIL" "origin is not an HTTPS github.com remote ($ORIGIN_URL) — the PAT is HTTPS-only; refusing SSH/ambient credentials"

# --- PR body: prefer an already-written one; else synthesize from evidence
# + the task envelope so a draft PR always has a useful description.
BODY_FILE="$RD/pr-body.md"
if [[ ! -f "$BODY_FILE" ]]; then
  {
    printf '## Task %s\n\n' "$TASK_ID"
    if [[ -f "$RD/task.md" ]]; then
      cat "$RD/task.md"
      printf '\n'
    fi
    printf '## Diff summary\n\n```\n'
    if [[ -f "$RD/evidence/diff-stat.txt" ]]; then
      cat "$RD/evidence/diff-stat.txt"
    else
      printf '(no evidence/diff-stat.txt found)\n'
    fi
    printf '```\n'
  } > "$BODY_FILE"
fi

# --- Push over HTTPS with the PAT via GIT_ASKPASS (token stays out of argv).
# The helper is 0700 (owner-only) and answers ANY askpass prompt (username
# or password) with the token: GitHub's HTTPS basic auth accepts an
# arbitrary username paired with a PAT as the password, so one fixed answer
# satisfies both prompts.
ASKPASS="$RD/.askpass.sh"
# umask 077 so the helper is never group/other-readable, even for the instant
# between create and chmod; a trap removes it even if a signal lands between
# here and the explicit rm after the push.
trap 'rm -f "$ASKPASS"' EXIT
( umask 077; cat > "$ASKPASS" <<'EOF'
#!/usr/bin/env bash
# @description git askpass helper (pr-open.sh): answers any askpass prompt
#   with FOREMAN_GH_PAT, inherited from the parent process's environment —
#   the token is never passed as an argument to this script or to git.
printf '%s' "$FOREMAN_GH_PAT"
EOF
)
chmod 0700 "$ASKPASS"

# NOTE: the plan text describes this as "env GIT_ASKPASS=... git_nohooks
# ...", but git_nohooks is a shell FUNCTION (common.sh), not a PATH-
# resolvable executable — a literal `env ... git_nohooks ...` would fork
# `env`, which would then fail to exec a program named "git_nohooks" at
# all. Bash's own temporary-assignment-prefix form below achieves the
# identical effect (GIT_ASKPASS/GIT_TERMINAL_PROMPT set in the environment
# for the duration of this one command, inherited by every process it
# forks — including the real `git` binary git_nohooks itself execs) while
# actually calling the git_nohooks function, per this codebase's "all
# host-side git goes through git_nohooks" doctrine.
push_rc=0
GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0 \
  git_retry git_nohooks -C "$WT" push -u origin "$BRANCH" || push_rc=$?
rm -f "$ASKPASS"
[[ "$push_rc" -eq 0 ]] || die "$EXIT_FAIL" "push failed (rc=$push_rc)"

# --- Draft PR only — gh pr ready is a separate, human-invoked step.
GH_TOKEN="$FOREMAN_GH_PAT" gh pr create --draft --head "$BRANCH" --base main \
  -F "$BODY_FILE" > "$RD/pr-url.txt"

log "draft PR opened for $TASK_ID: $(cat "$RD/pr-url.txt")"
