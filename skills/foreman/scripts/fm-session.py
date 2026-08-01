#!/usr/bin/env python3
# @description Foreman session + canonical recovery store (SQLite).
#
#   ONE canonical recovery. A session begins, recovers the previous context, and
#   gets a launch point. No prose to reconcile, no three files to cross-read.
#
#   The design decision that matters: a recovery record is TYPED, and a
#   measurement's validity is COMPUTED AT READ TIME, never stored. A consumer
#   physically cannot receive "tests 26/26 green" without a freshness verdict
#   riding alongside it. This exists because the failure being fixed is not
#   "we lost the note" -- it is "we quoted a number that was true three hours
#   and eleven commits ago".
#
#   Three record kinds, deliberately distinct:
#     fact        durable, true by construction once established (a commit landed)
#     measurement perishable: bound to a tree SHA and a path scope, and
#                 automatically STALE once any commit touches that scope
#     obligation  owed work: open | blocked | done
#
#   Staleness is a git question, not a TTL: a measurement is stale iff
#   `git rev-list <measured_sha>..HEAD -- <scope_paths>` is non-empty. A TTL
#   encodes a guess; this encodes the truth.
#
#   Liveness is deliberately NOT storable. Process state goes stale in seconds
#   and a minutes-old reading must never round-trip as current, so it is not a
#   record kind at all. Ask the process, not the database.
#
#   Retrieval is exact SQL, never similarity search. Canonical recovery must be
#   reproducible: two resumes of the same tree must see the same world.
#
# Usage:
#   fm-session.py begin [--note TEXT]        start a session; prints recovery
#   fm-session.py recover [--json]           canonical recovery, no side effects
#   fm-session.py freshness [--stale-only] [--format text|tsv]
#   fm-session.py end [SESSION_ID]           close a session
#   fm-session.py fact <statement> [--evidence E]
#   fm-session.py measure <metric> <value> --command CMD [--scope PATH ...]
#   fm-session.py obligation <statement> [--blocker B]
#   fm-session.py close <obligation_id> [--status done|blocked] [--blocker B]
#   fm-session.py supersede <fact_id> <new_statement> [--evidence E]
#   fm-session.py retire <measurement_id> --by <id> --reason TEXT
#   fm-session.py sidecar [--out PATH]
#   fm-session.py import-sidecar PATH [--into DB] [--force]
#
# Env:
#   FOREMAN_SESSION_DB   override db path. The default is .foreman/session.db
#                        beside the COMMON git dir, so every worktree of one
#                        repository shares a single store.
#
# @exitcode 0 ok; 2 usage error
import argparse
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
import pathlib

SCHEMA_VERSION = 3

# Commands that only read the store. Opening these read-only is what makes their
# documented "no side effects" true, and they are also the commands that must NOT
# trigger a sidecar refresh. The sidecar command writes a file, never the store.
READ_ONLY_CMDS = {"recover", "freshness", "project", "sidecar"}
SIDECAR_FORMAT = "foreman-session-sidecar"
SIDECAR_FORMAT_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id  TEXT PRIMARY KEY,
  started_ts  TEXT NOT NULL,
  start_sha   TEXT,
  ended_ts    TEXT,
  note        TEXT
);

CREATE TABLE IF NOT EXISTS facts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  statement      TEXT NOT NULL,
  evidence       TEXT,
  established_ts TEXT NOT NULL,
  session_id     TEXT,
  superseded_by  INTEGER REFERENCES facts(id),
  -- v2: the ontology reifies SUPERSEDES precisely because it must carry `at`
  -- and `reason` ("a plain field cannot carry them"). A bare foreign key made
  -- a superseded fact unauditable: you could see that it was replaced but
  -- never why.
  superseded_at   TEXT,
  supersede_reason TEXT
);

CREATE TABLE IF NOT EXISTS measurements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  metric       TEXT NOT NULL,
  value        TEXT NOT NULL,
  command      TEXT,
  measured_ts  TEXT NOT NULL,
  measured_sha TEXT,
  scope_paths  TEXT,
  session_id   TEXT,
  -- v2: the ontology's Measurement.value is xsd:decimal. `value` here is the
  -- human string ("447 pass / 0 fail / 19 skip"), which does not project.
  -- value_num carries the projectable scalar; NULL means "not a scalar", which
  -- the projector reports rather than silently coercing.
  value_num    REAL
  ,
  -- v3: a measurement proven wrong must be retirable. Its successor is already
  -- a row, so this points the old row at the new one. Rows are never deleted.
  superseded_by    INTEGER REFERENCES measurements(id),
  superseded_at    TEXT,
  supersede_reason TEXT
);

CREATE TABLE IF NOT EXISTS obligations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  statement  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',
  blocker    TEXT,
  opened_ts  TEXT NOT NULL,
  closed_ts  TEXT,
  session_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_meas_metric ON measurements(metric);
