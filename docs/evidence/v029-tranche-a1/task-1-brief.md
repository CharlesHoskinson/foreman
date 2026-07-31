### Task 1: Recover the stranded defect ledger

**Files:**
- Modify: `bugeventlog.md` (in `/root/fm-wt/integrate`)
- Read-only source: stage 3 of `bugeventlog.md` in `/root/foreman`'s damaged index

**Interfaces:**
- Consumes: nothing.
- Produces: a `bugeventlog.md` in `integrate` containing every `## ` heading from both inputs. Every later task appends to this file.

**Why this is first:** 960 lines exist only in an unmerged index entry. Any `git reset --hard`, `git checkout` or `git clean` in `/root/foreman` destroys them permanently.

- [ ] **Step 1: Extract both sides and prove the claim before changing anything**

```bash
cd /root/foreman
git show :3:bugeventlog.md > /tmp/ledger-theirs.md
wc -l /tmp/ledger-theirs.md                      # expect 2604
wc -l /root/fm-wt/integrate/bugeventlog.md       # expect 1668
diff /root/fm-wt/integrate/bugeventlog.md /tmp/ledger-theirs.md | grep -c '^>'   # expect 960
diff /root/fm-wt/integrate/bugeventlog.md /tmp/ledger-theirs.md | grep -c '^<'   # expect 24
```

Expected: `2604`, `1668`, `960`, `24`. If any number differs, STOP and re-audit — the tree has changed since this plan was written.

- [ ] **Step 2: Capture the heading inventory of both sides**

```bash
grep '^## ' /root/fm-wt/integrate/bugeventlog.md | sort -u > /tmp/head-main.txt
grep '^## ' /tmp/ledger-theirs.md               | sort -u > /tmp/head-theirs.txt
wc -l /tmp/head-main.txt /tmp/head-theirs.txt
comm -23 /tmp/head-main.txt /tmp/head-theirs.txt    # headings ONLY on main
comm -13 /tmp/head-main.txt /tmp/head-theirs.txt    # headings ONLY in the damaged index
```

Record both `comm` outputs — they are the acceptance criteria for Step 4.

- [ ] **Step 3: Build the union, newest-side as the base**

The ledger is append-only and chronological. `/tmp/ledger-theirs.md` is the newer, longer side and already contains the older content, so it is the base. Re-insert only the headings `comm -23` reported as main-only, each with its section body, in date order.

```bash
cd /root/fm-wt/integrate
cp /tmp/ledger-theirs.md bugeventlog.union.md
# For each heading listed by `comm -23` in Step 2, copy its section from
# bugeventlog.md into bugeventlog.union.md at the position matching its date.
# Sections run from their '## ' line to the line before the next '## '.
```

- [ ] **Step 4: Verify the union loses nothing**

```bash
cd /root/fm-wt/integrate
grep '^## ' bugeventlog.union.md | sort -u > /tmp/head-union.txt
comm -23 /tmp/head-main.txt   /tmp/head-union.txt    # MUST be empty
comm -23 /tmp/head-theirs.txt /tmp/head-union.txt    # MUST be empty
```

Expected: both commands print nothing. A non-empty result means a section was dropped — fix before continuing. This is the negative control for this task: it fails loudly if the union is lossy.

- [ ] **Step 5: Install the union and commit**

```bash
cd /root/fm-wt/integrate
tr -d '\r' < bugeventlog.union.md > bugeventlog.md
rm bugeventlog.union.md
git add bugeventlog.md
git -c user.name="Charles Hoskinson" -c user.email="charles.hoskinson@gmail.com" \
  commit -m "docs(ledger): recover 960 stranded bugeventlog lines from the damaged index

The 2026-07-30 run — eleven named defect events plus a 2026-07-29 entry — existed
only in stage 3 of an unmerged index entry at /root/foreman, left after a host
crash-reboot. origin/main stopped at 2026-07-29. Reconstructed as a chronological
union: every heading from both sides is present, asserted by comm."
```

- [ ] **Step 6: Clear the damaged index, only now that the content is safe**

```bash
cd /root/foreman
git checkout --ours tools/lanectl.sh && git add tools/lanectl.sh   # keep the committed 305-line version
git show HEAD:tools/lanectl.sh | diff - tools/lanectl.sh && echo "lanectl matches HEAD"
git checkout HEAD -- bugeventlog.md && git add bugeventlog.md
git status --short          # expect no UU rows
git stash list              # record anything present; do not drop
```

Then fast-forward `main`:

```bash
cd /root/foreman && git pull --ff-only origin main && git log --oneline -1
```

- [ ] **Step 7: Close the obligation with evidence**

```bash
cd /root/fm-wt/integrate
python3 skills/foreman/scripts/fm-session.py close 18 --status done
```

---

