#!/usr/bin/env bats
load helpers

setup() {
  setup_tmp_repo
  cd "$REPO"
}

create_matching_fixture() {
  mkdir -p skills/fixskill
  printf 'fixture\n' > skills/fixskill/file.txt
  local hash
  hash="$(find skills/fixskill -type f -print0 | sort -z | while IFS= read -r -d '' f; do printf '%s\0' "$f"; tr -d '\r' < "$f"; done | sha256sum | cut -d' ' -f1)"
  cat > skills/VENDORED.md <<EOF
| Skill | Upstream | Vendored | License | Content hash |
|---|---|---|---|---|
| fixskill | local fixture | 2026-07-15 | test | $hash |
EOF
}

@test "maintenance upstream reports ok across line endings, drift after content modified" {
  create_matching_fixture

  run bash "$SCRIPTS/maintenance.sh" --stage upstream
  [ "$status" -eq 0 ]
  grep -Eq 'fixskill.*ok' <<< "$output"
  ! grep -Eq 'fixskill.*drift' <<< "$output"

  printf 'fixture\r\n' > skills/fixskill/file.txt
  run bash "$SCRIPTS/maintenance.sh" --stage upstream
  [ "$status" -eq 0 ]
  grep -Eq 'fixskill.*ok' <<< "$output"
  ! grep -Eq 'fixskill.*drift' <<< "$output"

  printf x >> skills/fixskill/file.txt
  run bash "$SCRIPTS/maintenance.sh" --stage upstream
  [ "$status" -eq 0 ]
  grep -Eq 'fixskill.*drift' <<< "$output"
}

@test "--strict exits 3 on drift, 0 without --strict" {
  create_matching_fixture
  printf x >> skills/fixskill/file.txt

  run bash "$SCRIPTS/maintenance.sh" --strict --stage upstream
  [ "$status" -eq 3 ]

  run bash "$SCRIPTS/maintenance.sh" --stage upstream
  [ "$status" -eq 0 ]
}

@test "--stage graph reports skipped when graphify/graph.json absent" {
  run bash "$SCRIPTS/maintenance.sh" --stage graph
  [ "$status" -eq 0 ]
  grep -q 'skipped' <<< "$output"
}

@test "--json writes schema foreman.maintenance.v1 with all three stage keys" {
  create_matching_fixture

  run bash "$SCRIPTS/maintenance.sh" --stage all --json out.json
  [ "$status" -eq 0 ]
  [ -f out.json ]
  grep -q 'foreman.maintenance.v1' out.json
  grep -q '"upstream"' out.json
  grep -q '"graph"' out.json
  grep -q '"compat"' out.json
}

@test "upstream reports drift and strict exits 3 when a listed skill directory is missing" {
  mkdir -p skills
  cat > skills/VENDORED.md <<'EOF'
| Skill | Upstream | Vendored | License | Content hash |
|---|---|---|---|---|
| missingskill | local fixture | 2026-07-15 | test | unused |
EOF

  run bash "$SCRIPTS/maintenance.sh" --stage upstream
  [ "$status" -eq 0 ]
  grep -q 'maintenance upstream: drift' <<< "$output"
  grep -q 'missingskill.*listed in VENDORED.md but directory missing' <<< "$output"

  run bash "$SCRIPTS/maintenance.sh" --stage upstream --strict
  [ "$status" -eq 3 ]
}

@test "upstream rejects invalid skill names without escaping the fixture repo" {
  mkdir -p skills
  cat > skills/VENDORED.md <<'EOF'
| Skill | Upstream | Vendored | License | Content hash |
|---|---|---|---|---|
| ../../evil | local fixture | 2026-07-15 | test | unused |
EOF

  run bash "$SCRIPTS/maintenance.sh" --stage upstream
  [ "$status" -eq 0 ]
  grep -q 'maintenance upstream: drift' <<< "$output"
  grep -q '../../evil.*invalid skill name' <<< "$output"
  [ ! -e "$BATS_TEST_TMPDIR/evil" ]
}

@test "upstream apply rejects dot skill name without wiping the skills tree" {
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME/.claude/skills" skills
  printf 'sentinel content\n' > skills/sentinel.txt
  cat > skills/VENDORED.md <<'EOF'
| Skill | Upstream | Vendored | License | Content hash |
|---|---|---|---|---|
| . | local fixture | 2026-07-15 | test | unused |
EOF

  run bash "$SCRIPTS/maintenance.sh" --stage upstream --apply
  [ "$status" -eq 0 ]
  grep -q 'maintenance upstream: drift' <<< "$output"
  grep -Fq '.: drift - invalid skill name' <<< "$output"
  [ -f skills/sentinel.txt ]
  [ "$(cat skills/sentinel.txt)" = "sentinel content" ]
}

@test "upstream apply replaces vendored content strips overlays and updates the hash" {
  export HOME="$BATS_TEST_TMPDIR/home"
  local source="$HOME/.claude/skills/applyskill"
  mkdir -p "$source/.git" skills/applyskill
  printf 'keep version one\n' > "$source/keep.txt"
  printf 'delete upstream later\n' > "$source/delete.txt"
  printf 'git metadata\n' > "$source/.git/config"
  printf 'local overlay\n' > "$source/notes.local.md"

  cp -R "$source/." skills/applyskill/
  find skills/applyskill -depth -type d -name .git -exec rm -rf -- {} +
  find skills/applyskill -type f -name '*.local.md' -delete
  local old_hash
  old_hash="$(find skills/applyskill -type f -print0 | sort -z | while IFS= read -r -d '' f; do printf '%s\0' "$f"; tr -d '\r' < "$f"; done | sha256sum | cut -d' ' -f1)"
  cat > skills/VENDORED.md <<EOF
| Skill | Upstream | Vendored | License | Content hash |
|---|---|---|---|---|
| applyskill | local fixture | 2026-07-15 | test | $old_hash |
EOF

  rm "$source/delete.txt"
  printf 'keep version two\n' > "$source/keep.txt"

  run bash "$SCRIPTS/maintenance.sh" --stage upstream --apply
  [ "$status" -eq 0 ]
  [ ! -e skills/applyskill/delete.txt ]
  [ ! -e skills/applyskill/.git ]
  [ ! -e skills/applyskill/notes.local.md ]

  local new_hash recorded_hash
  new_hash="$(find skills/applyskill -type f -print0 | sort -z | while IFS= read -r -d '' f; do printf '%s\0' "$f"; tr -d '\r' < "$f"; done | sha256sum | cut -d' ' -f1)"
  recorded_hash="$(awk -F'|' '$2 ~ /applyskill/ { value=$(NF - 1); gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); print value }' skills/VENDORED.md)"
  [ "$recorded_hash" != "$old_hash" ]
  [ "$recorded_hash" = "$new_hash" ]

  run bash "$SCRIPTS/maintenance.sh" --stage upstream
  [ "$status" -eq 0 ]
  grep -q 'maintenance upstream: ok' <<< "$output"
  grep -q 'applyskill.*ok' <<< "$output"
  ! grep -q 'applyskill.*drift' <<< "$output"
}
