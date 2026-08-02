# Council ACE Profile 1

Council ACE Profile 1 is a **finite, documented subset** of Attempto Controlled
English (ACE) 6.7. Council uses it for reviewer obligations, prohibitions,
conditions, and candidate criteria.

This profile is **not** a claim of full ACE 6.7 conformance. Council does not
ship the Attempto Parsing Engine and does not rewrite free prose into
authoritative ACE.

## Goals

- Reject ambiguous or incomplete reviewer instructions before provider use.
- Produce one canonical text for hashing and comparison.
- Map accepted sentences onto a closed set of semantic review rules.

## Function words

| Class             | Allowed forms                                         |
| ----------------- | ----------------------------------------------------- |
| Sentence openers  | `Every`, `No`, `If`, `The` (canonical capitalisation) |
| Modals            | `must`, `must not`, `may`                             |
| Conditional hinge | `then`                                                |
| Determiners       | `a`, `the`, `every`, `no`, `one`, `exactly one`       |

Lowercase openers such as `every` are rejected. Reserved function words must
not appear as content lexicon entries.

## Content words

- Lowercase ASCII words or lowercase hyphenated compounds:
  `^[a-z]+(-[a-z]+)*$`
- Every noun and verb form must exist in the closed contract lexicon.
- Uppercase content words are rejected. The parser does not case-fold content
  before validation.
- Pronouns and implicit anaphora are rejected via the **versioned Profile 1
  set** `COUNCIL_ACE_PROHIBITED_REFERENTIAL_FORMS_V1` exported from
  `@council/schema`. The strict `AceLexiconV1` boundary and the domain source
  scan both consume that single list. It is the exhaustive prohibited
  referential-form set for this profile version (personal, possessive,
  reflexive, demonstrative, relative/interrogative, indefinite/distributive/
  quantifier, reciprocal multiword forms such as `no one` / `each other` /
  `one another`, and explicit anaphoric surface forms such as `aforesaid` and
  `former`). Declaring a listed form in a raw content lexicon does not make it
  admissible. This is **not** an unbounded natural-language guarantee: a new
  form requires a Profile version or an explicit addition with tests.
- C0 and C1 control characters are rejected except CR and LF used as line
  endings. Diagnostics use original source offsets (including CRLF). LF and
  CRLF sources that parse successfully produce byte-identical canonical text.
- Coordination, free punctuation, and trailing suffix text are rejected.

## Accepted sentence shapes

```text
Every <actor> must <base-verb> <determined-object>.
Every <actor> must not <base-verb> <determined-object>.
No <actor> may <base-verb> <determined-object>.
If a <actor> <third-person-verb> <determined-object> then the <actor> must <base-verb> <determined-object>.
The candidate must <base-verb> <determined-object>.
```

`<determined-object>` is one determiner plus one lexicon noun. The subject of a
candidate criterion must be exactly the noun `candidate`. A declared noun such
as `reviewer` is not accepted in that subject position.

## Required semantic rules

A review contract must contain exactly one canonical sentence for each rule:

| Rule id                                | Canonical sentence                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `verify_bundle_identity`               | Every reviewer must verify the bundle-identity.                                                |
| `inspect_required_artifacts`           | Every reviewer must inspect every required-artifact.                                           |
| `evaluate_acceptance_criteria`         | Every reviewer must evaluate every acceptance-criterion.                                       |
| `cite_material_findings`               | Every reviewer must cite every material-finding.                                               |
| `emit_exactly_one_response`            | Every reviewer must emit exactly one final-response.                                           |
| `forbid_premature_response`            | Every reviewer must not emit a premature-response.                                             |
| `request_changes_on_material_defect`   | If a reviewer detects a material-defect then the reviewer must request a change.               |
| `approve_only_without_material_defect` | If a reviewer approves the candidate then the reviewer must detect no material-defect.         |
| `abstain_only_on_missing_evidence`     | If a reviewer reserves the abstention then the reviewer must identify a required-evidence-gap. |

The approval rule encodes “approval implies no material defect,” not the
converse. The abstention rule encodes “reserving abstention implies a declared
required-evidence gap.”

## Acceptance criteria

Task-specific `The candidate must ...` sentences are valid Profile 1
candidate criteria. Semantic validation:

- returns their canonical text;
- rejects duplicate criteria; and
- continues to reject every unknown non-criterion sentence.

## Canonicalization

`canonicalizeCouncilAce` renders the typed abstract syntax tree with:

- one sentence per line;
- canonical capitalisation and spacing; and
- a single trailing period per sentence.

Equal documents produce equal canonical text. CRLF and LF sources that parse
successfully produce the same canonical bytes.

## Non-goals

- Full ACE 6.7 grammar coverage
- Authority decisions from controlled language alone
- Interpolation of artifact bytes or task data into ACE grammar
- Treating provider narration as ACE instructions

## References

- [ACE 6.7 in a Nutshell](https://attempto.ifi.uzh.ch/site/docs/ace_nutshell.html)
- [ACE Construction Rules](https://attempto.ifi.uzh.ch/site/docs/ace_constructionrules.html)
- Prohibited referential forms: `COUNCIL_ACE_PROHIBITED_REFERENTIAL_FORMS_V1` in
  `packages/schema/src/prompt-preflight.ts`
- Implementation: `packages/domain/src/ace.ts`
