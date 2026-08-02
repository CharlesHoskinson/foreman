## Purpose

Defines durable identity and lineage for evidence, transformations, model artifacts, claims, citations, and candidate contributions without confusing provenance with truth or authority.

## ADDED Requirements

### Requirement: Every artifact has content-bound identity
Council SHALL identify every raw object, extract, model output, ballot, judgment, synthesis, and report by a stable artifact identifier with hash, media type, size, time, producer, authority, and validation status.

#### Scenario: Artifact content changes
- **WHEN** artifact content changes by any byte or canonical field
- **THEN** Council creates a new identity and records its relationship to the prior artifact

### Requirement: Lineage is PROV-compatible
Council SHALL represent artifacts as entities, transformations as activities, and responsible tools or workers as agents, including generation, use, derivation, attribution, association, and primary-source relations where applicable.

#### Scenario: OCR derives text from a page
- **WHEN** OCR produces text from a PDF page
- **THEN** Council records the input entity, OCR activity, OCR agent, and derived text entity

### Requirement: Transformations record reproducibility metadata
Every transformation SHALL record tool and version, configuration hash, input and output artifact identifiers, relevant policy, and deterministic seed when used.

#### Scenario: Extractor version is missing
- **WHEN** a derived artifact lacks its extractor version
- **THEN** Council marks its lineage incomplete and excludes it from verified material claims

### Requirement: Provenance, truth, quality, support, and authority are separate
Council MUST preserve independent typed states for lineage integrity, signer trust, source quality, factual support, and instruction authority.

#### Scenario: C2PA lineage validates
- **WHEN** an image has a valid manifest from a trusted signer
- **THEN** Council records valid signer-bound lineage without marking the image true or authoritative

### Requirement: Material claims use exact evidence locators
Each material factual claim SHALL map to one or more artifact identifiers and resolvable spans, pages, timestamps, regions, or graph source locations with `supports`, `contradicts`, `context_only`, or `unresolved` relation.

#### Scenario: Citation resolves only to a home page
- **WHEN** a material claim has no exact locator in its cited artifact
- **THEN** Council marks the citation unresolved and does not present the claim as verified

### Requirement: Citation support is verified separately
Council SHALL verify locator resolution, artifact hash, quoted-span fidelity, and semantic support outside synthesis and SHALL classify material claims as `verified`, `disputed`, `unsupported`, or `unverifiable`.

#### Scenario: Source contradicts its adjacent claim
- **WHEN** the cited evidence contradicts a material claim
- **THEN** Council removes the claim or presents it as disputed with the contradiction

### Requirement: Synthesis preserves candidate lineage
Council SHALL record which admissible candidate supplied each material claim, recommendation, objection, and dissent.

#### Scenario: Synthesis combines two proposals
- **WHEN** a final claim derives from content in two candidates
- **THEN** Council records both candidate artifacts and the synthesis activity
