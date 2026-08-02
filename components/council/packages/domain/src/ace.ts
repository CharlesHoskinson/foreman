import { COUNCIL_ACE_PROHIBITED_REFERENTIAL_FORMS_V1 } from "@council/schema";

export type AceSourceLocation = {
  readonly offset: number;
  readonly length: number;
};

export type AceDeterminer =
  "a" | "the" | "every" | "no" | "one" | "exactly one";

export type AceDeterminedObject = {
  readonly determiner: AceDeterminer;
  readonly noun: string;
  readonly location: AceSourceLocation;
};

export type AceSentence =
  | {
      readonly kind: "obligation";
      readonly actor: string;
      readonly verb: string;
      readonly object: AceDeterminedObject;
      readonly location: AceSourceLocation;
    }
  | {
      readonly kind: "prohibition_must_not";
      readonly actor: string;
      readonly verb: string;
      readonly object: AceDeterminedObject;
      readonly location: AceSourceLocation;
    }
  | {
      readonly kind: "prohibition_no_may";
      readonly actor: string;
      readonly verb: string;
      readonly object: AceDeterminedObject;
      readonly location: AceSourceLocation;
    }
  | {
      readonly kind: "conditional";
      readonly actor: string;
      readonly conditionVerb: string;
      readonly conditionObject: AceDeterminedObject;
      readonly thenVerb: string;
      readonly thenObject: AceDeterminedObject;
      readonly location: AceSourceLocation;
    }
  | {
      readonly kind: "candidate_criterion";
      readonly candidate: string;
      readonly verb: string;
      readonly object: AceDeterminedObject;
      readonly location: AceSourceLocation;
    };

export type AceDocument = {
  readonly sentences: readonly AceSentence[];
};

export type AceDiagnostic = {
  readonly message: string;
  readonly offset: number;
  readonly length: number;
};

export type AceParseResult =
  | { readonly ok: true; readonly document: AceDocument }
  | {
      readonly ok: false;
      readonly errors: readonly [AceDiagnostic, ...AceDiagnostic[]];
    };

export type AceLexiconVerb = {
  readonly base: string;
  readonly thirdPerson: string;
};

export type AceLexicon = {
  readonly nouns: readonly string[];
  readonly verbs: readonly AceLexiconVerb[];
};

export const REQUIRED_SEMANTIC_RULES = [
  "verify_bundle_identity",
  "inspect_required_artifacts",
  "evaluate_acceptance_criteria",
  "cite_material_findings",
  "emit_exactly_one_response",
  "forbid_premature_response",
  "request_changes_on_material_defect",
  "approve_only_without_material_defect",
  "abstain_only_on_missing_evidence",
] as const;

export type SemanticRuleId = (typeof REQUIRED_SEMANTIC_RULES)[number];

export type AceValidationResult =
  | {
      readonly ok: true;
      readonly rules: readonly SemanticRuleId[];
      readonly candidateCriteria: readonly string[];
    }
  | {
      readonly ok: false;
      readonly errors: readonly [AceDiagnostic, ...AceDiagnostic[]];
    };

type Token = {
  readonly text: string;
  readonly start: number;
  readonly end: number;
};

const CONTENT_WORD = /^[a-z]+(-[a-z]+)*$/;
const DETERMINERS_SINGLE = new Set(["a", "the", "every", "no", "one"]);
const SENTENCE_OPENERS = new Set(["Every", "No", "If", "The"]);

/**
 * Escape a literal for inclusion in a RegExp source.
 */
const escapeRegExpLiteral = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * Build the Profile 1 source matcher from the schema-exported versioned set.
 *
 * Longer / multiword alternatives are sorted first so a complete form such as
 * `each other` wins over a shorter shared token. Internal ASCII spaces become
 * one-or-more whitespace so CRLF-adjacent multiword matches keep original
 * offset and length on the matched surface text.
 *
 * Boundaries follow the Profile 1 content-word alphabet (`[a-z-]`), not
 * JavaScript `\b`. A form matches only when it is not immediately preceded or
 * followed by an ASCII letter or hyphen, so a banned singleton is not a hit
 * inside a valid hyphenated compound (`what-if`, `same-origin`) or a longer
 * simple token (`somewhere`). Detection remains case-insensitive.
 */
