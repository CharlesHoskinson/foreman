## Purpose

Defines supervised, budgeted research with Scrapling, PixelRAG, and Graphify while keeping all retrieved and derived material quarantined and non-authoritative.

## ADDED Requirements

### Requirement: Research tools run through one gateway
Council SHALL invoke Scrapling, PixelRAG, Graphify, and deterministic verifiers only through a tool gateway that enforces capabilities, budgets, process ownership, authority labels, and artifact lineage.

#### Scenario: Worker invokes a research binary directly
- **WHEN** a provider worker attempts to bypass the tool gateway
- **THEN** Council denies execution and records an unauthorized-tool event

### Requirement: Scrapling collection is scoped and sanitized
Council SHALL use pinned Scrapling 0.4.12 targeted extraction with validated destinations, approved selectors or crawl policy, robots and rate policy, page and byte limits, redirect checks, and quarantined outputs.

#### Scenario: Crawl exceeds its approved page limit
- **WHEN** Scrapling reaches the task contract's maximum page count
- **THEN** the gateway stops the crawl and preserves the collected artifacts with a limit-reached status

### Requirement: PixelRAG capture is visually verified
A successful PixelRAG 0.4.0 exit MUST NOT establish capture success without manifest validation, source binding, tile checks, dimensions, nonblank sampling, and atomic completion.

#### Scenario: Browser PDF viewer renders blank tiles
- **WHEN** PixelRAG exits zero but the produced tiles are blank or unbound to the source
- **THEN** Council rejects the capture and prevents downstream citation of those tiles

### Requirement: Graphify is queried before broad graph-corpus reads
Council SHALL query an existing `graphify-out/graph.json` before broad corpus ingestion and SHALL preserve node or edge confidence and source location in resulting evidence.

#### Scenario: Existing graph contains relevant concepts
- **WHEN** graph vocabulary matches the research question
- **THEN** Council records the expanded graph query and uses returned source references before scheduling broader reads

### Requirement: Graph mutations require separate authority
Read-only Graphify queries SHALL NOT imply permission for graph build, update, watch, reflection, save-result, or export operations.

#### Scenario: Worker requests graph update during research
- **WHEN** the task contract grants only graph-query capability
- **THEN** Council denies the update while preserving read-only query access

### Requirement: Raw and derived evidence remains quarantined
Council SHALL store raw fetched bytes outside model context and provide only bounded, inert, selector-scoped extracts with artifact identifiers; text, pixels, OCR, metadata, and tool output MUST remain `untrusted_evidence`.

#### Scenario: Hidden page content contains instructions
- **WHEN** extraction finds active, invisible, or instruction-like content
- **THEN** Council sanitizes or isolates it and does not permit it to modify control flow

### Requirement: Tool artifacts are immutable and bounded
Every research stage SHALL write to an attempt-specific location, publish artifacts atomically, verify content hashes, and enforce configured time, file, pixel, event, and byte limits.

#### Scenario: Tool writes outside its attempt directory
- **WHEN** a research process attempts path traversal or an undeclared output path
- **THEN** Council blocks the write and marks the stage as a security failure