CREATE INDEX IF NOT EXISTS idx_oblig_status ON obligations(status);
CREATE INDEX IF NOT EXISTS idx_facts_superseded ON facts(superseded_by);
"""


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def repo_root():
    """The directory holding the COMMON git dir, identical from every worktree.

    --show-toplevel differs per worktree, which gave each worktree its own
    session.db and fragmented the store. --git-common-dir returns the same
    path from all of them. --path-format=absolute is required: the bare form
    returns a relative '.git' from the main worktree."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return Path(out).resolve().parent
    except Exception:
        return Path.cwd()


def git_sha():
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except Exception:
        return None


def warn_orphan_store(chosen):
    """Name a second store that nothing reads any more.

    repo_root() moved from --show-toplevel to --git-common-dir. Every worktree
    that already held its own .foreman/session.db still holds it, and nothing
    reads it now. Silence there is the same defect this store exists to stop:
    a record on disk that no consumer ever sees. The warning goes to stderr,
    because `recover --json` and `project` write machine-readable stdout."""
    try:
        top = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except Exception:
        return
    if not top:
        return
    orphan = (Path(top) / ".foreman" / "session.db").resolve()
    if orphan == Path(chosen).resolve() or not orphan.exists():
        return
    print(f"WARNING: an orphaned session store sits at {orphan}. "
          f"Nothing reads it. The store in use is {chosen}.", file=sys.stderr)


def db_path():
    env = os.environ.get("FOREMAN_SESSION_DB")
    if env:
        return Path(env)
    d = repo_root() / ".foreman"
    d.mkdir(parents=True, exist_ok=True)
    chosen = d / "session.db"
    warn_orphan_store(chosen)
    return chosen


def connect_readonly(path=None):
    """Open the store for a genuine read, or fall back when that is impossible.

    `recover` and `freshness` document themselves as having no side effects, and
    they did not: connect() runs the schema DDL and unconditionally does an
    INSERT OR REPLACE into schema_meta followed by a commit, so EVERY read
    rewrote the file. Measured -- the checksum changed on each successive
    `recover`, and the store showed as modified in `git status` immediately
    after a read with no other command in between. That made "the tree is clean"
    unverifiable: you could never tell a recorded fact from a look.

    A missing store still needs creating, and a schema older than this build
    still needs migrating, so both fall back to the writable path. The read-only
    open is an optimisation of the common case, not a guarantee we can always
    honour -- callers must not depend on it for correctness.
    """
    p = Path(path) if path is not None else db_path()
    if not p.exists():
        return connect(p)
    try:
        conn = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        # A store predating this schema version cannot be read correctly without
        # the migration in connect(); detect that and hand back a writable one.
        have = {r["name"] for r in conn.execute("PRAGMA table_info(measurements)")}
        if not {"value_num", "superseded_by"} <= have:
            conn.close()
            return connect(p)
        return conn
    except sqlite3.Error:
        return connect(p)


def connect(path=None):
    p = Path(path) if path is not None else db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(p))
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    # Migrate pre-v2 databases in place. SQLite has no ALTER..IF NOT EXISTS,
    # so probe the table shape instead of tracking a migration ledger.
    def cols(table):
        return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
    for table, col, decl in (
        ("facts", "superseded_at", "TEXT"),
        ("facts", "supersede_reason", "TEXT"),
        ("measurements", "value_num", "REAL"),
        ("measurements", "superseded_by", "INTEGER"),
        ("measurements", "superseded_at", "TEXT"),
        ("measurements", "supersede_reason", "TEXT"),
    ):
        if col not in cols(table):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
    conn.execute(
        "INSERT OR REPLACE INTO schema_meta(key,value) VALUES('version',?)",
        (str(SCHEMA_VERSION),),
    )
    conn.commit()
    _rebuild_from_sidecar_if_empty(conn, p)
    return conn


def _rebuild_from_sidecar_if_empty(conn, p):
    """Rehydrate an empty store from the NDJSON sidecar sitting beside it.

    The sidecar is the tracked artefact and the .db is a derived cache, so a
    fresh clone has session.ndjson and no session.db at all. Without this, the
    first `recover` on a new machine would create an empty database and print a
    confident, empty recovery -- the recovery mechanism failing silently at
    exactly the moment it exists for. That is strictly worse than crashing.

    Only ever fires when the store has NO rows. A store with content is never
    touched, so this cannot overwrite work or resurrect retired rows.
    """
    try:
        row = conn.execute(
            "SELECT (SELECT COUNT(*) FROM facts)"
            " + (SELECT COUNT(*) FROM measurements)"
            " + (SELECT COUNT(*) FROM obligations)"
            " + (SELECT COUNT(*) FROM sessions) AS n"
        ).fetchone()
    except sqlite3.Error:
        return
    if row is None or row["n"]:
        return

    sidecar = Path(p).with_suffix(".ndjson")
    if not sidecar.exists():
        return
    try:
        n = import_sidecar(conn, sidecar)
    except Exception as e:  # a corrupt sidecar must be loud, never silent
        print(f"WARNING: session store is empty and the sidecar at {sidecar} "
              f"could not be imported: {e}", file=sys.stderr)
        return
    print(f"rehydrated {n} row(s) from {sidecar} (the .db is a derived cache; "
          f"the sidecar is what git tracks)", file=sys.stderr)