const buildProhibitedReferentialFormPattern = (
  forms: readonly string[],
): RegExp => {
  const sorted = [...forms].sort((left, right) => {
    if (right.length !== left.length) {
      return right.length - left.length;
    }
    // Prefer more whitespace segments when lengths tie.
    const leftParts = left.split(" ").length;
    const rightParts = right.split(" ").length;
    return rightParts - leftParts;
  });
  const alternatives = sorted.map((form) =>
    form
      .split(" ")
      .map((part) => escapeRegExpLiteral(part))
      .join("\\s+"),
  );
  // Profile 1 content words: ^[a-z]+(-[a-z]+)*$ — hyphen is content, not edge.
  return new RegExp(`(?<![a-z-])(?:${alternatives.join("|")})(?![a-z-])`, "iu");
};

/**
 * Pronouns and anaphora rejected as residual free English in Profile 1.
 *
 * Single source of truth: `COUNCIL_ACE_PROHIBITED_REFERENTIAL_FORMS_V1` from
 * `@council/schema`. Forms are rejected even when a caller bypasses strict
 * lexicon decoding and supplies a raw declared lexicon.
 */
const PRONOUN_OR_ANAPHORA = buildProhibitedReferentialFormPattern(
  COUNCIL_ACE_PROHIBITED_REFERENTIAL_FORMS_V1,
);

const CANONICAL_RULE_SENTENCES: ReadonlyArray<{
  readonly sentence: string;
  readonly rule: SemanticRuleId;
}> = [
  {
    sentence: "Every reviewer must verify the bundle-identity.",
    rule: "verify_bundle_identity",
  },
  {
    sentence: "Every reviewer must inspect every required-artifact.",
    rule: "inspect_required_artifacts",
  },
  {
    sentence: "Every reviewer must evaluate every acceptance-criterion.",
    rule: "evaluate_acceptance_criteria",
  },
  {
    sentence: "Every reviewer must cite every material-finding.",
    rule: "cite_material_findings",
  },
  {
    sentence: "Every reviewer must emit exactly one final-response.",
    rule: "emit_exactly_one_response",
  },
  {
    sentence: "Every reviewer must not emit a premature-response.",
    rule: "forbid_premature_response",
  },
  {
    sentence:
      "If a reviewer detects a material-defect then the reviewer must request a change.",
    rule: "request_changes_on_material_defect",
  },
  {
    // Approval implies no material defect (antecedent = approve, consequent = no defect).
    sentence:
      "If a reviewer approves the candidate then the reviewer must detect no material-defect.",
    rule: "approve_only_without_material_defect",
  },
  {
    // Reserving abstention implies a declared required-evidence gap.
    sentence:
      "If a reviewer reserves the abstention then the reviewer must identify a required-evidence-gap.",
    rule: "abstain_only_on_missing_evidence",
  },
];

const sentenceToRule = new Map(
  CANONICAL_RULE_SENTENCES.map((entry) => [entry.sentence, entry.rule]),
);

const locationOf = (start: number, end: number): AceSourceLocation => ({
  offset: start,
  length: Math.max(0, end - start),
});

const error = (
  message: string,
  offset: number,
  length: number,
): AceDiagnostic => ({ message, offset, length });

const fail = (
  message: string,
  offset: number,
  length: number,
): AceParseResult => ({
  ok: false,
  errors: [error(message, offset, length)],
});

/**
 * Normalize CRLF and lone CR to LF so LF and CRLF sources share offsets after
 * normalization and yield byte-identical canonical text.
 */
export const normalizeAceLineEndings = (source: string): string =>
  source.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");

const isC0OrC1Control = (code: number): boolean =>
  (code <= 0x1f && code !== 0x0a && code !== 0x0d) ||
  (code >= 0x7f && code <= 0x9f);

const findControlCharacter = (
  source: string,
): { readonly index: number; readonly code: number } | null => {
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (isC0OrC1Control(code)) {
      return { index, code };
    }
  }
  return null;
};

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const current = source[index];
    if (current === undefined) break;
    if (/\s/u.test(current)) {
      index += 1;
      continue;
    }
    if (current === ".") {
      tokens.push({ text: ".", start: index, end: index + 1 });
      index += 1;
      continue;
    }
    if (
      current === "," ||
      current === ";" ||
      current === ":" ||
      current === "!"
    ) {
      tokens.push({ text: current, start: index, end: index + 1 });
      index += 1;
      continue;
    }
    const start = index;
    while (index < source.length) {
      const ch = source[index];
      if (
        ch === undefined ||
        /\s/u.test(ch) ||
        ch === "." ||
        ch === "," ||
        ch === ";" ||
        ch === ":" ||
        ch === "!"
      ) {
        break;
      }
      index += 1;
    }
    tokens.push({ text: source.slice(start, index), start, end: index });
  }
  return tokens;
};

