#!/usr/bin/env bats
# @description Tests for lane-review-bundle.sh — immutable one-round review
#   bundle so a reviewer never sees a stale base or cumulative worktree state.
bats_require_minimum_version 1.5.0
load helpers

setup() {
  setup_tmp_repo
  cd "$REPO"
  BUNDLE_OUT="$BATS_TEST_TMPDIR/bundle-out"
  mkdir -p "$BUNDLE_OUT"
}

@test "worktree with uncommitted carry-over records round diff and worktree_dirty=true" {
  base="$(git rev-parse HEAD)"
  echo carry > carry.txt          # uncommitted carry-over from an earlier round
  echo round > round.txt          # current round material

  run bash "$SCRIPTS/lane-review-bundle.sh" "$REPO" "$base" "$BUNDLE_OUT"
  [ "$status" -eq 0 ]
  [ -f "$BUNDLE_OUT/bundle.json" ]

  run jq -r '.worktree_dirty' "$BUNDLE_OUT/bundle.json"
  [ "$output" = "true" ]

  # Field is bound from the real is-ancestor check, not a hardcoded literal.
  run jq -r '.base_is_ancestor_of_head' "$BUNDLE_OUT/bundle.json"
  [ "$output" = "true" ]
  run jq -e 'has("base_is_ancestor_of_release") | not' "$BUNDLE_OUT/bundle.json"
  [ "$status" -eq 0 ]

  run jq -r '.base_sha' "$BUNDLE_OUT/bundle.json"
  [ "$output" = "$base" ]

  run jq -r '.head_sha' "$BUNDLE_OUT/bundle.json"
  [ "$output" = "$(git rev-parse HEAD)" ]

  # Bundle is present and self-describing even when the only changes are
  # untracked (git diff is empty for pure untracked carry-over).
  run jq -e 'has("round_diff") and has("files_in_round") and has("worktree_dirty_files")' \
    "$BUNDLE_OUT/bundle.json"
  [ "$status" -eq 0 ]

  run jq -e 'has("truncated") and has("diff_bytes")' "$BUNDLE_OUT/bundle.json"
  [ "$status" -eq 0 ]
}

@test "base that is not an ancestor of HEAD exits non-zero, names both SHAs, writes no bundle" {
  # Advance main so HEAD has history.
  echo next > next.txt
  git -c core.hooksPath= add next.txt
  git -c core.hooksPath= commit -qm next
  head_sha="$(git rev-parse HEAD)"

  # Unrelated second root — not an ancestor of HEAD.
  git checkout -q --orphan unrelated-root
  echo other > other.txt
  git -c core.hooksPath= add other.txt
  git -c core.hooksPath= commit -qm unrelated
  unrelated_sha="$(git rev-parse HEAD)"
  git checkout -q main

  rm -f "$BUNDLE_OUT/bundle.json"
  run bash "$SCRIPTS/lane-review-bundle.sh" "$REPO" "$unrelated_sha" "$BUNDLE_OUT"
  [ "$status" -ne 0 ]
  [ "$status" -ne 2 ]
  # Exact requirement: message names BOTH resolved SHAs.
  [[ "$output" == *"$unrelated_sha"* ]]
  [[ "$output" == *"$head_sha"* ]]
  [ ! -f "$BUNDLE_OUT/bundle.json" ]
  # F1: the failure path refuses rather than emitting a constant true field.
  # No bundle is written, so base_is_ancestor_of_head cannot be asserted true.
}

@test "base ref that does not resolve exits 2" {
  rm -f "$BUNDLE_OUT/bundle.json"
  run bash "$SCRIPTS/lane-review-bundle.sh" "$REPO" "refs/does-not-exist-xyz" "$BUNDLE_OUT"
  [ "$status" -eq 2 ]
  [ ! -f "$BUNDLE_OUT/bundle.json" ]
}