def scalar_of(text):
    """Leading scalar of a value string, or None.

    "447 pass / 0 fail" -> 447.0 ; "26" -> 26.0 ; "green" -> None.
    Deliberately conservative: a value whose scalar is ambiguous projects as
    NULL and is reported, never guessed at."""
    import re
    m = re.match(r"\s*(-?\d+(?:\.\d+)?)", text or "")
    return float(m.group(1)) if m else None


def mint_session_id():
    # Time-sortable and human-readable. Lexical order == chronological order,
    # which matters because recovery reads "the most recent session" constantly.
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + os.urandom(3).hex()


# --- the mechanism: validity computed at read time -------------------------
def measurement_validity(measured_sha, scope_paths):
    """fresh | stale | unknown, computed now against HEAD.

    A measurement is STALE the moment any commit touches the paths it was
    measured over. This is what makes it impossible to quote a test count from
    eleven commits ago as if it were current."""
    if not measured_sha:
        return "unknown", "no measured_sha recorded"
    paths = [p for p in (scope_paths or "").split("\n") if p.strip()]
    if not paths:
        return "unknown", "no scope_paths recorded; cannot bound what invalidates it"
    try:
        cmd = ["git", "rev-list", f"{measured_sha}..HEAD", "--"] + paths
        out = subprocess.run(cmd, capture_output=True, text=True)
        if out.returncode != 0:
            return "unknown", f"git rev-list failed: {out.stderr.strip()[:80]}"
        commits = [c for c in out.stdout.split("\n") if c.strip()]
        if commits:
            return "stale", f"{len(commits)} commit(s) touched its scope since measurement"
        return "fresh", "no commit has touched its scope since measurement"
    except Exception as e:  # pragma: no cover
        return "unknown", f"{type(e).__name__}: {e}"


def build_recovery(conn):
    head = git_sha()
    cur = conn.cursor()

    sess = cur.execute(
        "SELECT * FROM sessions ORDER BY session_id DESC LIMIT 1"
    ).fetchone()

    facts = [
        {"kind": "fact", "id": r["id"], "statement": r["statement"],
         "evidence": r["evidence"], "established_ts": r["established_ts"]}
        for r in cur.execute(
            "SELECT * FROM facts WHERE superseded_by IS NULL ORDER BY id DESC"
        ).fetchall()
    ]

    measurements = []
    for r in cur.execute(
        "SELECT * FROM measurements WHERE superseded_by IS NULL ORDER BY id DESC"
    ).fetchall():
        validity, why = measurement_validity(r["measured_sha"], r["scope_paths"])
        measurements.append({
            "kind": "measurement", "id": r["id"], "metric": r["metric"],
            "value": r["value"], "command": r["command"],
            "measured_ts": r["measured_ts"], "measured_sha": (r["measured_sha"] or "")[:12],
            "scope_paths": [p for p in (r["scope_paths"] or "").split("\n") if p],
            "validity": validity, "validity_reason": why,
        })

    obligations = [
        {"kind": "obligation", "id": r["id"], "statement": r["statement"],
         "status": r["status"], "blocker": r["blocker"], "opened_ts": r["opened_ts"]}
        for r in cur.execute(
            "SELECT * FROM obligations WHERE status != 'done' ORDER BY id DESC"
        ).fetchall()
    ]

    return {
        "recovered_at": now_iso(),
        "head_sha": (head or "")[:12],
        "last_session": dict(sess) if sess else None,
        "facts": facts,
        "measurements": measurements,
        "obligations": obligations,
        "counts": {
            "facts": len(facts),
            "measurements_fresh": sum(1 for m in measurements if m["validity"] == "fresh"),
            "measurements_stale": sum(1 for m in measurements if m["validity"] == "stale"),
            "measurements_unknown": sum(1 for m in measurements if m["validity"] == "unknown"),
            "obligations_open": sum(1 for o in obligations if o["status"] == "open"),
            "obligations_blocked": sum(1 for o in obligations if o["status"] == "blocked"),
        },
    }


def build_freshness(conn, stale_only=False):
    """Return the live measurement set with validity and re-run metadata."""
    measurements = []
    rows = conn.execute(
        "SELECT * FROM measurements WHERE superseded_by IS NULL ORDER BY id DESC"
    ).fetchall()
    for row in rows:
        validity, why = measurement_validity(
            row["measured_sha"], row["scope_paths"]
        )
        if stale_only and validity == "fresh":
            continue
        measurements.append({
            "id": row["id"],
            "metric": row["metric"],
            "value": row["value"],
            "verdict": "STALE" if validity == "stale" else validity,
            "reason": why,
            "command": row["command"] or "(no command recorded)",
            "scope": ",".join(
                path for path in (row["scope_paths"] or "").split("\n") if path
            ),
            "sha": row["measured_sha"] or "",
            "timestamp": row["measured_ts"],
        })
    return measurements


