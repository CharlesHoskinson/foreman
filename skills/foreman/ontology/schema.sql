-- ============================================================================
-- .foreman/ontology.db -- SQLite ontology, replacing the withdrawn TerminusDB
-- schema. Each block names the TerminusDB construct it replaces.
--
-- Decided 2026-07-30 after a four-lens council. TerminusDB was withdrawn (a
-- server, auth and an operations package against a release that moved all CI
-- local); sqlite-graph was disqualified (zero schema enforcement, silently wrong
-- answers, cannot load under Python's stdlib sqlite3, no variable-length path
-- operator so it cannot express a supersession chain).
--
-- This file is the single authoritative definition of the ontology.
-- ============================================================================
PRAGMA foreign_keys = ON;      -- MUST be set per connection; SQLite defaults OFF
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
INSERT OR REPLACE INTO meta(key,value) VALUES
  ('ontology_version','v0.2.9-sqlite.1'),
  ('hash_algorithm','sha256/canonical-json-v1');

-- <- replaces: abstract GraphNode/WorkNode and the "Entity inherits GraphNode
--    never WorkNode" disjointness. The frozen design conceded this was
--    "enforced by discipline, not the store" and needed an external lint that
--    never got written. The composite FK below enforces it in the engine, so
--    this is STRICTLY STRONGER than what it replaces.
CREATE TABLE IF NOT EXISTS node_kind (
  kind  TEXT PRIMARY KEY,
  plane TEXT NOT NULL CHECK (plane IN ('work','artifact','knowledge','lineage')),
  UNIQUE (kind, plane)
);
INSERT OR IGNORE INTO node_kind(kind,plane) VALUES
  ('Task','work'),('Round','work'),('Attempt','work'),('Agent','work'),
  ('AgentRun','work'),('Evaluation','work'),('Finding','work'),
  ('Metric','work'),('Measurement','work'),
  ('Spec','artifact'),('Commit','artifact'),('Source','artifact'),
  ('Claim','knowledge'),('Entity','knowledge'),
  ('Supersession','lineage');

CREATE TABLE IF NOT EXISTS node (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL,
  plane      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  run_id     TEXT,
  FOREIGN KEY (kind, plane) REFERENCES node_kind(kind, plane),   -- disjointness
  CHECK (created_at GLOB
    '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'),
  UNIQUE (id, kind),      -- composite-FK target for child tables
  UNIQUE (id, plane)
);
CREATE INDEX IF NOT EXISTS ix_node_kind ON node(kind);