@test "worktree_dirty_files is a JSON array whose length matches porcelain entries" {
  base="$(git rev-parse HEAD)"
  # Isolate from setup_tmp_repo's untracked fixture copies so the porcelain
  # count is exactly the three files this test creates.
  WT="$BATS_TEST_TMPDIR/clean-wt"
  mkdir -p "$WT"
  git -C "$WT" init -q -b main
  git -C "$WT" config user.email t@e.com
  git -C "$WT" config user.name t
  echo base > "$WT/tracked.txt"
  git -C "$WT" -c core.hooksPath= add tracked.txt
  git -C "$WT" -c core.hooksPath= commit -qm base
  base="$(git -C "$WT" rev-parse HEAD)"
  echo a > "$WT/a.txt"
  echo b > "$WT/b.txt"
  echo c > "$WT/c.txt"
  porcelain_n="$(git -C "$WT" status --porcelain | wc -l | tr -d ' ')"
  [ "$porcelain_n" = "3" ]

  run bash "$SCRIPTS/lane-review-bundle.sh" "$WT" "$base" "$BUNDLE_OUT"
  [ "$status" -eq 0 ]

  run jq -r '.worktree_dirty_files | type' "$BUNDLE_OUT/bundle.json"
  [ "$output" = "array" ]

  run jq -r '.worktree_dirty_files | length' "$BUNDLE_OUT/bundle.json"
  [ "$output" = "$porcelain_n" ]
  [ "$output" = "3" ]

  # Exact membership — array of the three paths, order matches porcelain.
  run jq -c '.worktree_dirty_files' "$BUNDLE_OUT/bundle.json"
  [ "$output" = '["a.txt","b.txt","c.txt"]' ]
}

@test "diff with double quote and backslash round-trips through jq -r .round_diff" {
  base="$(git rev-parse HEAD)"
  # Modify a tracked file so git diff produces content (untracked alone does not).
  printf 'line with "quote" and \\ backslash\n' > README.md

  run bash "$SCRIPTS/lane-review-bundle.sh" "$REPO" "$base" "$BUNDLE_OUT"
  [ "$status" -eq 0 ]

  expected="$(git diff HEAD -- .)"
  actual="$(jq -r '.round_diff' "$BUNDLE_OUT/bundle.json")"
  # Uncommitted tracked edits live under the UNCOMMITTED marker, not the
  # committed-range section (base==HEAD here, so the committed prefix is empty).
  [[ "$actual" == *"=== UNCOMMITTED (not part of the committed round) ==="* ]]
  [[ "$actual" == *"$expected"* ]] || [[ "$actual" == *"line with \"quote\" and \\ backslash"* ]]
  # Explicit markers must survive (this is why jq --rawfile is mandatory).
  # Each assertion is independently fail-capable (no tautological OR on a
  # fixture word). The file contains one backslash; require that character,
  # not the word "backslash" and not a doubled escape.
  [[ "$actual" == *'"quote"'* ]]
  [[ "$actual" == *"\\"* ]]
  [[ "$actual" == *'and \ backslash'* ]]
}

@test "new files appear in the bundle with their contents, not just their names" {
  base="$(git rev-parse HEAD)"
  # A lane whose whole deliverable is new files produced a 1092-byte bundle of
  # filenames with no content, because git diff shows nothing for untracked
  # paths. Reviewers were asked to judge four new scripts they could not see.
  printf 'echo "brand new content marker"\n' > newly-added.sh

  run bash "$SCRIPTS/lane-review-bundle.sh" "$REPO" "$base" "$BUNDLE_OUT"
  [ "$status" -eq 0 ]

  actual="$(jq -r '.round_diff' "$BUNDLE_OUT/bundle.json")"
  [[ "$actual" == *"=== NEW FILE: newly-added.sh ==="* ]]
  [[ "$actual" == *"brand new content marker"* ]]

  run jq -r '.files_in_round[]' "$BUNDLE_OUT/bundle.json"
  [[ "$output" == *"newly-added.sh"* ]]
}