const isContentWord = (text: string): boolean => CONTENT_WORD.test(text);

const nounSet = (lexicon: AceLexicon): ReadonlySet<string> =>
  new Set(lexicon.nouns);

const baseVerbSet = (lexicon: AceLexicon): ReadonlySet<string> =>
  new Set(lexicon.verbs.map((verb) => verb.base));

const thirdPersonVerbSet = (lexicon: AceLexicon): ReadonlySet<string> =>
  new Set(lexicon.verbs.map((verb) => verb.thirdPerson));

/**
 * Require exact token text. Content and function words other than the four
 * sentence openers must already be lowercase; openers use published capitals.
 */
const exactWord = (
  tokens: readonly Token[],
  index: number,
  expected: string,
):
  | { readonly token: Token; readonly nextIndex: number }
  | { readonly error: AceDiagnostic } => {
  const token = tokens[index];
  if (token === undefined) {
    return { error: error(`expected '${expected}'`, 0, 0) };
  }
  if (token.text !== expected) {
    return {
      error: error(
        `expected '${expected}', found '${token.text}'`,
        token.start,
        token.end - token.start,
      ),
    };
  }
  return { token, nextIndex: index + 1 };
};

const parseDeterminer = (
  tokens: readonly Token[],
  index: number,
):
  | {
      readonly determiner: AceDeterminer;
      readonly nextIndex: number;
      readonly start: number;
    }
  | { readonly error: AceDiagnostic } => {
  const first = tokens[index];
  if (first === undefined) {
    return {
      error: error("expected determiner", 0, 0),
    };
  }
  if (first.text === "exactly") {
    const second = tokens[index + 1];
    if (second === undefined || second.text !== "one") {
      return {
        error: error(
          "expected determiner 'exactly one'",
          first.start,
          first.end - first.start,
        ),
      };
    }
    return {
      determiner: "exactly one",
      nextIndex: index + 2,
      start: first.start,
    };
  }
  if (!DETERMINERS_SINGLE.has(first.text)) {
    return {
      error: error(
        `unknown or missing determiner '${first.text}'`,
        first.start,
        first.end - first.start,
      ),
    };
  }
  return {
    determiner: first.text as Exclude<AceDeterminer, "exactly one">,
    nextIndex: index + 1,
    start: first.start,
  };
};

const parseDeterminedObject = (
  tokens: readonly Token[],
  index: number,
  lexicon: AceLexicon,
):
  | {
      readonly object: AceDeterminedObject;
      readonly nextIndex: number;
    }
  | { readonly error: AceDiagnostic } => {
  const determinerResult = parseDeterminer(tokens, index);
  if ("error" in determinerResult) return determinerResult;
  const nounToken = tokens[determinerResult.nextIndex];
  if (nounToken === undefined) {
    return {
      error: error("expected noun after determiner", determinerResult.start, 0),
    };
  }
  if (!isContentWord(nounToken.text)) {
    return {
      error: error(
        `invalid content word '${nounToken.text}'`,
        nounToken.start,
        nounToken.end - nounToken.start,
      ),
    };
  }
  if (!nounSet(lexicon).has(nounToken.text)) {
    return {
      error: error(
        `undeclared noun '${nounToken.text}'`,
        nounToken.start,
        nounToken.end - nounToken.start,
      ),
    };
  }
  return {
    object: {
      determiner: determinerResult.determiner,
      noun: nounToken.text,
      location: locationOf(determinerResult.start, nounToken.end),
    },
    nextIndex: determinerResult.nextIndex + 1,
  };
};

