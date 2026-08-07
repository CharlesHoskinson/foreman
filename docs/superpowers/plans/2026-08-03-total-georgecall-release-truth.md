# Total Georgecall Release Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one complete and internally consistent v0.2.9.0 release record named `Total Georgecall`.

**Architecture:** Add one canonical two-release accomplishment ledger. Derive the v0.2.9.0 notes, README release summary, roadmap, checklist, and GitHub release metadata from that ledger and exact tag evidence.

**Tech Stack:** Markdown, Git, GitHub CLI, Markdownlint, codespell, lychee, OpenSpec 1.7.0, and Graphify 0.9.32.

## Global Constraints

- Keep `v0.2.9.0` at commit `fbe23257fc389036d6feaa8f38e7b377f3106406`.
- Keep all existing v0.2.9.0 release assets byte-identical.
- Use `Total Georgecall` as the release title.
- Use the artwork at `assets/v029-total-georgecall.png`.
- Load the artwork through the immutable `v0.2.9.0` tag.
- Apply ASD-STE100 writing rules.
- Do not present incomplete v0.3.0 work as shipped v0.2.9.0 work.
- Do not delete historical evidence.

---

### Task 1: Add the canonical accomplishment ledger

**Files:**

- Create: `docs/releases/v0.2.8.2-v0.2.9.0-accomplishments.md`
- Read: `docs/releases/v0.2.8.2-notes.md`
- Read: `docs/releases/v0.2.9.0-notes.md`
- Read: `docs/releases/v0.2.8.2-cleanup-log.md`
- Read: `docs/releases/v0.2.9.0-cleanup-log.md`
- Read: `docs/RESIDUALS.md`
- Read: `openspec/changes/council-v029-preflight-release/`

**Interfaces:**

- Consumes: exact tags `v0.2.8.2` and `v0.2.9.0`, published release metadata, tracked evidence, and cleanup records.
- Produces: one canonical ledger with separate shipped, verification, cleanup, and excluded-scope sections for each release.

- [ ] **Step 1: Write the v0.2.8.2 ledger section**

Record the external Gobox pilot, portability fixes, NATS coverage, deterministic Quint evaluator, exact gates, graph, cleanup, and explicit limits. Include the exact commits, pull requests, test counts, run identifiers, and graph counts from the tracked release record.

- [ ] **Step 2: Write the v0.2.9.0 ledger section**

Record the Node.js 24 TypeScript Council packages, ACE preprocessing, executable boundary, provider adapters, nonce binding, path normalization, tests, live canaries, external Council dogfood, advisory `quorum_not_met`, cleanup, release graph, published assets, and explicit limits.

- [ ] **Step 3: Separate unpromoted work**

Put incomplete or excluded work under explicit `Not shipped` or `Future work` headings. Include Gemini, the complete Council coordinator, MCP, complete Python removal, credential provisioning, external runtime-state placement, the Grok scan guard, and Graphify skill synchronization.

- [ ] **Step 4: Verify the ledger**

Run:

```bash
git diff --check
skills/foreman/scripts/docs-check.sh
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit the ledger**

```bash
git add docs/releases/v0.2.8.2-v0.2.9.0-accomplishments.md
git commit -m "docs(release): preserve the complete accomplishment ledger"
```

### Task 2: Expand the Total Georgecall release notes

**Files:**

- Modify: `docs/releases/v0.2.9.0-notes.md`
- Read: `docs/releases/v0.2.8.2-v0.2.9.0-accomplishments.md`

**Interfaces:**

- Consumes: the canonical accomplishment ledger.
- Produces: the tracked body for the GitHub v0.2.9.0 release.

- [ ] **Step 1: Add the release identity**

Use this heading and immutable image URL:

```markdown
# Total Georgecall

Foreman v0.2.9.0

