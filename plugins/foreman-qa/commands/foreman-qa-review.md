---
description: Review the working diff with the Foreman QA reviewer
---

# Foreman QA review

This command reviews only. It does not fix findings or edit files. Only the
invoking session or a different agent may act on the review.

Gather the review context before invoking the reviewer:

1. Capture the complete working diff and its summary with `git diff` and
   `git diff --stat`.
2. Capture file modes for the files in scope with `git ls-files -s`.
3. If this session already ran
   `bash skills/foreman/scripts/docs-check.sh`, include the exact command output
   in the context. State explicitly when no prior output is available; do not
   invent or summarize it.

Use the Task tool to invoke the `foreman-qa-reviewer` subagent. Give it the
complete gathered context and ask it to review the working diff under its QA
doctrine. Relay the subagent's output verbatim. Do not edit, summarize, soften,
or omit any finding or verdict.
