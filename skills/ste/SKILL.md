---
name: ste
description: Use when writing any Foreman documentation, commit message, report, spec, or trap entry - applies ASD-STE100 Simplified Technical English so text is unambiguous, machine-parseable, and translatable. Also use when reviewing prose for ambiguity.
---

# STE — Simplified Technical English for Foreman

Source: **ASD-STE100 Issue 9**, the aerospace controlled-language standard.
Full rule set extracted to `docs/reference/ste-rules.json` (53 rules, 9 sections).

## Why this repo uses it

Foreman's documentation is read by **agents as often as by people**. Ambiguous
prose is not a style problem here — it is a defect that produces empty bursts,
misread traps, and specs a worker cannot execute. STE exists to remove exactly
that ambiguity, and it has been proven in aerospace maintenance manuals where a
misread instruction is a safety event.

Two concrete failures this session that STE addresses directly:

- A spec said "read the OpenSpec change, then implement". Six lanes empty-burst.
  Under STE 5.2 and 5.3, that is two instructions in one sentence and not in the
  imperative — it would have been written "Edit `env/tool-check.sh`."
- Traps were written as narrative paragraphs and hand-picked from. Under STE 6.5
  and 6.6, each trap becomes one topic and at most six sentences.

## The rules that bind here

Apply all of these. They are quoted from the standard.

### Sentences and paragraphs

| Rule | Requirement |
|---|---|
| **4.1** | Write short and clear sentences. |
| **4.2** | Do not omit words or use contractions to make your sentences shorter. |
| **4.3** | Use a vertical list for complex texts. |
| **5.1** | Procedural: maximum **20 words** per sentence. |
| **6.3** | Descriptive: maximum **25 words** per sentence. |
| **6.5** | Each paragraph has only one topic. |
| **6.6** | No paragraph has more than **six sentences**. |

### Instructions — this is where specs live

| Rule | Requirement |
|---|---|
| **5.2** | Write only one instruction in each sentence, unless two actions occur at the same time. |
| **5.3** | Write instructions in the imperative (command) form. |
| **5.4** | When a condition must be known first, start with a descriptive statement, then give the instruction. |
| **5.5** | Write notes only to give information, **not** instructions. |

A spec sentence that is not an imperative is not an instruction, and a worker
will treat it as context. That distinction caused six empty bursts.

### Verbs and voice

| Rule | Requirement |
|---|---|
| **3.6** | Use the active voice. Passive is permitted in descriptive writing only when the agent is unknown. |
| **3.4** | Do not use auxiliary verbs to make complex verb constructions. |
| **3.7** | Use an approved verb to describe an action, not a noun. |
| **9.3** | Do not make phrasal verbs when you use two words together. |

"The suite was run and was found to be green" → "The suite passed."

### Terminology

| Rule | Requirement |
|---|---|
| **1.11** | Do not use different technical nouns for the same item. |
| **1.9** | Select a technical noun that is short and easy to understand. |
| **1.10** | Do not use regional, slang, or jargon words as technical nouns. |
| **1.14** | Use American English spelling. |
| **9.4** | Always use a consistent style for terminology and wording. |

Rule 1.11 is the one this repo violates most. "lane", "worker", "agent" and
"implementer" have all been used for the same thing. Pick one per concept and
keep it.

### Punctuation

| Rule | Requirement |
|---|---|
| **8.1** | Use standard English punctuation, but **never the semicolon (;)**. |
| **8.2** | Use hyphens to connect words that are directly related. |

The semicolon ban is not arbitrary. A semicolon joins two independent clauses,
which is rule 5.2's "one instruction per sentence" violated by punctuation.

### Warnings and safety

| Rule | Requirement |
|---|---|
| **7.1** | Use a word such as **WARNING** or **CAUTION** to identify the level of risk. |
| **7.2** | Start a safety instruction with a clear and accurate command or condition. |
| **7.3** | Give an explanation to show the risk or the possible result. |

Applies to `AGENT_TRAPS.md` entries. A trap is a safety instruction: command
first, then the consequence.

## Where to apply it

| Artifact | Apply |
|---|---|
| Lane specs | **Strictly.** Sections 4, 5, 9 — this is procedural writing. |
| `AGENT_TRAPS.md` | **Strictly.** Section 7 shape: command, then risk. |
| `SKILL.md`, `README.md` | Sections 4, 6, 9. |
| Commit messages | Sections 3, 4, 9. Active voice, no semicolons. |
| Bug-ledger entries | Section 6. One topic per paragraph. |
| Research and design docs | Advisory. Argument sometimes needs subordination. |

## What STE is not

STE does not require a restricted vocabulary here. The full standard pairs the
writing rules with an approved dictionary of about 900 words, and that dictionary
is written for aircraft maintenance. **Foreman adopts the writing rules, not the
dictionary.** Technical nouns from this domain — worktree, lane, mutex, seq — are
legitimate under rule 1.8, which permits technical nouns approved in your own
subject field.

Do not report a violation of a dictionary this repo has not adopted.