def render_freshness(measurements, output_format="text"):
    """Render a human-readable or pipeable measurement freshness report."""
    columns = (
        "id", "metric", "value", "verdict", "reason", "command", "scope",
        "sha", "timestamp",
    )
    if output_format == "tsv":
        lines = ["\t".join(columns)]
        lines.extend(
            "\t".join(str(measurement[column]) for column in columns)
            for measurement in measurements
        )
        return "\n".join(lines)

    return "\n".join(
        f"[{measurement['id']}] {measurement['metric']} = {measurement['value']}  "
        f"verdict={measurement['verdict']}  reason={measurement['reason']}  "
        f"command={measurement['command']}  scope={measurement['scope']}  "
        f"sha={measurement['sha']}  timestamp={measurement['timestamp']}"
        for measurement in measurements
    )


def render(rec):
    L = []
    A = L.append
    A(f"FOREMAN RECOVERY  head={rec['head_sha']}  at={rec['recovered_at']}")
    ls = rec["last_session"]
    if ls:
        A(f"last session: {ls['session_id']}  started={ls['started_ts']}"
          f"  start_sha={(ls['start_sha'] or '')[:12]}"
          f"  {'ENDED ' + ls['ended_ts'] if ls['ended_ts'] else 'NOT ENDED'}")
        if ls["note"]:
            A(f"  note: {ls['note']}")
    else:
        A("last session: (none — this is the first)")
    c = rec["counts"]
    A("")
    A(f"FACTS ({c['facts']}) — durable, true by construction")
    for f in rec["facts"][:20]:
        A(f"  [{f['id']}] {f['statement']}")
        if f["evidence"]:
            A(f"       evidence: {f['evidence']}")
    A("")
    A(f"MEASUREMENTS — fresh={c['measurements_fresh']} "
      f"STALE={c['measurements_stale']} unknown={c['measurements_unknown']}")
    for m in rec["measurements"][:20]:
        mark = {"fresh": "OK   ", "stale": "STALE", "unknown": "?    "}[m["validity"]]
        A(f"  {mark} [{m['id']}] {m['metric']} = {m['value']}")
        A(f"       {m['validity_reason']}  (measured {m['measured_ts']} @ {m['measured_sha']})")
        if m["validity"] != "fresh" and m["command"]:
            A(f"       re-run: {m['command']}")
    A("")
    A(f"OBLIGATIONS — open={c['obligations_open']} blocked={c['obligations_blocked']}")
    for o in rec["obligations"][:20]:
        A(f"  [{o['id']}] ({o['status']}) {o['statement']}")
        if o["blocker"]:
            A(f"       blocked by: {o['blocker']}")
    A("")
    stale = c["measurements_stale"] + c["measurements_unknown"]
    live = len(rec["measurements"])
    if stale:
        A(f"LAUNCH POINT: {stale} measurement(s) are not fresh — re-run them before "
          f"quoting any of their numbers. Then work the open obligations above.")
    elif live == 0:
        # "every measurement is fresh" over zero rows is a true sentence that
        # reads as an all-clear. An empty live set is not evidence of health.
        A("LAUNCH POINT: no measurement is recorded, so nothing here is measured. "
          "Measure before you quote a number. Then work the open obligations above.")
    else:
        A("LAUNCH POINT: every measurement is fresh. Work the open obligations above.")
    return "\n".join(L)


