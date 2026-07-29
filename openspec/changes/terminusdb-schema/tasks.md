# Tasks -- terminusdb-schema

Ordering note: T1 is the schema document itself and must land before
anything in graph-store-port that registers or validates against it. T2 is
the competency-question audit, done against the finished T1 schema, not
before. T3 is the gate.

## T1 -- author the frozen schema

- [x] Write design.md JSON schema exactly as specified -- 12 enums,
      Provenance (subdocument), EvaluationTarget (TaggedUnion),
      GraphNode/WorkNode/Artifact (abstract), and the 15 concrete
      classes.
- [x] Confirm no class or property is named parent_of/PARENT_OF; confirm
      has_attempt, subtask_of (Task, Optional<Task>), depends_on (Task,
      dependency-only), artifact_depends_on (Artifact), and broader_than
      (Entity) each exist on exactly the class documented, and that
      subtask_of and depends_on are never merged.
- [x] Confirm GraphNode.graphify_version exists as Optional xsd:string
      and is inherited by every concrete class.
- [x] Confirm EvaluationTarget is referenced from both Evaluation.target
      (required) and Finding.about (optional).
- [x] Confirm Entity.resolved_to is Optional of Entity and
      resolved_reviewed_by is present.
- [x] Confirm Supersession exists as a top-level class and no plain
      supersedes field exists on GraphNode.
- [x] Confirm no Mention class and no mentions property exist anywhere.
- [x] Confirm every LLM-populated field (Provenance.confidence,
      Claim.status, Entity.kind) is a closed enum, and that
      Measurement.value is the one documented xsd:decimal exception.
- [x] Confirm Claim, Evaluation, Finding, Source carry no
      @subdocument, and that Provenance (the only subdocument) keys
      ValueHash, not Lexical.
- [x] Confirm AgentRun.invocation_id, .external_params are Optional,
      and .resolved_deps carries no @min_cardinality.

## T2 -- competency question audit

- [x] Walk all 24 of N2 competency questions (docs/research/vnext/
      N2-ontology-engineering.md section 9) against the finished schema.
- [x] Confirm the mapping table in design.md matches the actual schema
      field names exactly (not the earlier N2 draft field names, where
      they differ).
- [x] Confirm exactly two questions are recorded as gaps (CQ-16, CQ-22) and
      no others are silently unmapped.
- [x] Confirm the graphify -> schema mapping manifest (design.md) covers
      all six node file_type values and states an explicit fail/drop rule
      for everything else, including hyperedges.

## T3 -- gate

- [x] openspec validate terminusdb-schema --strict passes.
- [x] markdownlint-cli2 clean on all four files.
- [x] The JSON schema block in design.md is loaded live and verified, not
      just parsed: extract the fenced JSON block from design.md
      deterministically (the largest parseable fenced JSON block in the
      file); start a fresh pinned `terminusdb/terminusdb-server:v12.0.6`
      container (digest
      `sha256:e02eaa3a5b75e01550cee2a662a846db7fceb725193983f1f35e1842ab580fee`);
      run these four checks and assert success on each:
      1. `POST /api/document/admin/foreman?graph_type=schema&full_replace=true`
         with the extracted schema -- assert HTTP 200.
      2. `GET /api/document/admin/foreman?graph_type=schema&as_list=true` --
         assert every declared class and enum name from the extracted
         schema is present in the response.
      3. `POST /api/document/admin/foreman?author=schema-gate&message=positive-fixture`
         with a well-formed Agent instance document -- assert HTTP 200/201
         (positive fixture).
      4. `POST /api/document/admin/foreman?author=schema-gate&message=negative-fixture`
         with an Agent instance carrying an invalid `vendor` enum value --
         assert the write is rejected (negative fixture).
      Tear the container down after. This is four curl calls and completes
      in under ten seconds; it replaces the JSON-parse-only check, it does
      not supplement it with a slower alternative.
- [x] Live load-test gate above is required (not optional): all four
      checks pass against the pinned v12.0.6 container.
- [x] bugeventlog.md appended with any workflow friction encountered while
      authoring this package (or a note that none occurred).
