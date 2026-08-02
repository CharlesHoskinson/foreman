import { describe, expect, it } from "vitest";
import {
  AceLexiconV1,
  COUNCIL_ACE_PROHIBITED_REFERENTIAL_FORMS_V1,
  decodeStrictSync,
} from "@council/schema";
import {
  canonicalizeCouncilAce,
  canonicalReviewRuleSource,
  normalizeAceLineEndings,
  parseCouncilAce,
  reviewRuleLexicon,
  validateReviewRules,
} from "../src/ace.js";

const lexicon = reviewRuleLexicon();

/** Build a raw lexicon that declares single-token prohibited forms (bypass schema). */
const lexiconDeclaringReferentialForms = () => {
  const singleTokens = COUNCIL_ACE_PROHIBITED_REFERENTIAL_FORMS_V1.filter(
    (form) => !form.includes(" "),
  );
  return {
    nouns: [...lexicon.nouns, ...singleTokens],
    verbs: lexicon.verbs,
  };
};

const sourceForReferentialForm = (form: string): string => {
  if (form.includes(" ")) {
    return `Every reviewer must inspect ${form}.`;
  }
  return `The candidate must inspect a ${form}.`;
};

describe("parseCouncilAce", () => {
  it("accepts the five Profile 1 sentence shapes", () => {
    const source = [
      "Every reviewer must verify the bundle-identity.",
      "Every reviewer must not emit a premature-response.",
      "No reviewer may emit a premature-response.",
      "If a reviewer detects a material-defect then the reviewer must request a change.",
      "The candidate must lack a material-defect.",
    ].join("\n");

    const extendedLexicon = {
      nouns: [...lexicon.nouns],
      verbs: [...lexicon.verbs, { base: "lack", thirdPerson: "lacks" }],
    };

    const result = parseCouncilAce(source, extendedLexicon);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.sentences.map((sentence) => sentence.kind)).toEqual([
      "obligation",
      "prohibition_must_not",
      "prohibition_no_may",
      "conditional",
      "candidate_criterion",
    ]);
  });

  it("accepts the closed canonical review-rule document", () => {
    const source = canonicalReviewRuleSource();
    const parsed = parseCouncilAce(source, lexicon);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const validated = validateReviewRules(parsed.document);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.rules).toHaveLength(9);
    expect(validated.candidateCriteria).toEqual([]);
    expect(canonicalizeCouncilAce(parsed.document)).toBe(source);
  });

  it("encodes approval implies no material defect, not the converse", () => {
    const source = canonicalReviewRuleSource();
    expect(source).toContain(
      "If a reviewer approves the candidate then the reviewer must detect no material-defect.",
    );
    expect(source).not.toContain(
      "If a reviewer detects no material-defect then the reviewer must approve the candidate.",
    );
  });

  it("encodes abstention only when a required-evidence gap is identified", () => {
    const source = canonicalReviewRuleSource();
    expect(source).toContain(
      "If a reviewer reserves the abstention then the reviewer must identify a required-evidence-gap.",
    );
    expect(source.includes("Every reviewer must reserve the abstention.")).toBe(
      false,
    );
  });

  it.each([
    ["fragment", "verify the bundle-identity."],
    ["missing determiner", "Every reviewer must verify bundle-identity."],
    ["pronoun it", "Every reviewer must verify it."],
    ["pronoun we", "Every we must verify the bundle-identity."],
    ["pronoun you", "Every you must verify the bundle-identity."],
    ["reflexive myself", "Every reviewer must verify myself."],
    ["reflexive themselves", "Every reviewer must inspect themselves."],
    ["reflexive itself", "Every reviewer must verify itself."],
    ["anaphora", "Every reviewer must inspect that."],
    ["undeclared word", "Every reviewer must verify the mystery-object."],
    [
      "tense error",
      "If a reviewer detect a material-defect then the reviewer must request a change.",
    ],
    [
      "coordination",
      "Every reviewer must verify the bundle-identity and inspect every required-artifact.",
    ],
    ["punctuation", "Every reviewer must verify the bundle-identity!"],
    ["suffix data", "Every reviewer must verify the bundle-identity. extra"],
    ["uppercase content", "Every Reviewer must verify the bundle-identity."],
    ["uppercase verb", "Every reviewer must Verify the bundle-identity."],
    ["lowercase opener", "every reviewer must verify the bundle-identity."],
    ["tab control", "Every reviewer must verify the\tbundle-identity."],
    ["nul control", "Every reviewer must verify the bundle-identity.\u0000"],
  ])("rejects %s", (_label, source) => {
    const result = parseCouncilAce(source, lexicon);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const diagnostic = result.errors[0];
    expect(diagnostic.message.length).toBeGreaterThan(0);
    expect(diagnostic.offset).toBeGreaterThanOrEqual(0);
  });

  it("rejects candidate criteria whose subject noun is not exactly candidate", () => {
    const source = "The reviewer must verify the bundle-identity.";
    const result = parseCouncilAce(source, lexicon);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toContain("candidate");
    expect(
      source.slice(
        result.errors[0].offset,
        result.errors[0].offset + result.errors[0].length,
      ),
    ).toBe("reviewer");
  });

  it("returns a source-located error for an undeclared noun", () => {
    const source = "Every reviewer must verify the mystery-object.";
    const result = parseCouncilAce(source, lexicon);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const diagnostic = result.errors[0];
    expect(diagnostic.message).toContain("mystery-object");
    expect(
      source.slice(diagnostic.offset, diagnostic.offset + diagnostic.length),
    ).toBe("mystery-object");
  });

  it("parses LF and CRLF sources to byte-identical canonical text", () => {
    const lf = canonicalReviewRuleSource();
    const crlf = lf.replace(/\n/gu, "\r\n");
    expect(normalizeAceLineEndings(crlf)).toBe(lf);

    const parsedLf = parseCouncilAce(lf, lexicon);
    const parsedCrlf = parseCouncilAce(crlf, lexicon);
    expect(parsedLf.ok).toBe(true);
    expect(parsedCrlf.ok).toBe(true);
    if (!parsedLf.ok || !parsedCrlf.ok) return;

    const canonicalLf = canonicalizeCouncilAce(parsedLf.document);
    const canonicalCrlf = canonicalizeCouncilAce(parsedCrlf.document);
    expect(canonicalLf).toBe(canonicalCrlf);
    expect(Buffer.from(canonicalLf).equals(Buffer.from(canonicalCrlf))).toBe(
      true,
    );
  });

  it("preserves diagnostics against original CRLF source offsets", () => {
    const lfLine = "Every reviewer must verify the bundle-identity.";
    const badSecond = "Every reviewer must verify the mystery-object.";
    const crlf = `${lfLine}\r\n${badSecond}`;
    const result = parseCouncilAce(crlf, lexicon);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const diagnostic = result.errors[0];
    expect(
      crlf.slice(diagnostic.offset, diagnostic.offset + diagnostic.length),
    ).toBe("mystery-object");
    // After one CRLF, original offset is LF-line length + 2, not +1.
    expect(diagnostic.offset).toBe(
      lfLine.length + 2 + badSecond.indexOf("mystery-object"),
    );
  });

  it("finding 6: rejects declared noun someone used as a pronoun in a criterion", () => {
    const source = "The candidate must inspect a someone.";
    const extendedLexicon = {
      nouns: [...lexicon.nouns, "someone"],
      verbs: lexicon.verbs,
    };
    const result = parseCouncilAce(source, extendedLexicon);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const diagnostic = result.errors[0];
    expect(diagnostic.message.toLowerCase()).toContain("pronoun");
    expect(
      source.slice(diagnostic.offset, diagnostic.offset + diagnostic.length),
    ).toBe("someone");
  });

  it.each([...COUNCIL_ACE_PROHIBITED_REFERENTIAL_FORMS_V1])(
    "Profile 1: rejects prohibited referential form %s even with raw declared lexicon",
    (form) => {
      const source = sourceForReferentialForm(form);
      const result = parseCouncilAce(
        source,
        lexiconDeclaringReferentialForms(),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const diagnostic = result.errors[0];
      expect(diagnostic.message.toLowerCase()).toMatch(/pronoun|anaphor/);
      const matched = source.slice(
        diagnostic.offset,
        diagnostic.offset + diagnostic.length,
      );
      // Complete matched form; multiword may use one-or-more whitespace.
      expect(matched.toLowerCase().replace(/\s+/gu, " ")).toBe(form);
      expect(diagnostic.length).toBe(matched.length);
    },
  );

  it.each([
    ["whoever", "The candidate must inspect a whoever."],
    ["whomever", "The candidate must inspect a whomever."],
    ["whatever", "The candidate must inspect a whatever."],
    ["whichever", "The candidate must inspect a whichever."],
    ["whose", "The candidate must inspect a whose."],
    ["what", "The candidate must inspect a what."],
    ["oneself", "The candidate must inspect a oneself."],
    ["another", "The candidate must inspect a another."],
    ["each", "The candidate must inspect a each."],
    ["either", "The candidate must inspect a either."],
    ["neither", "The candidate must inspect a neither."],
    ["both", "The candidate must inspect a both."],
    ["all", "The candidate must inspect a all."],
    ["any", "The candidate must inspect a any."],
    ["some", "The candidate must inspect a some."],
    ["none", "The candidate must inspect a none."],
    ["many", "The candidate must inspect a many."],
    ["few", "The candidate must inspect a few."],
    ["several", "The candidate must inspect a several."],
    ["other", "The candidate must inspect a other."],
    ["others", "The candidate must inspect a others."],
    ["such", "The candidate must inspect a such."],
  ] as const)(
    "audit singleton: rejects %s with source-located complete form",
    (form, source) => {
      const result = parseCouncilAce(
        source,
        lexiconDeclaringReferentialForms(),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const diagnostic = result.errors[0];
      expect(
        source.slice(diagnostic.offset, diagnostic.offset + diagnostic.length),
      ).toBe(form);
      expect(diagnostic.message).toContain(form);
    },
  );

  it("rejects multiword referential form after a prior CRLF line with original offsets", () => {
    const lfLine = "Every reviewer must verify the bundle-identity.";
    const badSecond = "Every reviewer must inspect each other.";
    const crlf = `${lfLine}\r\n${badSecond}`;
    const result = parseCouncilAce(crlf, lexiconDeclaringReferentialForms());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const diagnostic = result.errors[0];
    expect(
      crlf.slice(diagnostic.offset, diagnostic.offset + diagnostic.length),
    ).toBe("each other");
    expect(diagnostic.offset).toBe(
      lfLine.length + 2 + badSecond.indexOf("each other"),
    );
    expect(diagnostic.length).toBe("each other".length);
  });

  it("rejects multiword form with irregular internal whitespace as the complete match", () => {
    const source = "Every reviewer must inspect no   one.";
    const result = parseCouncilAce(source, lexicon);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const diagnostic = result.errors[0];
    const matched = source.slice(
      diagnostic.offset,
      diagnostic.offset + diagnostic.length,
    );
    expect(matched).toBe("no   one");
    expect(diagnostic.message).toContain(matched);
  });

  it.each([
    // `any` / `some` are prohibited referential forms even if declared as nouns.
    ["any one", "The candidate must inspect any one.", ["any", "one"]],
    ["some one", "The candidate must inspect some one.", ["some", "one"]],
    // `one` is reserved at the schema boundary; without declaration it is
    // lexically rejected as an undeclared noun. With declaration via raw
    // lexicon, Profile 1 still treats `one` as a determiner/function word
    // only — content-word use remains out of Profile 1 (see reserved set).
    ["every one", "The candidate must inspect every one.", []],
  ] as const)(
    "regression: multiword split %s remains rejected",
    (_label, source, extraNouns) => {
      const result = parseCouncilAce(source, {
        nouns: [...lexicon.nouns, ...extraNouns],
        verbs: lexicon.verbs,
      });
      expect(result.ok).toBe(false);
    },
  );

  it("finding 6: still accepts ordinary content words", () => {
    const source = "The candidate must inspect a required-artifact.";
    const result = parseCouncilAce(source, lexicon);
    expect(result.ok).toBe(true);
  });

  it("does not reject ordinary words that merely contain a prohibited substring", () => {
    // "call" contains letters of "all"; "identity" contains "it" as letters.
    // Neither is a word-boundary match for a prohibited form.
    const extendedLexicon = {
      nouns: [...lexicon.nouns, "call", "identity"],
      verbs: [...lexicon.verbs, { base: "call", thirdPerson: "calls" }],
    };
    const source = "Every reviewer must call the identity.";
    const result = parseCouncilAce(source, extendedLexicon);
    expect(result.ok).toBe(true);
  });

  it.each([
    "what-if",
    "all-purpose",
    "same-origin",
    "another-case",
    "some-value",
  ] as const)(
    "accepts declared hyphenated compound %s that embeds a prohibited singleton",
    (compound) => {
      // AceLexiconV1 accepts the full compound; the source matcher must not
      // treat the embedded singleton (what/all/same/another/some) as a hit.
      const decoded = decodeStrictSync(AceLexiconV1, {
        schemaVersion: 1 as const,
        nouns: ["candidate", compound],
        verbs: [{ base: "inspect", thirdPerson: "inspects" }],
      });
      const source = `The candidate must inspect a ${compound}.`;
      const result = parseCouncilAce(source, {
        nouns: decoded.nouns,
        verbs: decoded.verbs,
      });
      expect(result.ok).toBe(true);
    },
  );

  it.each(["if-what", "value-some", "what-if", "some-value"] as const)(
    "accepts prefix/suffix compound %s without substring false positive",
    (compound) => {
      const decoded = decodeStrictSync(AceLexiconV1, {
        schemaVersion: 1 as const,
        nouns: ["candidate", compound],
        verbs: [{ base: "inspect", thirdPerson: "inspects" }],
      });
      const source = `The candidate must inspect a ${compound}.`;
      const result = parseCouncilAce(source, {
        nouns: decoded.nouns,
        verbs: decoded.verbs,
      });
      expect(result.ok).toBe(true);
    },
  );

  it("does not match a prohibited form embedded in a longer simple token", () => {
    // "somewhere" contains "some" and "where" as letter runs, not as Profile 1
    // content-word boundaries (no hyphen, no non-content separator).
    const decoded = decodeStrictSync(AceLexiconV1, {
      schemaVersion: 1 as const,
      nouns: ["candidate", "somewhere"],
      verbs: [{ base: "inspect", thirdPerson: "inspects" }],
    });
    const source = "The candidate must inspect a somewhere.";
    const result = parseCouncilAce(source, {
      nouns: decoded.nouns,
      verbs: decoded.verbs,
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    ["start of input", "what must inspect a candidate.", "what"],
    ["end of input", "The candidate must inspect a what", "what"],
    ["next to period", "The candidate must inspect a what.", "what"],
    ["next to spaces", "The candidate must inspect a what .", "what"],
    [
      "after LF",
      "Every reviewer must verify the bundle-identity.\nwhat",
      "what",
    ],
    [
      "after CRLF",
      "Every reviewer must verify the bundle-identity.\r\nwhat",
      "what",
    ],
  ] as const)(
    "still rejects standalone prohibited form at %s",
    (_label, source, form) => {
      const result = parseCouncilAce(
        source,
        lexiconDeclaringReferentialForms(),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const diagnostic = result.errors[0];
      expect(
        source
          .slice(diagnostic.offset, diagnostic.offset + diagnostic.length)
          .toLowerCase(),
      ).toBe(form);
      expect(diagnostic.message.toLowerCase()).toMatch(/pronoun|anaphor/);
    },
  );
});

describe("validateReviewRules", () => {
  it("requires every semantic rule exactly once", () => {
    const parsed = parseCouncilAce(canonicalReviewRuleSource(), lexicon);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const validated = validateReviewRules(parsed.document);
    expect(validated).toEqual({
      ok: true,
      rules: [
        "verify_bundle_identity",
        "inspect_required_artifacts",
        "evaluate_acceptance_criteria",
        "cite_material_findings",
        "emit_exactly_one_response",
        "forbid_premature_response",
        "request_changes_on_material_defect",
        "approve_only_without_material_defect",
        "abstain_only_on_missing_evidence",
      ],
      candidateCriteria: [],
    });
  });

  it("accepts task-specific candidate criteria and returns their canonical text", () => {
    const criterion = "The candidate must lack a material-defect.";
    const source = `${canonicalReviewRuleSource()}\n${criterion}`;
    const extendedLexicon = {
      nouns: [...lexicon.nouns],
      verbs: [...lexicon.verbs, { base: "lack", thirdPerson: "lacks" }],
    };
    const parsed = parseCouncilAce(source, extendedLexicon);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const validated = validateReviewRules(parsed.document);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.rules).toHaveLength(9);
    expect(validated.candidateCriteria).toEqual([criterion]);
  });

  it("rejects duplicate candidate criteria", () => {
    const criterion = "The candidate must lack a material-defect.";
    const source = `${canonicalReviewRuleSource()}\n${criterion}\n${criterion}`;
    const extendedLexicon = {
      nouns: [...lexicon.nouns],
      verbs: [...lexicon.verbs, { base: "lack", thirdPerson: "lacks" }],
    };
    const parsed = parseCouncilAce(source, extendedLexicon);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const validated = validateReviewRules(parsed.document);
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(
      validated.errors.some((error) => error.message.includes("duplicate")),
    ).toBe(true);
  });

  it("rejects duplicate semantic rules", () => {
    const source = [
      "Every reviewer must verify the bundle-identity.",
      "Every reviewer must verify the bundle-identity.",
    ].join("\n");
    const parsed = parseCouncilAce(source, lexicon);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const validated = validateReviewRules(parsed.document);
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(
      validated.errors.some((error) => error.message.includes("duplicate")),
    ).toBe(true);
  });

  it("rejects missing required rules", () => {
    const source = "Every reviewer must verify the bundle-identity.";
    const parsed = parseCouncilAce(source, lexicon);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const validated = validateReviewRules(parsed.document);
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(
      validated.errors.some((error) => error.message.includes("missing")),
    ).toBe(true);
  });

  it("rejects unknown non-criterion semantic sentences", () => {
    const source = "Every reviewer must cite a change.";
    const parsed = parseCouncilAce(source, lexicon);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const validated = validateReviewRules(parsed.document);
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(
      validated.errors.some((error) => error.message.includes("unknown")),
    ).toBe(true);
  });

  it("rejects contradictory obligation and prohibition pairs", () => {
    const source = [
      "Every reviewer must emit a final-response.",
      "Every reviewer must not emit a final-response.",
    ].join("\n");
    const parsed = parseCouncilAce(source, lexicon);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const validated = validateReviewRules(parsed.document);
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(
      validated.errors.some((error) => error.message.includes("contradictory")),
    ).toBe(true);
  });
});
