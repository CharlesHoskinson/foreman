#!/usr/bin/env bash
# @description Report lesson candidates and verify that the foreman-qa plugin
#   reflects the current release. Both subcommands are read-only and never
#   write to tracked files or any other repository path.
# @exitcode 0 clean
# @exitcode 1 findings
# @exitcode 2 harness error
set -euo pipefail

if ! SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"; then
  printf '%s\n' "plugin-lessons: cannot resolve script directory" >&2
  exit 2
fi
readonly SCRIPT_DIR

if ! PLUGIN_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"; then
  printf '%s\n' "plugin-lessons: cannot resolve plugin root" >&2
  exit 2
fi
readonly PLUGIN_ROOT

if ! REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)"; then
  printf '%s\n' "plugin-lessons: not in a git repository: $SCRIPT_DIR" >&2
  exit 2
fi
readonly REPO_ROOT

FINDING_COUNT=0

# @description Print command usage.
# @stdout accepted command forms
# @exitcode 0 always
usage() {
  printf '%s\n' \
    "Usage: plugin-lessons.sh candidates [SINCE_REF]" \
    "       plugin-lessons.sh check"
}

# @description Print a harness error and terminate.
# @arg $1 error text
# @stderr prefixed harness error
# @exitcode 2 always
harness_error() {
  printf 'plugin-lessons: %s\n' "$1" >&2
  exit 2
}

# @description Trim surrounding whitespace and strip one leading v or V.
# @arg $1 release value
# @stdout normalized release value
# @exitcode 0 always
normalize_release() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  case "$value" in
    v*|V*) value="${value:1}" ;;
  esac
  printf '%s\n' "$value"
}

# @description Record and print one staleness finding.
# @arg $1 finding text
# @stdout finding prefixed with FINDING
# @exitcode 0 always
record_finding() {
  FINDING_COUNT=$((FINDING_COUNT + 1))
  printf 'FINDING: %s\n' "$1"
}

# @description Report committed lesson candidates since a verified reference.
# @arg $1 optional commit-ish baseline
# @stdout four candidate sections and a summary
# @stderr harness errors
# @exitcode 0 no candidates
# @exitcode 1 candidates found
# @exitcode 2 harness error
run_candidates() {
  local since_ref="${1:-}"
  local diff_output="" line="" status="" path="" headline="" subject=""
  local count=0

  if [[ -n "$since_ref" ]]; then
    if ! git -C "$REPO_ROOT" rev-parse --verify "${since_ref}^{commit}" >/dev/null 2>&1; then
      harness_error "unresolvable ref: $since_ref"
    fi
  else
    if ! since_ref="$(git -C "$REPO_ROOT" describe --tags --abbrev=0 2>/dev/null)" || \
       [[ -z "$since_ref" ]]; then
      harness_error "no tags found; pass SINCE_REF explicitly"
    fi
  fi

  printf '%s\n' "== bugeventlog.md =="
  if ! diff_output="$(git -C "$REPO_ROOT" diff --unified=0 "$since_ref" HEAD -- bugeventlog.md)"; then
    harness_error "could not diff bugeventlog.md"
  fi
  while IFS= read -r line; do
    if [[ "$line" == '+## '* ]]; then
      printf '%s\n' "${line#+}"
      count=$((count + 1))
    fi
  done <<< "$diff_output"

  printf '%s\n' "== docs/incidents/ =="
  if ! diff_output="$(git -C "$REPO_ROOT" diff --name-status "$since_ref" HEAD -- docs/incidents/)"; then
    harness_error "could not diff docs/incidents/"
  fi
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    printf '%s\n' "$line"
    count=$((count + 1))
  done <<< "$diff_output"

  printf '%s\n' "== devlog/ =="
  if ! diff_output="$(git -C "$REPO_ROOT" diff --name-status "$since_ref" HEAD -- devlog/)"; then
    harness_error "could not diff devlog/"
  fi
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    printf '%s\n' "$line"
    count=$((count + 1))
    IFS=$'\t' read -r status path _ <<< "$line"
    if [[ "$status" == "A" ]]; then
      if ! diff_output="$(git -C "$REPO_ROOT" show "HEAD:$path")"; then
        harness_error "could not read committed devlog file: $path"
      fi
      headline=""
      while IFS= read -r subject; do
        if [[ "$subject" == '# '* ]]; then
          headline="$subject"
          break
        fi
      done <<< "$diff_output"
      if [[ -n "$headline" ]]; then
        printf '%s\n' "$headline"
        count=$((count + 1))
      fi
    fi
  done <<< "$diff_output"

  printf '%s\n' "== commits (fix|test|revert) =="
  if ! diff_output="$(git -C "$REPO_ROOT" log --format='%h %s' "${since_ref}..HEAD")"; then
    harness_error "could not read commit log"
  fi
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    subject="${line#* }"
    if [[ "${subject,,}" =~ fix|test|revert ]]; then
      printf '%s\n' "$line"
      count=$((count + 1))
    fi
  done <<< "$diff_output"

  printf 'plugin-lessons: %d candidate(s) found since %s\n' "$count" "$since_ref"
  if (( count > 0 )); then
    return 1
  fi
  return 0
}