-- <- replaces: Provenance (@subdocument, @key ValueHash). Not a node.
CREATE TABLE IF NOT EXISTS provenance (
  id                 INTEGER PRIMARY KEY,
  extractor_is_human INTEGER NOT NULL CHECK (extractor_is_human IN (0,1)),
  extracted_at       TEXT NOT NULL,
  confidence         TEXT NOT NULL CHECK (confidence IN
                       ('extracted','inferred','ambiguous')),   -- <- ConfidenceLevel
  source_locator     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commit_node (
  node_id INTEGER PRIMARY KEY,
  kind    TEXT NOT NULL DEFAULT 'Commit' CHECK (kind = 'Commit'),
  sha     TEXT NOT NULL UNIQUE                                   -- <- @key Lexical
            CHECK (length(sha) BETWEEN 7 AND 64 AND sha NOT GLOB '*[^0-9a-f]*'),
  FOREIGN KEY (node_id, kind) REFERENCES node(id, kind) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entity (
  node_id    INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'Entity' CHECK (kind = 'Entity'),
  entity_key TEXT NOT NULL UNIQUE,                               -- <- @key Lexical
  ekind      TEXT NOT NULL CHECK (ekind IN                       -- <- EntityKind
               ('person','organization','system','concept','standard',
                'tool','file','other')),
  FOREIGN KEY (node_id, kind) REFERENCES node(id, kind) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS claim (
  node_id       INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'Claim' CHECK (kind = 'Claim'),
  claim_key     TEXT NOT NULL UNIQUE,                            -- <- @key Lexical
  text          TEXT NOT NULL CHECK (length(trim(text)) > 0),
  status        TEXT NOT NULL CHECK (status IN                   -- <- ClaimStatus
                  ('live','superseded','retracted')),
  provenance_id INTEGER NOT NULL REFERENCES provenance(id) ON DELETE RESTRICT,
  FOREIGN KEY (node_id, kind) REFERENCES node(id, kind) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_claim_status ON claim(status);

CREATE TABLE IF NOT EXISTS claim_contradicts (                   -- <- @type Set
  claim_id       INTEGER NOT NULL REFERENCES claim(node_id) ON DELETE CASCADE,
  contradicts_id INTEGER NOT NULL REFERENCES claim(node_id) ON DELETE CASCADE,
  PRIMARY KEY (claim_id, contradicts_id),
  CHECK (claim_id <> contradicts_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_contradicts_rev ON claim_contradicts(contradicts_id);

CREATE TABLE IF NOT EXISTS metric (
  node_id INTEGER PRIMARY KEY,
  kind    TEXT NOT NULL DEFAULT 'Metric' CHECK (kind = 'Metric'),
  name    TEXT NOT NULL UNIQUE,                                  -- <- @key Lexical
  FOREIGN KEY (node_id, kind) REFERENCES node(id, kind) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS measurement (                         -- <- @key ValueHash
  node_id    INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'Measurement' CHECK (kind = 'Measurement'),
  metric_id  INTEGER NOT NULL REFERENCES metric(node_id) ON DELETE RESTRICT,
  subject_id INTEGER NOT NULL REFERENCES commit_node(node_id) ON DELETE CASCADE,
  value      NUMERIC NOT NULL CHECK (typeof(value) IN ('integer','real')),
  value_text TEXT NOT NULL,     -- exact decimal lexical form
  detail     TEXT,
  at         TEXT NOT NULL,
  FOREIGN KEY (node_id, kind) REFERENCES node(id, kind) ON DELETE CASCADE,
  UNIQUE (metric_id, subject_id, value_text, at)   -- the real key behind the hash
);

-- NAMED DEVIATION from the frozen schema: Measurement had no `about`. The links
-- design calls this "the highest-value link", because the ontology Measurement
-- has no scope field and therefore cannot compute staleness at all.
CREATE TABLE IF NOT EXISTS measurement_about (
  measurement_id INTEGER NOT NULL REFERENCES measurement(node_id) ON DELETE CASCADE,
  entity_id      INTEGER NOT NULL REFERENCES entity(node_id) ON DELETE CASCADE,
  PRIMARY KEY (measurement_id, entity_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS finding (
  node_id  INTEGER PRIMARY KEY,
  kind     TEXT NOT NULL DEFAULT 'Finding' CHECK (kind = 'Finding'),
  severity TEXT NOT NULL CHECK (severity IN                      -- <- FindingSeverity
             ('info','minor','major','critical')),
  text     TEXT NOT NULL CHECK (length(trim(text)) > 0),
  at       TEXT NOT NULL,
  FOREIGN KEY (node_id, kind) REFERENCES node(id, kind) ON DELETE CASCADE,
  UNIQUE (severity, text, at)
);
CREATE INDEX IF NOT EXISTS ix_finding_severity ON finding(severity);

-- <- replaces: reified Supersession. A real table carrying `at` and `reason`,
--    NOT a nullable FK: the frozen design reified it precisely because
--    "a plain field cannot carry them".
CREATE TABLE IF NOT EXISTS supersession (
  node_id INTEGER PRIMARY KEY,
  kind    TEXT NOT NULL DEFAULT 'Supersession' CHECK (kind = 'Supersession'),
  old_id  INTEGER NOT NULL REFERENCES node(id) ON DELETE CASCADE,
  new_id  INTEGER NOT NULL REFERENCES node(id) ON DELETE CASCADE,
  at      TEXT NOT NULL,
  reason  TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  FOREIGN KEY (node_id, kind) REFERENCES node(id, kind) ON DELETE CASCADE,
  CHECK (old_id <> new_id)
);
-- STRENGTHENING beyond the frozen schema: at most one successor per node.
-- Two successors make "the head of the chain" ill-defined; TerminusDB permitted
-- it, which was a latent defect.
CREATE UNIQUE INDEX IF NOT EXISTS ux_supersession_old ON supersession(old_id);

-- ============================================================================
-- Lint views. These replace the "external N4 lint check" the frozen design
-- asked for and never got. All MUST return zero rows.
-- ============================================================================
CREATE VIEW IF NOT EXISTS lint_plane_violation AS
  SELECT n.id, n.kind, n.plane FROM node n
  LEFT JOIN node_kind k ON k.kind = n.kind AND k.plane = n.plane
  WHERE k.kind IS NULL;

CREATE VIEW IF NOT EXISTS lint_knowledge_in_work AS
  SELECT n.id, n.kind FROM node n
  WHERE n.kind IN ('Claim','Entity') AND n.plane <> 'knowledge';

CREATE VIEW IF NOT EXISTS lint_orphan_provenance AS
  SELECT p.id FROM provenance p
  WHERE NOT EXISTS (SELECT 1 FROM claim c WHERE c.provenance_id = p.id);

-- Supersession cycles. Depth-capped and path-guarded: SQLite has no CYCLE
-- clause, and the unguarded form was measured to hang (timeout 8 -> exit 124).
CREATE VIEW IF NOT EXISTS lint_supersession_cycle AS
  WITH RECURSIVE w(seed, node_id, depth, path) AS (
      SELECT old_id, old_id, 0, '/' || old_id || '/' FROM supersession
    UNION ALL
      SELECT w.seed, s.new_id, w.depth + 1, w.path || s.new_id || '/'
        FROM w JOIN supersession s ON s.old_id = w.node_id
       WHERE w.depth < 256
         AND instr(w.path, '/' || s.new_id || '/') = 0
  )
  SELECT DISTINCT w.seed AS node_id
    FROM w JOIN supersession s ON s.old_id = w.node_id
   WHERE s.new_id = w.seed;

-- ============================================================================
-- Traversals, shipped as views so a caller cannot forget the cycle guard.
-- Path delimiters are '/id/' so instr() cannot match 12 inside /123/.
-- ============================================================================

-- The head of every supersession chain. `still_superseded` is load-bearing:
-- 0 means a true head, non-zero means the walk stopped on a guard rather than
-- at a head. A caller that ignores it will quote a superseded claim as current.
CREATE VIEW IF NOT EXISTS claim_head AS
  WITH RECURSIVE chain(seed, node_id, depth, path) AS (
      SELECT node_id, node_id, 0, '/' || node_id || '/' FROM claim
    UNION ALL
      SELECT ch.seed, s.new_id, ch.depth + 1, ch.path || s.new_id || '/'
        FROM chain ch JOIN supersession s ON s.old_id = ch.node_id
       WHERE ch.depth < 64
         AND instr(ch.path, '/' || s.new_id || '/') = 0
  )
  SELECT c0.claim_key AS seed_key,
         ch.depth     AS hops,
         ck.claim_key AS head_key,
         ck.status    AS head_status,
         (SELECT COUNT(*) FROM supersession s2 WHERE s2.old_id = ch.node_id)
           AS still_superseded
    FROM chain ch
    JOIN claim c0 ON c0.node_id = ch.seed
    JOIN claim ck ON ck.node_id = ch.node_id
   WHERE ch.depth = (SELECT MAX(d.depth) FROM chain d WHERE d.seed = ch.seed);

-- Transitive contradiction. UNION (not UNION ALL) dedupes, so a cycle
-- terminates by construction and no depth cap is required.
-- Caveat: contradiction is NOT transitive. A contradicts B and B contradicts C
-- does not entail A contradicts C. This is reachability, not entailment.
CREATE VIEW IF NOT EXISTS claim_contradiction_reach AS
  WITH RECURSIVE
    cedge(a, b) AS (
        SELECT claim_id, contradicts_id FROM claim_contradicts
      UNION
        SELECT contradicts_id, claim_id FROM claim_contradicts
    ),
    reach(seed, node_id) AS (
        SELECT node_id, node_id FROM claim
      UNION
        SELECT r.seed, e.b FROM reach r JOIN cedge e ON e.a = r.node_id
    )
  SELECT cs.claim_key AS seed_key, cr.claim_key AS contradicts_key
    FROM reach r
    JOIN claim cs ON cs.node_id = r.seed
    JOIN claim cr ON cr.node_id = r.node_id
   WHERE r.seed <> r.node_id;