const parseContentNoun = (
  tokens: readonly Token[],
  index: number,
  lexicon: AceLexicon,
  role: string,
):
  | { readonly noun: string; readonly token: Token; readonly nextIndex: number }
  | { readonly error: AceDiagnostic } => {
  const token = tokens[index];
  if (token === undefined) {
    return { error: error(`expected ${role}`, 0, 0) };
  }
  if (!isContentWord(token.text)) {
    return {
      error: error(
        `invalid ${role} '${token.text}'`,
        token.start,
        token.end - token.start,
      ),
    };
  }
  if (!nounSet(lexicon).has(token.text)) {
    return {
      error: error(
        `undeclared ${role} '${token.text}'`,
        token.start,
        token.end - token.start,
      ),
    };
  }
  return { noun: token.text, token, nextIndex: index + 1 };
};

const parseBaseVerb = (
  tokens: readonly Token[],
  index: number,
  lexicon: AceLexicon,
):
  | { readonly verb: string; readonly token: Token; readonly nextIndex: number }
  | { readonly error: AceDiagnostic } => {
  const token = tokens[index];
  if (token === undefined) {
    return { error: error("expected base verb", 0, 0) };
  }
  if (!isContentWord(token.text)) {
    return {
      error: error(
        `invalid verb '${token.text}'`,
        token.start,
        token.end - token.start,
      ),
    };
  }
  if (!baseVerbSet(lexicon).has(token.text)) {
    return {
      error: error(
        `undeclared base verb '${token.text}'`,
        token.start,
        token.end - token.start,
      ),
    };
  }
  return { verb: token.text, token, nextIndex: index + 1 };
};

const parseThirdPersonVerb = (
  tokens: readonly Token[],
  index: number,
  lexicon: AceLexicon,
):
  | { readonly verb: string; readonly token: Token; readonly nextIndex: number }
  | { readonly error: AceDiagnostic } => {
  const token = tokens[index];
  if (token === undefined) {
    return { error: error("expected third-person verb", 0, 0) };
  }
  if (!isContentWord(token.text)) {
    return {
      error: error(
        `invalid verb '${token.text}'`,
        token.start,
        token.end - token.start,
      ),
    };
  }
  if (!thirdPersonVerbSet(lexicon).has(token.text)) {
    if (baseVerbSet(lexicon).has(token.text)) {
      return {
        error: error(
          `expected third-person verb form, found base form '${token.text}'`,
          token.start,
          token.end - token.start,
        ),
      };
    }
    return {
      error: error(
        `undeclared third-person verb '${token.text}'`,
        token.start,
        token.end - token.start,
      ),
    };
  }
  return { verb: token.text, token, nextIndex: index + 1 };
};