@test "the architect's spec and lane report are excluded from the bundle body and lists" {
  base="$(git rev-parse HEAD)"
  printf 'architect spec, not lane output\n' > SPEC.md
  printf 'lane report, not lane output\n' > FOREMAN_REPORT.md
  printf 'real lane output\n' > real-output.txt

  run bash "$SCRIPTS/lane-review-bundle.sh" "$REPO" "$base" "$BUNDLE_OUT"
  [ "$status" -eq 0 ]

  actual="$(jq -r '.round_diff' "$BUNDLE_OUT/bundle.json")"
  [[ "$actual" != *"architect spec, not lane output"* ]]
  [[ "$actual" != *"lane report, not lane output"* ]]
  [[ "$actual" == *"real lane output"* ]]

  # F7: lists must not name what the body deliberately omits.
  run jq -r '.files_in_round[]' "$BUNDLE_OUT/bundle.json"
  [[ "$output" != *"SPEC.md"* ]]
  [[ "$output" != *"FOREMAN_REPORT.md"* ]]
  [[ "$output" == *"real-output.txt"* ]]

  run jq -r '.worktree_dirty_files[]' "$BUNDLE_OUT/bundle.json"
  [[ "$output" != *"SPEC.md"* ]]
  [[ "$output" != *"FOREMAN_REPORT.md"* ]]
  [[ "$output" == *"real-output.txt"* ]]
}

# --- Council rework findings: each assertion must be able to fail ----------

@test "committed round work reports non-empty files_in_round (not just dirty porcelain)" {
  # F2: a fully committed round must surface in files_in_round even when the
  # worktree is clean (porcelain empty → old files_changed was []).
  # Isolate from setup_tmp_repo's untracked fixture copies (.markdownlint etc).
  WT="$BATS_TEST_TMPDIR/committed-wt"
  mkdir -p "$WT"
  git -C "$WT" init -q -b main
  git -C "$WT" config user.email t@e.com
  git -C "$WT" config user.name t
  echo base > "$WT/tracked.txt"
  git -C "$WT" -c core.hooksPath= add tracked.txt
  git -C "$WT" -c core.hooksPath= commit -qm base
  echo committed-round > "$WT/round-committed.txt"
  git -C "$WT" -c core.hooksPath= add round-committed.txt
  git -C "$WT" -c core.hooksPath= commit -qm 'round work'
  base="$(git -C "$WT" rev-parse HEAD~1)"
  head_sha="$(git -C "$WT" rev-parse HEAD)"

  # Worktree is clean after the commit.
  [ -z "$(git -C "$WT" status --porcelain)" ]

  run bash "$SCRIPTS/lane-review-bundle.sh" "$WT" "$base" "$BUNDLE_OUT"
  [ "$status" -eq 0 ]

  run jq -r '.files_in_round | length' "$BUNDLE_OUT/bundle.json"
  [ "$output" -ge 1 ]

  run jq -r '.files_in_round[]' "$BUNDLE_OUT/bundle.json"
  [[ "$output" == *"round-committed.txt"* ]]

  run jq -r '.worktree_dirty' "$BUNDLE_OUT/bundle.json"
  [ "$output" = "false" ]

  run jq -r '.worktree_dirty_files | length' "$BUNDLE_OUT/bundle.json"
  [ "$output" = "0" ]

  run jq -r '.head_sha' "$BUNDLE_OUT/bundle.json"
  [ "$output" = "$head_sha" ]

  actual="$(jq -r '.round_diff' "$BUNDLE_OUT/bundle.json")"
  [[ "$actual" == *"round-committed.txt"* ]]
  [[ "$actual" == *"committed-round"* ]]
}

@test "uncommitted carry-over appears under UNCOMMITTED marker, not in committed range" {
  # F3: dirty carry-over must not be folded into the base..HEAD committed diff.
  echo round-body > round-file.txt
  git -c core.hooksPath= add round-file.txt
  git -c core.hooksPath= commit -qm 'committed round'
  base="$(git rev-parse HEAD~1)"

  # Uncommitted edit to a pre-existing tracked file (carry-over).
  printf 'uncommitted-carry-MARKER\n' > README.md

  run bash "$SCRIPTS/lane-review-bundle.sh" "$REPO" "$base" "$BUNDLE_OUT"
  [ "$status" -eq 0 ]

  actual="$(jq -r '.round_diff' "$BUNDLE_OUT/bundle.json")"
  [[ "$actual" == *"=== UNCOMMITTED (not part of the committed round) ==="* ]]
  [[ "$actual" == *"uncommitted-carry-MARKER"* ]]

  # Split on the marker: committed section must contain the round file and
  # must NOT contain the carry-over marker.
  committed_section="${actual%%=== UNCOMMITTED (not part of the committed round) ===*}"
  uncommitted_section="${actual#*=== UNCOMMITTED (not part of the committed round) ===}"
  [[ "$committed_section" == *"round-file.txt"* ]]
  [[ "$committed_section" != *"uncommitted-carry-MARKER"* ]]
  [[ "$uncommitted_section" == *"uncommitted-carry-MARKER"* ]]
}