def project(conn):
    """Emit TerminusDB documents for the ontology, as NDJSON.

    One direction only: SQLite is the write path, the ontology is the
    read-optimised projection. Nothing here reads the graph, so a projection
    failure costs nothing -- the record already survives in SQLite.

    Joins, per docs/design/session-store-ontology-links.md:
      measured_sha -> Measurement.subject (a Commit; the same git SHA is the
                      key on both sides, so this join is free)
      scope_paths  -> Measurement.about (Set<Entity>). The ontology's
                      Measurement has NO scope field and therefore cannot
                      compute staleness at all; this is the one thing only the
                      session store can supply.
      superseded_* -> Supersession (reified, carrying at + reason)
      obligations  -> Finding
    """
    cur = conn.cursor()
    docs, skipped = [], []

    for r in cur.execute("SELECT * FROM facts").fetchall():
        # ClaimStatus is live|superseded|retracted. "Asserted"/"Superseded"
        # were outside the enum entirely and would be rejected on write.
        docs.append({
            "@type": "Claim",
            "claim_key": f"fm-fact-{r['id']}",
            "text": r["statement"],
            "status": "superseded" if r["superseded_by"] else "live",
            # Provenance declares extractor_agent, extractor_is_human,
            # extracted_at, confidence, source_artifact, source_locator. The
            # previous {source, at} pair matched NONE of them. source_artifact
            # is genuinely unavailable here -- the session store records
            # evidence as free text, not as an Artifact node -- so it is
            # omitted rather than fabricated, and the locator carries the text.
            "provenance": {
                "@type": "Provenance",
                "extractor_is_human": False,
                "extracted_at": r["established_ts"],
                "confidence": "extracted",
                "source_locator": r["evidence"] or "unrecorded",
            },
        })
        if r["superseded_by"]:
            docs.append({
                "@type": "Supersession",
                "old": f"Claim/fm-fact-{r['id']}",
                "new": f"Claim/fm-fact-{r['superseded_by']}",
                "at": r["superseded_at"] or r["established_ts"],
                "reason": r["supersede_reason"] or "unrecorded (pre-v2 row)",
            })

    for r in cur.execute("SELECT * FROM measurements").fetchall():
        if r["superseded_by"]:
            # The live set is what `recover` shows, and it excludes retired
            # rows. A projector that exported them made two consumers of one
            # store disagree about the same number. The retirement is still
            # emitted, so the projection is lossless rather than merely
            # filtered -- exactly what the facts loop above does.
            docs.append({
                "@type": "Supersession",
                "old": f"Measurement/fm-measurement-{r['id']}",
                "new": f"Measurement/fm-measurement-{r['superseded_by']}",
                "at": r["superseded_at"] or r["measured_ts"],
                "reason": r["supersede_reason"] or "unrecorded (pre-v3 row)",
            })
            continue
        if r["value_num"] is None:
            # Reported, never coerced: Measurement.value is xsd:decimal and a
            # non-scalar cannot be projected without inventing a number.
            skipped.append({"id": r["id"], "metric": r["metric"],
                            "value": r["value"], "why": "no projectable scalar"})
            continue
        docs.append({
            "@type": "Measurement",
            "measurement_key": f"fm-measurement-{r['id']}",
            "metric": r["metric"],
            "subject": f"Commit/{r['measured_sha']}" if r["measured_sha"] else None,
            "value": r["value_num"],
            "at": r["measured_ts"],
            "about": [f"Entity/{p}" for p in (r["scope_paths"] or "").split(chr(10))
                      if p.strip()],
        })

    for r in cur.execute("SELECT * FROM obligations WHERE status != 'done'").fetchall():
        # FindingSeverity is info|minor|major|critical. "Open"/"Blocked" were
        # a STATUS, not a severity, and are outside the enum. A blocked
        # obligation is major; an open one is minor. `blocker` is not a
        # declared Finding field, so its content folds into the text rather
        # than riding along as an undeclared key.
        text = r["statement"]
        if r["blocker"]:
            text = f"{text} [blocked by: {r['blocker']}]"
        docs.append({
            "@type": "Finding",
            "text": text,
            "severity": "major" if r["status"] == "blocked" else "minor",
            "at": r["opened_ts"],
        })

    return docs, skipped


def quote_identifier(name):
    """Quote an identifier discovered from SQLite's own schema."""
    return '"' + name.replace('"', '""') + '"'


