### Task 6: Stop the plugin shipping without its headline feature

**Files:**
- Create: `tools/plugin-drift.sh`
- Create: `tests/plugin-drift.bats`
- Modify: `tests/baseline.tsv`, `tests/skip-budget.tsv`

**Not a CI gate, deliberately:** the installed-skill path does not exist on a hosted runner, so this runs locally and at release time. Registering it as a `ci-local` gate would make it fail on every CI run for a reason unrelated to the tree.

**Interfaces:**
- Consumes: nothing.
- Produces: `tools/plugin-drift.sh <installed-dir> <repo-skill-dir>` — exit 0 when no repo file is missing from the install, exit 1 otherwise, printing one `MISSING <relpath>` line per absent file.

**Why:** `~/.claude/skills/foreman` is a junction to `C:\Users\charl\foreman\skills\foreman`, the stale Windows checkout. It has no `ontology/`, no `fm-session.py`, no `lane-complete-check.sh`, no `graph-project.sh`. The installed plugin cannot do session recovery or ontology at all.

- [ ] **Step 1: Write the failing test**

Create `tests/plugin-drift.bats`:

```bash
#!/usr/bin/env bats
# @description Tests for tools/plugin-drift.sh, which fails when the installed
#   skill is missing files the repo ships. The installed plugin once lacked the
#   entire session store and ontology while reporting no problem at all.

setup() {
  DRIFT="$BATS_TEST_DIRNAME/../tools/plugin-drift.sh"
  REPO_SKILL="$BATS_TEST_TMPDIR/repo-skill"
  INSTALLED="$BATS_TEST_TMPDIR/installed"
  mkdir -p "$REPO_SKILL/scripts" "$REPO_SKILL/ontology" "$INSTALLED/scripts"
  echo a > "$REPO_SKILL/scripts/fm-session.py"
  echo b > "$REPO_SKILL/ontology/schema.sql"
  echo a > "$INSTALLED/scripts/fm-session.py"
}

@test "drift is detected when the install is missing a repo file" {
  run bash "$DRIFT" "$INSTALLED" "$REPO_SKILL"
  [ "$status" -eq 1 ]
  [[ "$output" == *"MISSING ontology/schema.sql"* ]]
}

@test "a complete install reports no drift" {
  mkdir -p "$INSTALLED/ontology"
  echo b > "$INSTALLED/ontology/schema.sql"
  run bash "$DRIFT" "$INSTALLED" "$REPO_SKILL"
  [ "$status" -eq 0 ]
  [[ "$output" == *"no drift"* ]]
}
```

The first test is the negative control: it proves the checker fires on a known-bad input.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /root/fm-wt/integrate && flock /tmp/foreman-bats.lock bats tests/plugin-drift.bats`
Expected: FAIL — both tests error, because `tools/plugin-drift.sh` does not exist.

- [ ] **Step 3: Write the checker**

Create `tools/plugin-drift.sh`:

```bash
#!/usr/bin/env bash
# @description Fail when the installed foreman skill is missing files the repo
#   ships. The installed plugin once lacked fm-session.py and the whole ontology
#   directory while nothing reported a problem.
# @arg $1 installed skill directory
# @arg $2 repo skill directory (skills/foreman)
# @exitcode 0 no drift; 1 drift found; 2 usage error
set -euo pipefail

installed="${1:-}"
repo="${2:-}"
if [[ -z "$installed" || -z "$repo" ]]; then
  echo "usage: plugin-drift.sh INSTALLED_DIR REPO_SKILL_DIR" >&2
  exit 2
fi
if [[ ! -d "$repo" ]]; then
  echo "not a directory: $repo" >&2
  exit 2
fi
if [[ ! -d "$installed" ]]; then
  echo "MISSING (entire install): $installed" >&2
  exit 1
fi

missing=0
while IFS= read -r rel; do
  if [[ ! -e "$installed/$rel" ]]; then
    echo "MISSING $rel"
    missing=$((missing + 1))
  fi
done < <(cd "$repo" && find . -type f -printf '%P\n' | sort)

if (( missing > 0 )); then
  echo "plugin-drift: $missing file(s) missing from the install"
  exit 1
fi
echo "plugin-drift: no drift"
```

Then: `chmod +x tools/plugin-drift.sh` and stage the mode with `git add --chmod=+x tools/plugin-drift.sh` — `git update-index --chmod=+x` followed by a plain `git add` silently reverts the mode.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /root/fm-wt/integrate && flock /tmp/foreman-bats.lock bats tests/plugin-drift.bats`
Expected: PASS, `2 tests, 0 failures`.

- [ ] **Step 5: Register the new test file in BOTH policy files**

Add to `tests/baseline.tsv` (literal TAB): `tests/plugin-drift.bats	2`

Add three rows to `tests/skip-budget.tsv` (literal TABs):

```
tests/plugin-drift.bats	linux	0
tests/plugin-drift.bats	wsl	0
tests/plugin-drift.bats	windows	0
```

Run: `cd /root/fm-wt/integrate && bash tools/ci-local.sh --quick`
Expected: `CI-LOCAL RESULT PASS gates_failed=0`, with no unregistered-file report.

- [ ] **Step 6: Run the checker against the real install and record the result**

```bash
cd /root/fm-wt/integrate
bash tools/plugin-drift.sh /mnt/c/Users/charl/.claude/skills/foreman skills/foreman
```

Expected: exit 1, listing `ontology/schema.sql`, `scripts/fm-session.py`,
`scripts/lane-complete-check.sh`, `scripts/graph-project.sh` among others.

```bash
python3 skills/foreman/scripts/fm-session.py measure \
  "installed plugin files missing vs repo" "<count from the run above>" \
  --command "bash tools/plugin-drift.sh /mnt/c/Users/charl/.claude/skills/foreman skills/foreman" \
  --scope skills/foreman \
  --scope tools/plugin-drift.sh
```

- [ ] **Step 7: Repoint the install at a current checkout**

The junction targets the stale `C:\Users\charl\foreman`. Update that checkout, then re-verify:

```powershell
git -C C:\Users\charl\foreman fetch origin
git -C C:\Users\charl\foreman status --short
git -C C:\Users\charl\foreman pull --ff-only origin main
```

If the pull is refused because that tree is dirty or divergent, STOP and report — do not force. Re-run Step 6; expect `plugin-drift: no drift`.

- [ ] **Step 8: Commit**

```bash
cd /root/fm-wt/integrate
git add tools/plugin-drift.sh tests/plugin-drift.bats tests/baseline.tsv tests/skip-budget.tsv
git -c user.name="Charles Hoskinson" -c user.email="charles.hoskinson@gmail.com" \
  commit -m "feat(install): fail when the installed skill is missing repo files

The installed plugin is a junction to a stale checkout with no ontology
directory and no fm-session.py, so session recovery and the ontology were
absent from the shipped product while nothing reported a problem. The first
test is the negative control: it proves the checker fires on a known-bad input."
python3 skills/foreman/scripts/fm-session.py close 24 --status done
```

---