@test "renamed file appears correctly in files_in_round" {
  # F5: porcelain sed 's/^...//' mishandled renames; name-only -z must not.
  echo original > old-name.txt
  git -c core.hooksPath= add old-name.txt
  git -c core.hooksPath= commit -qm 'add old'
  base="$(git rev-parse HEAD)"
  git -c core.hooksPath= mv old-name.txt new-name.txt
  git -c core.hooksPath= commit -qm 'rename'

  run bash "$SCRIPTS/lane-review-bundle.sh" "$REPO" "$base" "$BUNDLE_OUT"
  [ "$status" -eq 0 ]

  run jq -r '.files_in_round[]' "$BUNDLE_OUT/bundle.json"
  [[ "$output" == *"new-name.txt"* ]]
  # Destination must be listed; a mangled "old-name.txt -> new-name.txt" string
  # must not appear as a single path entry.
  run jq -r '.files_in_round[] | select(test(" -> "))' "$BUNDLE_OUT/bundle.json"
  [ -z "$output" ]
}

@test "paths with spaces and double quotes survive in file lists and markers" {
  base="$(git rev-parse HEAD)"
  mkdir -p "dir with space"
  printf 'space path body\n' > "dir with space/file name.txt"
  # Linux allows double quotes in filenames; the old sed strip mishandled
  # git-quoted paths that wrap such names.
  printf 'quote path body\n' > 'file"quote".txt'

  run bash "$SCRIPTS/lane-review-bundle.sh" "$REPO" "$base" "$BUNDLE_OUT"
  [ "$status" -eq 0 ]

  run jq -r '.files_in_round[]' "$BUNDLE_OUT/bundle.json"
  [[ "$output" == *"dir with space/file name.txt"* ]]
  [[ "$output" == *'file"quote".txt'* ]]

  run jq -r '.worktree_dirty_files[]' "$BUNDLE_OUT/bundle.json"
  [[ "$output" == *"dir with space/file name.txt"* ]]
  [[ "$output" == *'file"quote".txt'* ]]

  actual="$(jq -r '.round_diff' "$BUNDLE_OUT/bundle.json")"
  [[ "$actual" == *'=== NEW FILE: dir with space/file name.txt ==='* ]]
  [[ "$actual" == *'=== NEW FILE: file"quote".txt ==='* ]]
  [[ "$actual" == *"space path body"* ]]
  [[ "$actual" == *"quote path body"* ]]
}

@test "diff exceeding the cap sets truncated true and a diff_bytes value" {
  base="$(git rev-parse HEAD)"
  # >400000 bytes of untracked content forces the truncate path.
  python3 -c 'open("huge-round.txt","w").write("X" * 500000)'

  run bash "$SCRIPTS/lane-review-bundle.sh" "$REPO" "$base" "$BUNDLE_OUT"
  [ "$status" -eq 0 ]

  run jq -r '.truncated' "$BUNDLE_OUT/bundle.json"
  [ "$output" = "true" ]

  run jq -r '.diff_bytes' "$BUNDLE_OUT/bundle.json"
  # Pre-truncation size must exceed the cap (fail-capable: not a constant).
  [ "$output" -gt 400000 ]

  actual="$(jq -r '.round_diff' "$BUNDLE_OUT/bundle.json")"
  [[ "$actual" == *"=== TRUNCATED: bundle exceeded 400000 bytes ==="* ]]
}
