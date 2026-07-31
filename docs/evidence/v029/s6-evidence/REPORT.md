# REPORT — evidence-contracts T1 (evidence mechanism)

Scope: T1 only (`lib/evidence.sh` + verification). No git commit. No graphify.
Primary harness: `tests/probes/evidence-mechanism.sh` (16/16 PASS, exit 0).
Bats wrapper: `tests/evidence.bats` (gated via `flock /tmp/foreman-bats.lock`).

---

## 1. Implement `skills/foreman/scripts/lib/evidence.sh`

**Status:** DONE

**Deliverable:** `skills/foreman/scripts/lib/evidence.sh` (owned by
`evidence-contracts`; shared canonical record for `three-outcome-verdicts`
`tree_sha256`).

**API (T1):**

| Function | Role |
|---|---|
| `evidence_canonical_record_to ROOT REL OUT` | one record `path\0state\0mode\0hash\n` |
| `evidence_content_digest ROOT work\|artifact DELIV…` | deliverable-set content digest |
| `evidence_path_level_digest ROOT` | porcelain corroborating signal (`-uall`) |
| `evidence_legacy_porcelain_digest ROOT` | known-bad control (no `-uall`) |
| `evidence_records_to ROOT kind OUT DELIV…` | raw sorted records blob |
| `EVIDENCE_STATUS_ARGV` | `status --porcelain=v1 -z -uall --no-renames` |

**Encoding:** sorted bytewise-ascending by path; states `f`/`l`/`d`/`-` exactly
as BRIEF/spec. Absent is a recorded value. Unreadable → `UNCOMPUTABLE` (not
absent). Work root must be a git *toplevel* (not merely inside a repo);
artifact root need not be git.

**Header** documents blind spots (a) and (b) citing `bugeventlog.md` 2026-07-28
ROOT CAUSE entry.

**NUL safety:** porcelain `-z` and records never pass through bash
`$(…)` (strips NULs); always file-backed.

**Command / observed:**

```text
$ shellcheck -x skills/foreman/scripts/lib/evidence.sh; echo SHELLCHECK:$?
SHELLCHECK:0

$ bash tests/probes/evidence-mechanism.sh
--- summary: 16 passed, 0 failed ---
```

---

## 2. Untracked-directory collapse (central claim)

**Status:** DONE

**Command:**

```bash
bash tests/probes/evidence-mechanism.sh
# case 1 — fixtures under $LOG_DIR/repo-collapse
```

**ACTUAL observed output** (`tests/probes/evidence-out/cases/case1-collapse.txt`):

```text
legacy_1=48d0a92c98ebabefa1a953e961f5c1dcb571e3d2aad1775a3788203a62617177
legacy_2=48d0a92c98ebabefa1a953e961f5c1dcb571e3d2aad1775a3788203a62617177
content_1=8a72c7a27ac16abf88e4ef8a6f19a7d3074d407e6a8ce647542e8f1947b05b11
content_2=bbf43c0f4c8d4f0ad68ed0bc5bbc177c28bdf60cbb072a351eb5ac4a3d77516a
porcelain_no_uall:
?? pkg/
porcelain_uall:
?? pkg/a.md
?? pkg/b.md
?? pkg/c.md
?? pkg/d.md
```

**Known-bad (must FAIL):** legacy `git status --porcelain | sha256sum` without
`-uall` → `legacy_1 == legacy_2` (identical). **Observed FAIL of the old
predicate: PASS of the control.**

**Our digest:** `content_1 != content_2`. **Observed distinguish: PASS.**

---

## 3. Deletion changes the digest

**Status:** DONE

**ACTUAL observed** (`case2-deletion.txt`):

```text
before=dc08fadf244b8f17e65cb908c0332ab0774c2f917e6cb5ec9434820a32f660f3
after=b5c1d8c82d641b4e11496cc5833c630e52a55eecb3da049b360c23491879581e
records_readable=tracked.txt|-|000000|0000000000000000000000000000000000000000000000000000000000000000
 D tracked.txt
```

`before != after`. Absent-state record present (`-` / `000000` / 64 zeros).

---

## 4. Rename decomposes into absent + present

**Status:** DONE

**ACTUAL observed** (`case3-rename.txt`):

```text
before=c7009fb0afbbf6c0f99d7e421613d5488c68bbabcc4188f60dea2eb32c3c16ea
after=3dc7088b331de88764281f993069da63a0ce57262a609bbf288a1ef9cc793d55
records:
path='newname.txt' state='f' mode='100644' hash=9e2ec912af5dff2a...
path='oldname.txt' state='-' mode='000000' hash=0000000000000000...
status:
A  newname.txt
D  oldname.txt
```

Under `--no-renames`, status is `D old` + `A new`; records are absent(old) +
present(new). Digests differ.