const parseSentence = (
  tokens: readonly Token[],
  startIndex: number,
  lexicon: AceLexicon,
):
  | {
      readonly sentence: AceSentence;
      readonly nextIndex: number;
    }
  | { readonly error: AceDiagnostic } => {
  const first = tokens[startIndex];
  if (first === undefined) {
    return { error: error("expected sentence", 0, 0) };
  }

  // Every <actor> must [not] <base-verb> <determined-object>.
  if (first.text === "Every") {
    const actorResult = parseContentNoun(
      tokens,
      startIndex + 1,
      lexicon,
      "actor",
    );
    if ("error" in actorResult) return actorResult;
    const mustResult = exactWord(tokens, actorResult.nextIndex, "must");
    if ("error" in mustResult) return mustResult;

    const afterMust = tokens[mustResult.nextIndex];
    if (afterMust !== undefined && afterMust.text === "not") {
      const verbResult = parseBaseVerb(
        tokens,
        mustResult.nextIndex + 1,
        lexicon,
      );
      if ("error" in verbResult) return verbResult;
      const objectResult = parseDeterminedObject(
        tokens,
        verbResult.nextIndex,
        lexicon,
      );
      if ("error" in objectResult) return objectResult;
      const period = exactWord(tokens, objectResult.nextIndex, ".");
      if ("error" in period) return period;
      return {
        sentence: {
          kind: "prohibition_must_not",
          actor: actorResult.noun,
          verb: verbResult.verb,
          object: objectResult.object,
          location: locationOf(first.start, period.token.end),
        },
        nextIndex: period.nextIndex,
      };
    }

    const verbResult = parseBaseVerb(tokens, mustResult.nextIndex, lexicon);
    if ("error" in verbResult) return verbResult;
    const objectResult = parseDeterminedObject(
      tokens,
      verbResult.nextIndex,
      lexicon,
    );
    if ("error" in objectResult) return objectResult;
    const period = exactWord(tokens, objectResult.nextIndex, ".");
    if ("error" in period) return period;
    return {
      sentence: {
        kind: "obligation",
        actor: actorResult.noun,
        verb: verbResult.verb,
        object: objectResult.object,
        location: locationOf(first.start, period.token.end),
      },
      nextIndex: period.nextIndex,
    };
  }

  // No <actor> may <base-verb> <determined-object>.
  if (first.text === "No") {
    const actorResult = parseContentNoun(
      tokens,
      startIndex + 1,
      lexicon,
      "actor",
    );
    if ("error" in actorResult) return actorResult;
    const mayResult = exactWord(tokens, actorResult.nextIndex, "may");
    if ("error" in mayResult) return mayResult;
    const verbResult = parseBaseVerb(tokens, mayResult.nextIndex, lexicon);
    if ("error" in verbResult) return verbResult;
    const objectResult = parseDeterminedObject(
      tokens,
      verbResult.nextIndex,
      lexicon,
    );
    if ("error" in objectResult) return objectResult;
    const period = exactWord(tokens, objectResult.nextIndex, ".");
    if ("error" in period) return period;
    return {
      sentence: {
        kind: "prohibition_no_may",
        actor: actorResult.noun,
        verb: verbResult.verb,
        object: objectResult.object,
        location: locationOf(first.start, period.token.end),
      },
      nextIndex: period.nextIndex,
    };
  }

  // If a <actor> <third-person-verb> <determined-object> then the <actor> must <base-verb> <determined-object>.
  if (first.text === "If") {
    const aResult = exactWord(tokens, startIndex + 1, "a");
    if ("error" in aResult) return aResult;
    const actorResult = parseContentNoun(
      tokens,
      aResult.nextIndex,
      lexicon,
      "actor",
    );
    if ("error" in actorResult) return actorResult;
    const conditionVerb = parseThirdPersonVerb(
      tokens,
      actorResult.nextIndex,
      lexicon,
    );
    if ("error" in conditionVerb) return conditionVerb;
    const conditionObject = parseDeterminedObject(
      tokens,
      conditionVerb.nextIndex,
      lexicon,
    );
    if ("error" in conditionObject) return conditionObject;
    const thenResult = exactWord(tokens, conditionObject.nextIndex, "then");
    if ("error" in thenResult) return thenResult;
    const theResult = exactWord(tokens, thenResult.nextIndex, "the");
    if ("error" in theResult) return theResult;
    const thenActor = parseContentNoun(
      tokens,
      theResult.nextIndex,
      lexicon,
      "actor",
    );
    if ("error" in thenActor) return thenActor;
    if (thenActor.noun !== actorResult.noun) {
      return {
        error: error(
          `conditional actor mismatch: expected '${actorResult.noun}', found '${thenActor.noun}'`,
          thenActor.token.start,
          thenActor.token.end - thenActor.token.start,
        ),
      };
    }
    const mustResult = exactWord(tokens, thenActor.nextIndex, "must");
    if ("error" in mustResult) return mustResult;
    const thenVerb = parseBaseVerb(tokens, mustResult.nextIndex, lexicon);
    if ("error" in thenVerb) return thenVerb;
    const thenObject = parseDeterminedObject(
      tokens,
      thenVerb.nextIndex,
      lexicon,
    );
    if ("error" in thenObject) return thenObject;
    const period = exactWord(tokens, thenObject.nextIndex, ".");
    if ("error" in period) return period;
    return {
      sentence: {
        kind: "conditional",
        actor: actorResult.noun,
        conditionVerb: conditionVerb.verb,
        conditionObject: conditionObject.object,
        thenVerb: thenVerb.verb,
        thenObject: thenObject.object,
        location: locationOf(first.start, period.token.end),
      },
      nextIndex: period.nextIndex,
    };
  }

  // The candidate must <base-verb> <determined-object>.
  // Subject noun must be exactly "candidate", even if other nouns are declared.
  if (first.text === "The") {
    const candidateResult = parseContentNoun(
      tokens,
      startIndex + 1,
      lexicon,
      "candidate",
    );
    if ("error" in candidateResult) return candidateResult;
    if (candidateResult.noun !== "candidate") {
      return {
        error: error(
          `candidate criterion subject must be 'candidate', found '${candidateResult.noun}'`,
          candidateResult.token.start,
          candidateResult.token.end - candidateResult.token.start,
        ),
      };
    }
    const mustResult = exactWord(tokens, candidateResult.nextIndex, "must");
    if ("error" in mustResult) return mustResult;
    const verbResult = parseBaseVerb(tokens, mustResult.nextIndex, lexicon);
    if ("error" in verbResult) return verbResult;
    const objectResult = parseDeterminedObject(
      tokens,
      verbResult.nextIndex,
      lexicon,
    );
    if ("error" in objectResult) return objectResult;
    const period = exactWord(tokens, objectResult.nextIndex, ".");
    if ("error" in period) return period;
    return {
      sentence: {
        kind: "candidate_criterion",
        candidate: candidateResult.noun,
        verb: verbResult.verb,
        object: objectResult.object,
        location: locationOf(first.start, period.token.end),
      },
      nextIndex: period.nextIndex,
    };
  }

  if (SENTENCE_OPENERS.has(first.text)) {
    return {
      error: error(
        `unsupported sentence start '${first.text}'`,
        first.start,
        first.end - first.start,
      ),
    };
  }

  // Catch lowercase openers and uppercase content words with clear diagnostics.
  if (/^[A-Z]/.test(first.text) && !SENTENCE_OPENERS.has(first.text)) {
    return {
      error: error(
        `uppercase content is not allowed: '${first.text}'`,
        first.start,
        first.end - first.start,
      ),
    };
  }

  return {
    error: error(
      `unsupported sentence start '${first.text}'`,
      first.start,
      first.end - first.start,
    ),
  };
};