def store_schema(conn):
    """Return every application table, column, and primary key from SQLite."""
    tables = [
        row["name"]
        for row in conn.execute(
            "SELECT name FROM sqlite_schema "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
    ]
    schema = {}
    for table in tables:
        info = conn.execute(
            f"PRAGMA table_info({quote_identifier(table)})"
        ).fetchall()
        columns = [row["name"] for row in info]
        primary_key = [
            row["name"]
            for row in sorted(info, key=lambda row: row["pk"])
            if row["pk"]
        ]
        if not primary_key:
            raise ValueError(
                f"cannot serialize table {table}: table has no primary key"
            )
        schema[table] = {"columns": columns, "primary_key": primary_key}
    return schema


def sidecar_ndjson(conn):
    """Return a canonical, faithful NDJSON dump of the session store."""
    owns_transaction = not conn.in_transaction
    if owns_transaction:
        conn.execute("BEGIN")
    try:
        documents = [{
            "format": SIDECAR_FORMAT,
            "format_version": SIDECAR_FORMAT_VERSION,
        }]
        row_count = 0
        for table, table_schema in store_schema(conn).items():
            columns = table_schema["columns"]
            selected = ", ".join(quote_identifier(column) for column in columns)
            ordering = ", ".join(
                quote_identifier(column) for column in table_schema["primary_key"]
            )
            query = (
                f"SELECT {selected} FROM {quote_identifier(table)} "
                f"ORDER BY {ordering}"
            )
            for record in conn.execute(query).fetchall():
                row = {column: record[column] for column in columns}
                documents.append({"table": table, "row": row})
                row_count += 1
        lines = "\n".join(
            json.dumps(document, sort_keys=True) for document in documents
        )
        if owns_transaction:
            conn.commit()
        return lines + "\n", row_count
    except Exception:
        if owns_transaction:
            conn.rollback()
        raise


def paths_alias(left, right):
    left, right = Path(left), Path(right)
    try:
        if left.resolve() == right.resolve():
            return True
    except OSError:
        pass
    try:
        return os.path.samefile(left, right)
    except OSError:
        return False


def write_atomic(path, text):
    """Publish text without exposing a partial or truncated sidecar."""
    path = Path(path)
    fd, temporary = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        if hasattr(os, "O_DIRECTORY"):
            directory_fd = os.open(path.parent, os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
    finally:
        try:
            Path(temporary).unlink()
        except FileNotFoundError:
            pass


def read_sidecar(path):
    documents = []
    with Path(path).open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                doc = json.loads(line)
            except json.JSONDecodeError as e:
                raise ValueError(f"invalid NDJSON at line {line_number}: {e.msg}") from e
            if not isinstance(doc, dict):
                raise ValueError(f"invalid NDJSON at line {line_number}: expected object")
            documents.append(doc)
    return documents


def describe_row(row):
    """Render a stable row description for refusal messages."""
    return json.dumps(row, sort_keys=True)


def validate_sidecar(conn, path):
    """Validate the format envelope and every row against the target schema."""
    documents = read_sidecar(path)
    if not documents:
        raise ValueError("missing sidecar format record")

    header = documents[0]
    if header.get("format") != SIDECAR_FORMAT:
        raise ValueError(f"unsupported sidecar format: {header.get('format')!r}")
    version = header.get("format_version")
    if version != SIDECAR_FORMAT_VERSION:
        raise ValueError(f"unsupported sidecar format version: {version!r}")
    if set(header) != {"format", "format_version"}:
        raise ValueError("invalid sidecar format record")

    schema = store_schema(conn)
    rows = []
    for document in documents[1:]:
        if "format" in document or "format_version" in document:
            raise ValueError("sidecar must contain exactly one format record")
        table = document.get("table")
        row = document.get("row")
        if not isinstance(table, str) or not isinstance(row, dict):
            raise ValueError(f"invalid sidecar row record: {document!r}")
        if set(document) != {"table", "row"}:
            raise ValueError(
                f"cannot restore table {table}, row {describe_row(row)}: "
                "record must contain only table and row"
            )
        if table not in schema:
            raise ValueError(
                f"cannot restore table {table}, row {describe_row(row)}: "
                "table is not present in the target schema"
            )
        expected = set(schema[table]["columns"])
        actual = set(row)
        if actual != expected:
            missing = sorted(expected - actual)
            extra = sorted(actual - expected)
            raise ValueError(
                f"cannot restore table {table}, row {describe_row(row)}: "
                f"columns differ (missing={missing}, extra={extra})"
            )
        rows.append((table, row))
    return schema, rows


def import_sidecar(conn, path, force=False):
    """Restore a faithful sidecar without deriving or synthesising any row."""
    schema, rows = validate_sidecar(conn, path)
    data_tables = [table for table in schema if table != "schema_meta"]
    conn.execute("BEGIN IMMEDIATE")
    try:
        if any(conn.execute(
            f"SELECT 1 FROM {quote_identifier(table)} LIMIT 1"
        ).fetchone()
               for table in data_tables) and not force:
            raise ValueError("target store already has rows; use --force to replace it")

        for table in reversed(schema):
            conn.execute(f"DELETE FROM {quote_identifier(table)}")
        if conn.execute(
            "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sqlite_sequence'"
        ).fetchone():
            conn.execute(
                "DELETE FROM sqlite_sequence WHERE name IN ({})".format(
                    ",".join("?" for _ in schema)
                ),
                tuple(schema),
            )
        for table, row in rows:
            columns = schema[table]["columns"]
            names = ", ".join(quote_identifier(column) for column in columns)
            placeholders = ", ".join("?" for _ in columns)
            try:
                conn.execute(
                    f"INSERT INTO {quote_identifier(table)} ({names}) "
                    f"VALUES ({placeholders})",
                    tuple(row[column] for column in columns),
                )
            except sqlite3.Error as e:
                raise ValueError(
                    f"cannot restore table {table}, row {describe_row(row)}: {e}"
                ) from e
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return len(rows)


def main():
    ap = argparse.ArgumentParser(prog="fm-session.py")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("begin"); p.add_argument("--note", default=None)
    p = sub.add_parser("recover"); p.add_argument("--json", action="store_true")
    p = sub.add_parser("freshness")
    p.add_argument("--stale-only", action="store_true")
    p.add_argument("--format", choices=["text", "tsv"], default="text")
    p = sub.add_parser("end"); p.add_argument("session_id", nargs="?")
    p = sub.add_parser("fact"); p.add_argument("statement"); p.add_argument("--evidence")
    p = sub.add_parser("measure")
    p.add_argument("metric"); p.add_argument("value")
    p.add_argument("--command", required=True)
    p.add_argument("--scope", action="append", default=[])
    p.add_argument("--num", type=float, default=None,
                   help="projectable scalar; auto-extracted from VALUE when omitted")
    p = sub.add_parser("obligation"); p.add_argument("statement"); p.add_argument("--blocker")
    p = sub.add_parser("close")
    p.add_argument("obligation_id", type=int)
    p.add_argument("--status", default="done", choices=["done", "blocked", "open"])
    p.add_argument("--blocker")
    p = sub.add_parser("project")
    p.add_argument("--out", default=None, help="NDJSON path (default stdout)")
    p = sub.add_parser("sidecar")
    p.add_argument("--out", default=None,
                   help="NDJSON path (default beside the session store)")
    p = sub.add_parser("import-sidecar")
    p.add_argument("path")
    p.add_argument("--into", default=None, help="target session database")
    p.add_argument("--force", action="store_true")
    p = sub.add_parser("supersede")
    p.add_argument("fact_id", type=int); p.add_argument("statement")
    p.add_argument("--evidence")
    p.add_argument("--reason", required=True,
                   help="why the old fact stopped being true; required -- an "
                        "unexplained supersession is unauditable")
    p = sub.add_parser("retire")
    p.add_argument("measurement_id", type=int)
    p.add_argument("--by", type=int, required=True,
                   help="id of the measurement that supersedes this one")
    p.add_argument("--reason", required=True,
                   help="why the old measurement stopped being true; required -- "
                        "an unexplained retirement is unauditable")

    a = ap.parse_args()
    # Commands that only read. Opening these read-only is what makes their
    # documented "no side effects" true; see connect_readonly. `sidecar` writes
    # a file but never the store, so it belongs here too.
    if a.cmd == "import-sidecar":
        try:
            conn = connect(a.into)
        except sqlite3.Error as e:
            print(f"refusing: cannot open target store: {e}", file=sys.stderr)
            return 2
    elif a.cmd in READ_ONLY_CMDS:
        conn = connect_readonly()
    else:
        conn = connect()
    cur = conn.cursor()

    def current_session():
        r = cur.execute(
            "SELECT session_id FROM sessions WHERE ended_ts IS NULL "
            "ORDER BY session_id DESC LIMIT 1").fetchone()
        return r["session_id"] if r else None

    if a.cmd == "begin":
        rec = build_recovery(conn)          # recover BEFORE minting, so the
        sid = mint_session_id()             # launch point reflects prior state
        cur.execute(
            "INSERT INTO sessions(session_id,started_ts,start_sha,note) VALUES(?,?,?,?)",
            (sid, now_iso(), git_sha(), a.note))
        conn.commit()
        print(render(rec))
        print("")
        print(f"SESSION BEGUN: {sid}")
        return 0

    if a.cmd == "recover":
        rec = build_recovery(conn)
        print(json.dumps(rec, indent=2) if a.json else render(rec))
        return 0

    if a.cmd == "freshness":
        measurements = build_freshness(conn, stale_only=a.stale_only)
        print(render_freshness(measurements, output_format=a.format))
        return 0

    if a.cmd == "end":
        sid = a.session_id or current_session()
        if not sid:
            print("no open session", file=sys.stderr); return 2
        cur.execute("UPDATE sessions SET ended_ts=? WHERE session_id=?", (now_iso(), sid))
        conn.commit(); print(f"session ended: {sid}"); return 0

    if a.cmd == "fact":
        cur.execute(
            "INSERT INTO facts(statement,evidence,established_ts,session_id) VALUES(?,?,?,?)",
            (a.statement, a.evidence, now_iso(), current_session()))
        conn.commit(); print(f"fact {cur.lastrowid}"); return 0

    if a.cmd == "measure":
        if not a.scope:
            print("refusing: --scope is required. A measurement with no path scope "
                  "can never be shown stale, which is the entire point.", file=sys.stderr)
            return 2
        vnum = a.num if a.num is not None else scalar_of(a.value)
        cur.execute(
            "INSERT INTO measurements(metric,value,command,measured_ts,measured_sha,"
            "scope_paths,session_id,value_num) VALUES(?,?,?,?,?,?,?,?)",
            (a.metric, a.value, a.command, now_iso(), git_sha(),
             "\n".join(a.scope), current_session(), vnum))
        conn.commit(); print(f"measurement {cur.lastrowid}"); return 0

    if a.cmd == "obligation":
        cur.execute(
            "INSERT INTO obligations(statement,status,blocker,opened_ts,session_id) "
            "VALUES(?,?,?,?,?)",
            (a.statement, "blocked" if a.blocker else "open", a.blocker,
             now_iso(), current_session()))
        conn.commit(); print(f"obligation {cur.lastrowid}"); return 0

    if a.cmd == "close":
        cur.execute(
            "UPDATE obligations SET status=?, blocker=?, closed_ts=? WHERE id=?",
            (a.status, a.blocker, now_iso() if a.status == "done" else None,
             a.obligation_id))
        conn.commit(); print(f"obligation {a.obligation_id} -> {a.status}"); return 0

    if a.cmd == "sidecar":
        out = Path(a.out) if a.out else db_path().parent / "session.ndjson"
        store_name = conn.execute("PRAGMA database_list").fetchone()["file"]
        store = Path(store_name) if store_name else db_path()
        if paths_alias(out, store):
            print(f"refusing: sidecar output {out} aliases the session store {store}",
                  file=sys.stderr)
            return 2
        try:
            lines, row_count = sidecar_ndjson(conn)
            write_atomic(out, lines)
        except (OSError, TypeError, ValueError) as e:
            print(f"refusing: cannot write sidecar {out}: {e}", file=sys.stderr)
            return 2
        print(f"dumped {row_count} row(s) -> {out}")
        return 0

    if a.cmd == "import-sidecar":
        try:
            count = import_sidecar(conn, a.path, a.force)
        except (OSError, UnicodeError, ValueError, KeyError, sqlite3.Error) as e:
            print(f"refusing: {e}", file=sys.stderr)
            return 2
        target = Path(a.into) if a.into else db_path()
        print(f"imported {count} document(s) -> {target}")
        return 0

    if a.cmd == "project":
        docs, skipped = project(conn)
        lines = "\n".join(json.dumps(d) for d in docs)
        if a.out:
            pathlib.Path(a.out).write_text(lines + "\n", encoding="utf-8")
            print(f"projected {len(docs)} document(s) -> {a.out}")
        else:
            print(lines)
        for sk in skipped:
            print(f"SKIPPED measurement {sk['id']} ({sk['metric']}): "
                  f"{sk['why']} — value={sk['value']!r}", file=sys.stderr)
        if skipped:
            print(f"{len(skipped)} measurement(s) not projectable; "
                  f"record --num to include them", file=sys.stderr)
        return 0

    if a.cmd == "supersede":
        cur.execute(
            "INSERT INTO facts(statement,evidence,established_ts,session_id) VALUES(?,?,?,?)",
            (a.statement, a.evidence, now_iso(), current_session()))
        new_id = cur.lastrowid
        cur.execute(
            "UPDATE facts SET superseded_by=?, superseded_at=?, supersede_reason=? "
            "WHERE id=?", (new_id, now_iso(), a.reason, a.fact_id))
        conn.commit(); print(f"fact {a.fact_id} superseded by {new_id}"); return 0

    if a.cmd == "retire":
        if a.by == a.measurement_id:
            print("refusing: a measurement cannot supersede itself", file=sys.stderr)
            return 2
        target = cur.execute(
            "SELECT id FROM measurements WHERE id=?",
            (a.measurement_id,)).fetchone()
        if target is None:
            # The target was never checked. A typo in the id updated zero rows
            # and still printed a success line.
            print(f"refusing: no measurement {a.measurement_id} to retire",
                  file=sys.stderr)
            return 2
        row = cur.execute(
            "SELECT id, superseded_by FROM measurements WHERE id=?",
            (a.by,)).fetchone()
        if row is None:
            print(f"refusing: no measurement {a.by} to supersede it", file=sys.stderr)
            return 2
        if row["superseded_by"] is not None:
            # A retired row must not supersede anything. Two rows could point
            # at each other, and then the live set was empty while the launch
            # point still reported every measurement fresh.
            print(f"refusing: measurement {a.by} is itself superseded by "
                  f"{row['superseded_by']}. A retired measurement cannot "
                  f"supersede another one.", file=sys.stderr)
            return 2
        cur.execute(
            "UPDATE measurements SET superseded_by=?, superseded_at=?, "
            "supersede_reason=? WHERE id=?",
            (a.by, now_iso(), a.reason, a.measurement_id))
        if cur.rowcount != 1:  # pragma: no cover - the checks above cover it
            conn.rollback()
            print(f"refusing: retire changed {cur.rowcount} row(s), expected 1",
                  file=sys.stderr)
            return 2
        conn.commit()
        print(f"measurement {a.measurement_id} retired, superseded by {a.by}")
        return 0

    return 2


def main_with_sidecar():
    """Run the command, then keep the tracked sidecar in step with the store.

    The .db is a derived cache and .ndjson is what git tracks, so a write that
    updated only the database would leave the tracked record behind. That is not
    hypothetical: the committed sidecar was found at 127 rows against a 408-row
    store, so the mergeable mirror had silently stopped tracking the thing it
    mirrors for weeks.

    Refresh failures are reported and do not change the exit code -- the write
    already succeeded and claiming otherwise would be a lie in the other
    direction -- but they are never silent.
    """
    rc = main()
    if rc != 0 or len(sys.argv) < 2 or sys.argv[1] in READ_ONLY_CMDS:
        return rc
    try:
        store = db_path()
        out = store.parent / "session.ndjson"
        # The store itself can BE session.ndjson when FOREMAN_SESSION_DB points
        # there. Refreshing then overwrites the store with its own dump and
        # destroys it. The sidecar command already refuses this; the automatic
        # refresh must refuse it too, or it is a data-loss path that only fires
        # when nobody asked for it.
        if paths_alias(out, store):
            return rc
        conn = connect_readonly()
        lines, row_count = sidecar_ndjson(conn)
        write_atomic(out, lines)
        conn.close()
        print(f"sidecar refreshed: {row_count} row(s) -> {out}", file=sys.stderr)
    except Exception as e:
        print(f"WARNING: the store was written but its sidecar could not be "
              f"refreshed ({e}). The tracked record is now BEHIND the database; "
              f"run `fm-session.py sidecar` before committing.", file=sys.stderr)
    return rc


if __name__ == "__main__":
    sys.exit(main_with_sidecar())
