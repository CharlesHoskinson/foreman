# Tasks -- terminusdb-schema

Ordering note: T1 is the schema document itself and must land before
anything in graph-store-port that registers or validates against it. T2 is
the competency-question audit, done against the finished T1 schema, not
before. T3 is the gate.

## T1 -- author the frozen schema

- [ ] Write design.md JSON schema exactly as specified -- 12 enums,
      Provenance (subdocument), EvaluationTarget (TaggedUnion),
      GraphNode/WorkNode/Artifact (abstract), and the 15 concrete
      classes.
- [ ] Confirm no class or property is named parent_of/PARENT_OF; confirm
      has_attempt, depends_on (on Task and Artifact separately), and
      broader_than each exist on exactly the class documented.
- [ ] Confirm EvaluationTarget is referenced from both Evaluation.target
      (required) and Finding.about (optional).
- [ ] Confirm Entity.resolved_to is Optional of Entity and
      resolved_reviewed_by is present.
- [ ] Confirm Supersession exists as a top-level class and no plain
      supersedes field exists on GraphNode.
- [ ] Confirm no Mention class and no mentions property exist anywhere.
- [ ] Confirm every LLM-populated field (Provenance.confidence,
      Claim.status, Entity.kind) is a closed enum, and that
      Measurement.value is the one documented xsd:decimal exception.
- [ ] Confirm Claim, Evaluation, Finding, Source carry no
      @subdocument, and that Provenance (the only subdocument) keys
      ValueHash, not Lexical.
- [ ] Confirm AgentRun.invocation_id, .external_params are Optional,
      and .resolved_deps carries no @min_cardinality.

## T2 -- competency question audit

- [ ] Walk all 24 of N2 competency questions (docs/research/vnext/
      N2-ontology-engineering.md section 9) against the finished schema.
- [ ] Confirm the mapping table in design.md matches the actual schema
      field names exactly (not the earlier N2 draft field names, where
      they differ).
- [ ] Confirm exactly two questions are recorded as gaps (CQ-16, CQ-22) and
      no others are silently unmapped.

## T3 -- gate

- [ ] openspec validate terminusdb-schema --strict passes.
- [ ] markdownlint-cli2 clean on all four files.
- [ ] The JSON schema block in design.md is valid JSON (parse it
      standalone to confirm -- copy the fenced block content to a temp file
      and run it through a JSON parser).
- [ ] bugeventlog.md appended with any workflow friction encountered while
      authoring this package (or a note that none occurred).