---

## 5. Unreadable path yields UNCOMPUTABLE, not absent

**Status:** DONE

Root bypasses `chmod 000`, so the control runs the digest as `nobody` against a
mode-000 file (real `Permission denied` on `sha256sum`).

**ACTUAL observed** (`case4-unreadable.txt`):

```text
EVIDENCE_STATUS=UNCOMPUTABLE
EVIDENCE_REASON=unreadable-path:secret.txt
rc=1
```

True-absent path for `missing.txt` remains `EVIDENCE_STATUS=OK` with
absent-state encoding (digest
`ac273484895322c2f6d390c56b0cb3d079e096244b437d679a482663ba38a68b`).

**Known-bad rejected:** encoding unreadable as absent would make these collide;
observed statuses differ (`UNCOMPUTABLE` vs `OK`).

Call-site comment in `evidence_canonical_record_to` documents the rule.

---

## 6. Non-git work root INCONCLUSIVE vs non-git artifact root OK

**Status:** DONE

**ACTUAL observed** (`case5-roots.txt`):

```text
artifact_status=OK
artifact_digest=59ab8301d37af7cc628977b537194200e22d7ed60025cd9de8510bc01b448bd6
artifact_rc=0
artifact_reason=
work_status=INCONCLUSIVE
work_reason=non-git-work-root:/tmp/evidence-verify-1936735/run/work-root-nongit
work_rc=1
```

**Both halves asserted.** Known-bad "reject any non-git root" is rejected
because the artifact root succeeded.

**Implementation note fixed during verification:** `evidence_is_git_worktree`
requires `rev-parse --show-toplevel` to equal the root (not merely
`--is-inside-work-tree`), so a fixture directory nested under another checkout
is not misclassified as a work root.

---

## 7. Content change with unchanged status string

**Status:** DONE

**ACTUAL observed** (`case6-content.txt`):

```text
path1=69ab020d705dc28564c32ee492409ada3181fba9a12a193747517396c9556812
path2=69ab020d705dc28564c32ee492409ada3181fba9a12a193747517396c9556812
content1=0e505578b32f2757baa6223b56e0c91990f482ef18c2cb852c9aff4afa0192b7
content2=f8da83b97c1809b787380a4d2f9740e5d9bc8dee2f6e412ea27a636f829e9c97
status_v1_and_v2 both:
?? pkg/a.md
```

**Known-bad:** path-level digest with `-uall` still blind → `path1 == path2`.
**Content digest:** `content1 != content2`. Blind spot (b) demonstrated.

---

## 8. shellcheck clean

**Status:** DONE

**Command:**

```bash
shellcheck -x skills/foreman/scripts/lib/evidence.sh
```

**ACTUAL observed:** exit 0, no findings.

---

## 9. Harness exits non-zero when any case fails

**Status:** DONE

**Two independent proofs:**

### 9a. Built-in meta child (`EVIDENCE_PROBE_META=1`)

```text
child_rc=1
| FAIL: forced-known-bad — synthetic failure for exit-code proof
| --- summary: 0 passed, 1 failed ---
PASS: harness exits non-zero when a case fails (child rc=1)
```

### 9b. Injected `FAIL_CASE=1`

```bash
FAIL_CASE=1 bash tests/probes/evidence-mechanism.sh; echo EXIT:$?
```

**ACTUAL observed** (`tests/probes/evidence-out/fail-case.txt` tail):

```text
FAIL: FAIL_CASE — injected failure
--- summary: 16 passed, 1 failed ---
EXIT:1
```

Harness never exits 0 while printing FAIL.

---

## Full harness run (canonical)

```bash
bash tests/probes/evidence-mechanism.sh
# --- summary: 16 passed, 0 failed ---  (exit 0)  [reconfirmed FINAL_PROBE:0]
```

**Flags asserted:** `EVIDENCE_STATUS_ARGV=status --porcelain=v1 -z -uall --no-renames`

**Bats wrapper:** `tests/evidence.bats` exists and is intended to run as
`flock /tmp/foreman-bats.lock bats tests/evidence.bats`. On this host the
lock was held for the full duration of the round by a concurrent lane's full
`tests/run.sh` suite (`s1-lock-L4`, PID ~1900281). Stated blocker — not a
fabricated pass. The probe harness is the authoritative T1 evidence and was
observed green (16/16) plus FAIL_CASE exit 1.

**OpenSpec:** `/usr/local/bin/openspec validate evidence-contracts --strict`
→ `Change 'evidence-contracts' is valid`.

**No git commit** (per BRIEF).

---

## Out of scope (later rounds)

T2 lane-type contracts, T3 inconclusive-as-mechanism loop, T4 planted-write
control corpus wiring into release suite, T5 mutation probe, T6 packaging gate
— not implemented here per BRIEF.