const renderDeterminedObject = (object: AceDeterminedObject): string =>
  `${object.determiner} ${object.noun}`;

const renderSentence = (sentence: AceSentence): string => {
  switch (sentence.kind) {
    case "obligation":
      return `Every ${sentence.actor} must ${sentence.verb} ${renderDeterminedObject(sentence.object)}.`;
    case "prohibition_must_not":
      return `Every ${sentence.actor} must not ${sentence.verb} ${renderDeterminedObject(sentence.object)}.`;
    case "prohibition_no_may":
      return `No ${sentence.actor} may ${sentence.verb} ${renderDeterminedObject(sentence.object)}.`;
    case "conditional":
      return `If a ${sentence.actor} ${sentence.conditionVerb} ${renderDeterminedObject(sentence.conditionObject)} then the ${sentence.actor} must ${sentence.thenVerb} ${renderDeterminedObject(sentence.thenObject)}.`;
    case "candidate_criterion":
      return `The ${sentence.candidate} must ${sentence.verb} ${renderDeterminedObject(sentence.object)}.`;
  }
};

/**
 * Parse Council ACE Profile 1 source against a closed lexicon.
 * This is a finite documented subset of ACE 6.7, not a full ACE parser.
 *
 * Diagnostics use original source offsets, including CRLF-bearing input.
 * Canonicalization still yields LF-only text so LF and CRLF inputs that parse
 * successfully remain byte-identical after canonicalize.
 */
export const parseCouncilAce = (
  source: string,
  lexicon: AceLexicon,
): AceParseResult => {
  if (source.length === 0) {
    return fail("empty ACE source", 0, 0);
  }

  const control = findControlCharacter(source);
  if (control !== null) {
    return fail(
      `control character U+${control.code.toString(16).padStart(4, "0").toUpperCase()} is not allowed`,
      control.index,
      1,
    );
  }

  // Pronoun scan and tokenization run on the original source so offsets after
  // CRLF map to the original string index, not a normalized LF buffer.
  const pronounMatch = PRONOUN_OR_ANAPHORA.exec(source);
  if (pronounMatch !== null) {
    return fail(
      `pronoun or anaphora is not allowed: '${pronounMatch[0]}'`,
      pronounMatch.index,
      pronounMatch[0].length,
    );
  }

  const tokens = tokenize(source);
  if (tokens.length === 0) {
    return fail("ACE source contains no tokens", 0, source.length);
  }

  const sentences: AceSentence[] = [];
  let index = 0;
  while (index < tokens.length) {
    const result = parseSentence(tokens, index, lexicon);
    if ("error" in result) {
      return { ok: false, errors: [result.error] };
    }
    sentences.push(result.sentence);
    index = result.nextIndex;
  }

  if (sentences.length === 0) {
    return fail("ACE source contains no complete sentences", 0, source.length);
  }

  // Complete-input rule: every token must be consumed by sentence parsing.
  if (index !== tokens.length) {
    const leftover = tokens[index];
    if (leftover === undefined) {
      return fail("incomplete token consumption", 0, 0);
    }
    return fail(
      `unexpected trailing input '${leftover.text}'`,
      leftover.start,
      leftover.end - leftover.start,
    );
  }

  return { ok: true, document: { sentences } };
};