![Total Georgecall release artwork](https://raw.githubusercontent.com/CharlesHoskinson/foreman/v0.2.9.0/assets/v029-total-georgecall.png)
```

- [ ] **Step 2: Add comprehensive release sections**

Add sections for product boundary, ACE preflight, runtime and security, provider adapters, verification, external dogfood, Council advisory status, graph assets, cleanup, and explicit limits. Link to the canonical ledger for the complete inventory.

- [ ] **Step 3: Verify the notes**

Run:

```bash
skills/foreman/scripts/docs-check.sh
git diff --check
```

Expected: both commands exit `0`.

- [ ] **Step 4: Commit the notes**

```bash
git add docs/releases/v0.2.9.0-notes.md
git commit -m "docs(release): publish comprehensive Total Georgecall notes"
```

### Task 3: Correct active repository authority

**Files:**

- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `checklist.md`

**Interfaces:**

- Consumes: the canonical accomplishment ledger and published release evidence.
- Produces: current repository entry points with no provisional v0.2.9.0 status.

- [ ] **Step 1: Add the README release section**

Add a concise `Latest release` section after the opening description. Name `Total Georgecall`, link the release notes and ledger, summarize the shipped preflight boundary, and state the excluded scope.

- [ ] **Step 2: Correct the roadmap**

Make v0.2.9.0 the latest release. Move v0.2.8.2 into the released line. Replace the provisional v0.2.9.0 table with exact final evidence. Add a separate v0.3.0 planning section that reserves the path `openspec/changes/v030-release-program/` without claiming implementation.

- [ ] **Step 3: Close the checklist**

Change the checklist from active candidate authority to a completed release record. Mark every satisfied item complete and add exact evidence for the final canaries, gates, graph, tag, and GitHub release.

- [ ] **Step 4: Reject stale language**

Run:

```bash
if rg -n 'Latest release: v0\.2\.8\.2|Active release candidate: v0\.2\.9\.0|Provisional pass|final candidate rerun remains required|^- \[ \]' ROADMAP.md checklist.md; then
  exit 1
fi
```

Expected: no matches and exit `0`.

- [ ] **Step 5: Commit active authority**

```bash
git add README.md ROADMAP.md checklist.md
git commit -m "docs: make Total Georgecall the current release authority"
```

### Task 4: Verify, review, and publish

**Files:**

- Review: all changed Markdown files
- Update after merge: GitHub release `v0.2.9.0` metadata only

**Interfaces:**

- Consumes: the complete release-truth diff.
- Produces: reviewed repository documentation and updated GitHub release metadata.

- [ ] **Step 1: Run local verification**

Run:

```bash
git diff --check
components/council/node_modules/.bin/openspec validate --all --strict --no-interactive
skills/foreman/scripts/docs-check.sh
```

Expected: clean diff, 31 OpenSpec packages passed, and documentation checks passed.

- [ ] **Step 2: Run the Foreman audit loop**

Route the documentation implementation to Grok. Re-run verification outside the worker lane. Send the cold diff and acceptance criteria to Codex GPT-5.6 Sol. Rework every blocking or actionable finding through Grok.

- [ ] **Step 3: Publish the pull request**

Push the branch and open a draft pull request. Mark it ready after local verification. Require hosted Linux and Windows gates before merge.

- [ ] **Step 4: Update GitHub release metadata**

After merge, run:

```bash
gh release edit v0.2.9.0 \
  --repo CharlesHoskinson/foreman \
  --title "Total Georgecall" \
  --notes-file docs/releases/v0.2.9.0-notes.md
```

Expected: the release title is `Total Georgecall`, and the body contains the tag-pinned image URL.

- [ ] **Step 5: Verify immutable release evidence**

Run:

```bash
test "$(git rev-parse 'v0.2.9.0^{}')" = "fbe23257fc389036d6feaa8f38e7b377f3106406"
gh release view v0.2.9.0 --repo CharlesHoskinson/foreman --json name,body,assets
```

Expected: the tag is unchanged, the title is correct, the image URL is present, and all seven existing graph assets retain their digests.

- [ ] **Step 6: Refresh the current knowledge graph**

Rebuild the documentation semantic records from the exact merge commit. Keep the published release graph assets exact to `fbe2325`. Record post-merge graph provenance separately.
