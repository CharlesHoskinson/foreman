# FOREMAN_REPORT — lane-review-bundle rework (Council F1–F7)

**Status:** DONE  
**Mode:** soft  
**Scope:** `skills/foreman/scripts/lane-review-bundle.sh`, `tests/lane-review-bundle.bats`, `tests/baseline.tsv`  
**Git writes:** none (changes left uncommitted per constraint)

## Per-finding evidence

| ID | Finding | Fix | Evidence |
|---|---|---|---|
| **F1** | `base_is_ancestor_of_release: true` hardcoded | Renamed to `base_is_ancestor_of_head`; set only after `merge-base --is-ancestor` succeeds; bound with `--argjson`. Failure path still exits 3 with both SHAs and writes no bundle. | Script lines 41–47, 178, 188. Test 2 refuses unrelated root (no bundle). Old field name absent (`has("base_is_ancestor_of_release") \| not`). |
| **F2** | `files_changed` (porcelain) vs `round_diff` (range) mismatched | Replaced with `files_in_round` = `git diff --name-only -z base head` + untracked, and `worktree_dirty_files` = porcelain `-z -uall`. Names cannot be confused. | Test 8: clean worktree after commit → `files_in_round` contains `round-committed.txt`, `worktree_dirty=false`, dirty list length 0. |
| **F3** | `round_diff` folded carry-over into base-vs-tree | Committed section is `git diff base head` only; untracked under `=== NEW FILE ===`; dirty tracked under `=== UNCOMMITTED (not part of the committed round) ===`. | Test 9: committed section has round file, not carry marker; UNCOMMITTED section has carry marker. |
| **F4** | Truncation not in JSON | `truncated` (bool) and `diff_bytes` (pre-truncation size) always emitted via `--argjson`. | Test 12: 500000-byte file → `truncated=true`, `diff_bytes > 400000`, TRUNCATED marker in body. |
| **F5** | `sed 's/^...//'` mishandled renames/quotes | Porcelain and name lists use NUL (`-z`); renames take destination path from the second NUL field; no sed strip. | Test 10: rename → `new-name.txt` in `files_in_round`, no ` -> ` entry. Test 11: space and `"` paths survive. |
| **F6** | Tautological `\\` OR `backslash` assertion | Assert one backslash character and the exact payload fragment; no word-disjunct. | Test 5: `[[ "$actual" == *"\\"* ]]` and `*and \ backslash*`; both fail-capable. |
| **F7** | SPEC/FOREMAN listed but not shown | `_is_meta_path` filters body, `files_in_round`, and `worktree_dirty_files`. | Test 7: body and both lists exclude SPEC.md / FOREMAN_REPORT.md; real-output.txt remains. |

## Required tests (fail-capable)

1. **Committed → non-empty `files_in_round`** — test 8  
2. **UNCOMMITTED marker isolation** — test 9  
3. **Ancestor refuse (not constant true)** — test 2  
4. **Rename in `files_in_round`** — test 10  
5. **Space + double-quote paths** — test 11  
6. **`truncated` + `diff_bytes`** — test 12  

Baseline: `tests/lane-review-bundle.bats` expected_passes **7 → 12**.

## Verification

### `bats tests/lane-review-bundle.bats`

```
1..12
ok 1 worktree with uncommitted carry-over records round diff and worktree_dirty=true
ok 2 base that is not an ancestor of HEAD exits non-zero, names both SHAs, writes no bundle
ok 3 base ref that does not resolve exits 2
ok 4 worktree_dirty_files is a JSON array whose length matches porcelain entries
ok 5 diff with double quote and backslash round-trips through jq -r .round_diff
ok 6 new files appear in the bundle with their contents, not just their names
ok 7 the architect's spec and lane report are excluded from the bundle body and lists
ok 8 committed round work reports non-empty files_in_round (not just dirty porcelain)
ok 9 uncommitted carry-over appears under UNCOMMITTED marker, not in committed range
ok 10 renamed file appears correctly in files_in_round
ok 11 paths with spaces and double quotes survive in file lists and markers
ok 12 diff exceeding the cap sets truncated true and a diff_bytes value
```

exit 0

### `shellcheck -S warning skills/foreman/scripts/lane-review-bundle.sh`

(no output)

exit 0

## Bundle schema (after rework)

```json
{
  "base_sha": "<hex>",
  "head_sha": "<hex>",
  "round_diff": "<committed range + NEW FILE bodies + optional UNCOMMITTED section>",
  "files_in_round": ["..."],
  "worktree_dirty_files": ["..."],
  "worktree_dirty": true,
  "base_is_ancestor_of_head": true,
  "truncated": false,
  "diff_bytes": 0
}
```

JSON is always built with `jq -n` + `--rawfile` / `--argjson` / `--args`. No string concatenation of JSON.

## ARCHITECT_ACTIONS

1. **Exec bit:** `skills/foreman/scripts/lane-review-bundle.sh` is still mode `100644` (`-rw-r--r--`). Tests invoke it via `bash "$SCRIPTS/..."`, so they pass without +x. For install/PATH use and `tests/line-endings.bats` inventory, the architect must:

   ```bash
   chmod +x skills/foreman/scripts/lane-review-bundle.sh
   git update-index --chmod=+x skills/foreman/scripts/lane-review-bundle.sh
   ```

   (Lane constraint: NEVER run git write commands — left for architect.)

2. **Commit** the three scoped files when ready (lane left them uncommitted).

3. **Do not touch** `skills/foreman/scripts/lib/review-quorum.sh` (approved as-is).

## Files changed

- `skills/foreman/scripts/lane-review-bundle.sh` — reworked
- `tests/lane-review-bundle.bats` — 12 fail-capable tests
- `tests/baseline.tsv` — count 7 → 12
- `FOREMAN_REPORT.md` — this report