export const canonicalizeCouncilAce = (document: AceDocument): string =>
  document.sentences.map(renderSentence).join("\n");

/**
 * Semantic lint for review contracts. Maps each canonical sentence onto a
 * required semantic rule identifier, permits additional task-specific candidate
 * criteria, and rejects missing, duplicate, unknown, or contradictory rules.
 */
export const validateReviewRules = (
  document: AceDocument,
): AceValidationResult => {
  const rules: SemanticRuleId[] = [];
  const seen = new Set<SemanticRuleId>();
  const candidateCriteria: string[] = [];
  const seenCriteria = new Set<string>();
  const errors: AceDiagnostic[] = [];

  for (const sentence of document.sentences) {
    const canonical = renderSentence(sentence);
    if (sentence.kind === "candidate_criterion") {
      if (seenCriteria.has(canonical)) {
        errors.push(
          error(
            `duplicate candidate criterion: ${canonical}`,
            sentence.location.offset,
            sentence.location.length,
          ),
        );
        continue;
      }
      seenCriteria.add(canonical);
      candidateCriteria.push(canonical);
      continue;
    }

    const rule = sentenceToRule.get(canonical);
    if (rule === undefined) {
      errors.push(
        error(
          `unknown semantic rule for sentence: ${canonical}`,
          sentence.location.offset,
          sentence.location.length,
        ),
      );
      continue;
    }
    if (seen.has(rule)) {
      errors.push(
        error(
          `duplicate semantic rule '${rule}'`,
          sentence.location.offset,
          sentence.location.length,
        ),
      );
      continue;
    }
    seen.add(rule);
    rules.push(rule);
  }

  for (const required of REQUIRED_SEMANTIC_RULES) {
    if (!seen.has(required)) {
      errors.push(error(`missing required semantic rule '${required}'`, 0, 0));
    }
  }

  const obligations = new Set<string>();
  const prohibitions = new Set<string>();
  for (const sentence of document.sentences) {
    if (sentence.kind === "obligation") {
      obligations.add(
        `${sentence.actor}|${sentence.verb}|${renderDeterminedObject(sentence.object)}`,
      );
    }
    if (sentence.kind === "prohibition_must_not") {
      prohibitions.add(
        `${sentence.actor}|${sentence.verb}|${renderDeterminedObject(sentence.object)}`,
      );
    }
  }
  for (const key of obligations) {
    if (prohibitions.has(key)) {
      errors.push(
        error(
          `contradictory obligation and prohibition for '${key.replaceAll("|", " ")}'`,
          0,
          0,
        ),
      );
    }
  }

  if (errors.length > 0) {
    const [first, ...rest] = errors;
    if (first === undefined) {
      return {
        ok: false,
        errors: [error("semantic validation failed", 0, 0)],
      };
    }
    return { ok: false, errors: [first, ...rest] };
  }

  return { ok: true, rules, candidateCriteria };
};

export const canonicalReviewRuleSource = (): string =>
  CANONICAL_RULE_SENTENCES.map((entry) => entry.sentence).join("\n");

export const reviewRuleLexicon = (): AceLexicon => ({
  nouns: [
    "reviewer",
    "candidate",
    "bundle-identity",
    "required-artifact",
    "acceptance-criterion",
    "material-finding",
    "final-response",
    "premature-response",
    "material-defect",
    "change",
    "abstention",
    "required-evidence-gap",
  ],
  verbs: [
    { base: "verify", thirdPerson: "verifies" },
    { base: "inspect", thirdPerson: "inspects" },
    { base: "evaluate", thirdPerson: "evaluates" },
    { base: "cite", thirdPerson: "cites" },
    { base: "emit", thirdPerson: "emits" },
    { base: "detect", thirdPerson: "detects" },
    { base: "request", thirdPerson: "requests" },
    { base: "approve", thirdPerson: "approves" },
    { base: "reserve", thirdPerson: "reserves" },
    { base: "identify", thirdPerson: "identifies" },
  ],
});