# @description Check release currency and manifest skill paths.
# @stdout findings and final check summary
# @stderr harness errors
# @exitcode 0 no findings
# @exitcode 1 stale plugin findings
# @exitcode 2 harness error
run_check() {
  local current_release="" current_normalized="" lessons_path="$PLUGIN_ROOT/LESSONS.md"
  local manifest="$PLUGIN_ROOT/.claude-plugin/plugin.json"
  local row="" release="" normalized="" release_found=0
  local python_bin="" skill_entries="" entry="" resolved=""

  if ! current_release="$(git -C "$REPO_ROOT" describe --tags --abbrev=0 2>/dev/null)" || \
     [[ -z "$current_release" ]]; then
    harness_error "no tags found; release check requires a baseline"
  fi
  current_normalized="$(normalize_release "$current_release")"

  if [[ ! -f "$lessons_path" ]]; then
    record_finding "LESSONS.md not found: $lessons_path"
  else
    while IFS= read -r row; do
      [[ "$row" == \|* ]] || continue
      IFS='|' read -r _ release _ <<< "$row"
      normalized="$(normalize_release "$release")"
      [[ "$normalized" == "Release" ]] && continue
      [[ "$normalized" =~ ^-+$ ]] && continue
      if [[ "$normalized" == "$current_normalized" ]]; then
        release_found=1
      fi
    done < "$lessons_path"
    if (( release_found == 0 )); then
      record_finding "LESSONS.md has no entry for current release $current_release"
    fi
  fi

  if [[ ! -f "$manifest" ]]; then
    record_finding "manifest not found: $manifest"
  else
    python_bin="$(command -v python3 || command -v python || true)"
    if [[ -z "$python_bin" ]]; then
      harness_error "python3 or python is required to parse the manifest"
    fi
    if ! skill_entries="$("$python_bin" - "$manifest" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        document = json.load(handle)
except (OSError, json.JSONDecodeError):
    raise SystemExit(1)

if isinstance(document, dict):
    skills = document.get("skills")
    if isinstance(skills, list):
        for entry in skills:
            if isinstance(entry, str):
                print(entry)
PY
)"; then
      record_finding "manifest is not valid JSON: $manifest"
    else
      while IFS= read -r entry; do
        [[ -z "$entry" ]] && continue
        if [[ "$entry" == */* ]]; then
          resolved="$PLUGIN_ROOT/$entry"
        else
          resolved="$PLUGIN_ROOT/skills/$entry/SKILL.md"
        fi
        if [[ ! -e "$resolved" ]]; then
          record_finding "manifest skill entry missing: $entry -> $resolved"
        fi
      done <<< "$skill_entries"
    fi
  fi

  # Disk truth, not manifest truth. The manifest carries no skills key -- Claude
  # Code discovers skills by directory -- so the pass above iterates an empty
  # list and can only ever report clean. Deleting a skill was measured to leave
  # `check` green, which is the empty-selection failure this plugin's own
  # doctrine forbids.
  local skills_dir="$PLUGIN_ROOT/skills" skill_dir="" skill_count=0 skill_name=""
  if [[ ! -d "$skills_dir" ]]; then
    record_finding "skills directory not found: $skills_dir"
  else
    for skill_dir in "$skills_dir"/*/; do
      [[ -d "$skill_dir" ]] || continue
      skill_count=$((skill_count + 1))
      skill_name="$(basename "$skill_dir")"
      if [[ ! -f "$skill_dir/SKILL.md" ]]; then
        record_finding "skill has no SKILL.md: $skill_name"
        continue
      fi
      if [[ "$(head -n 1 "$skill_dir/SKILL.md")" != "---" ]]; then
        record_finding "skill SKILL.md has no frontmatter: $skill_name"
        continue
      fi
      if ! grep -qE "^name: ${skill_name}\$" "$skill_dir/SKILL.md"; then
        record_finding "skill frontmatter name does not match its directory: $skill_name"
      fi
    done
    # Fail closed on an empty selection. A check that ran over zero skills
    # carries no coverage information and must not report success.
    if (( skill_count == 0 )); then
      record_finding "no skills found under $skills_dir (empty selection is not a pass)"
    fi
  fi

  # Every skill the repository's own session instructions promise must exist.
  local claude_md="$REPO_ROOT/CLAUDE.md" promised=""
  if [[ -f "$claude_md" ]]; then
    while IFS= read -r promised; do
      [[ -z "$promised" ]] && continue
      if [[ ! -f "$PLUGIN_ROOT/skills/$promised/SKILL.md" ]]; then
        record_finding "CLAUDE.md names a skill that does not exist: $promised"
      fi
    done < <(grep -oE 'foreman-(testing|code-quality|qa-maintenance|qa)' "$claude_md" |
      sort -u)
  fi

  if (( FINDING_COUNT == 0 )); then
    printf 'plugin-lessons: check clean (release=%s, skills=%d)\n' \
      "$current_release" "$skill_count"
    return 0
  fi
  printf 'plugin-lessons: check found %d issue(s) (release=%s)\n' \
    "$FINDING_COUNT" "$current_release"
  return 1
}

# @description Validate arguments and dispatch one read-only subcommand.
# @arg $@ command arguments
# @stdout command report or usage
# @stderr argument and harness errors
# @exitcode 0 clean or help
# @exitcode 1 findings
# @exitcode 2 invalid arguments or harness error
main() {
  if (( $# == 1 )) && [[ "$1" == "-h" || "$1" == "--help" ]]; then
    usage
    return 0
  fi
  if (( $# == 0 )); then
    usage >&2
    return 2
  fi

  case "$1" in
    candidates)
      if (( $# > 2 )); then
        printf '%s\n' "plugin-lessons: candidates accepts at most one SINCE_REF" >&2
        return 2
      fi
      run_candidates "${2:-}"
      ;;
    check)
      if (( $# != 1 )); then
        printf '%s\n' "plugin-lessons: check accepts no arguments" >&2
        return 2
      fi
      run_check
      ;;
    *)
      printf 'plugin-lessons: unknown subcommand: %s\n' "$1" >&2
      usage >&2
      return 2
      ;;
  esac
}

main "$@"
