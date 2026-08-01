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
    return conn


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

    for r in cur.execute("SELECT * FROM facts ORDER BY id").fetchall():
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

    for r in cur.execute("SELECT * FROM measurements ORDER BY id").fetchall():
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

    for r in cur.execute(
        "SELECT * FROM obligations WHERE status != 'done' ORDER BY id"
    ).fetchall():
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


def projection_ndjson(conn):
    """Return the existing ontology projection encoded as NDJSON."""
    docs, skipped = project(conn)
    lines = "\n".join(json.dumps(d) for d in docs)
    return lines + "\n", docs, skipped


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


def sidecar_id(value, prefix):
    if not isinstance(value, str) or not value.startswith(prefix):
        raise ValueError(f"expected {prefix}<id>, got {value!r}")
    raw = value[len(prefix):]
    if not raw.isdigit() or int(raw) < 1:
        raise ValueError(f"expected {prefix}<id>, got {value!r}")
    return int(raw)


def read_sidecar(path):
    docs = []
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
            docs.append(doc)
    return docs


def import_sidecar(conn, path, force=False):
    """Rebuild projection-equivalent SQLite rows from ontology NDJSON."""
    docs = read_sidecar(path)
    tables = ("sessions", "facts", "measurements", "obligations")

    claims = [d for d in docs if d.get("@type") == "Claim"]
    measurements = [d for d in docs if d.get("@type") == "Measurement"]
    findings = [d for d in docs if d.get("@type") == "Finding"]
    supersessions = [d for d in docs if d.get("@type") == "Supersession"]
    supported = {"Claim", "Measurement", "Finding", "Supersession"}
    unknown = [d.get("@type") for d in docs if d.get("@type") not in supported]
    if unknown:
        raise ValueError(f"unsupported sidecar document type: {unknown[0]!r}")

    fact_ids = {
        sidecar_id(d.get("claim_key"), "fm-fact-") for d in claims
    }
    measurement_ids = {
        sidecar_id(d.get("measurement_key"), "fm-measurement-")
        for d in measurements
    }
    measurement_old_ids = set()
    parsed_supersessions = []
    superseded_records = set()
    for d in supersessions:
        old, new = d.get("old"), d.get("new")
        if isinstance(old, str) and old.startswith("Claim/"):
            old_id = sidecar_id(old, "Claim/fm-fact-")
            new_id = sidecar_id(new, "Claim/fm-fact-")
            if old_id not in fact_ids or new_id not in fact_ids:
                raise ValueError("fact supersession refers to a missing Claim")
            kind = "fact"
        elif isinstance(old, str) and old.startswith("Measurement/"):
            old_id = sidecar_id(old, "Measurement/fm-measurement-")
            new_id = sidecar_id(new, "Measurement/fm-measurement-")
            measurement_old_ids.add(old_id)
            kind = "measurement"
        else:
            raise ValueError(f"unsupported supersession reference: {old!r}")
        record = (kind, old_id)
        if record in superseded_records:
            raise ValueError(f"duplicate supersession for {old!r}")
        superseded_records.add(record)
        parsed_supersessions.append((kind, old_id, new_id, d))

    for kind in ("fact", "measurement"):
        next_by_id = {
            old_id: new_id
            for edge_kind, old_id, new_id, _ in parsed_supersessions
            if edge_kind == kind
        }
        for start in next_by_id:
            seen = set()
            current = start
            while current in next_by_id:
                if current in seen:
                    raise ValueError(f"{kind} supersession cycle")
                seen.add(current)
                current = next_by_id[current]

    measurement_universe = measurement_ids | measurement_old_ids
    if any(kind == "measurement" and new_id not in measurement_universe
           for kind, _, new_id, _ in parsed_supersessions):
        raise ValueError("measurement supersession refers to a missing Measurement")

    conn.execute("BEGIN IMMEDIATE")
    with conn:
        if any(conn.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone()
               for table in tables) and not force:
            raise ValueError("target store already has rows; use --force to replace it")
        if force:
            for table in tables:
                conn.execute(f"DELETE FROM {table}")
            conn.execute(
                "DELETE FROM sqlite_sequence WHERE name IN "
                "('facts','measurements','obligations')"
            )

        for d in claims:
            fact_id = sidecar_id(d.get("claim_key"), "fm-fact-")
            provenance = d.get("provenance") or {}
            evidence = provenance.get("source_locator")
            if evidence == "unrecorded":
                evidence = None
            conn.execute(
                "INSERT INTO facts(id,statement,evidence,established_ts,session_id) "
                "VALUES(?,?,?,?,NULL)",
                (fact_id, d["text"], evidence, provenance["extracted_at"]),
            )

        for d in measurements:
            measurement_id = sidecar_id(
                d.get("measurement_key"), "fm-measurement-"
            )
            value = d["value"]
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError("Measurement.value must be numeric")
            subject = d.get("subject")
            if subject is None:
                measured_sha = None
            elif isinstance(subject, str) and subject.startswith("Commit/"):
                measured_sha = subject[len("Commit/"):]
            else:
                raise ValueError(f"unsupported Measurement.subject: {subject!r}")
            about = d.get("about") or []
            if not isinstance(about, list) or any(
                not isinstance(item, str) or not item.startswith("Entity/")
                for item in about
            ):
                raise ValueError("Measurement.about must contain Entity references")
            scope_paths = "\n".join(item[len("Entity/"):] for item in about)
            conn.execute(
                "INSERT INTO measurements(id,metric,value,command,measured_ts,"
                "measured_sha,scope_paths,session_id,value_num) "
                "VALUES(?,?,?,NULL,?,?,?,NULL,?)",
                (measurement_id, d["metric"], str(value), d["at"],
                 measured_sha, scope_paths, float(value)),
            )

        supersession_at = {
            old_id: d["at"] for kind, old_id, _, d in parsed_supersessions
            if kind == "measurement"
        }
        for measurement_id in sorted(measurement_old_ids - measurement_ids):
            conn.execute(
                "INSERT INTO measurements(id,metric,value,command,measured_ts,"
                "measured_sha,scope_paths,session_id,value_num) "
                "VALUES(?,?,'0',NULL,?,NULL,NULL,NULL,0)",
                (measurement_id, "recovered superseded measurement",
                 supersession_at[measurement_id]),
            )

        for d in findings:
            severity = d.get("severity")
            if severity not in ("minor", "major"):
                raise ValueError(f"unsupported Finding.severity: {severity!r}")
            conn.execute(
                "INSERT INTO obligations(statement,status,blocker,opened_ts,"
                "closed_ts,session_id) VALUES(?,?,NULL,?,NULL,NULL)",
                (d["text"], "blocked" if severity == "major" else "open", d["at"]),
            )

        for kind, old_id, new_id, d in parsed_supersessions:
            table = "facts" if kind == "fact" else "measurements"
            conn.execute(
                f"UPDATE {table} SET superseded_by=?, superseded_at=?, "
                "supersede_reason=? WHERE id=?",
                (new_id, d["at"], d["reason"], old_id),
            )

    return len(docs)


def main():
    ap = argparse.ArgumentParser(prog="fm-session.py")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("begin"); p.add_argument("--note", default=None)
    p = sub.add_parser("recover"); p.add_argument("--json", action="store_true")
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
    try:
        conn = connect(a.into if a.cmd == "import-sidecar" else None)
    except sqlite3.Error as e:
        print(f"refusing: cannot open target store: {e}", file=sys.stderr)
        return 2
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
        lines, docs, skipped = projection_ndjson(conn)
        out = Path(a.out) if a.out else db_path().parent / "session.ndjson"
        store_name = conn.execute("PRAGMA database_list").fetchone()["file"]
        store = Path(store_name) if store_name else db_path()
        if paths_alias(out, store):
            print(f"refusing: sidecar output {out} aliases the session store {store}",
                  file=sys.stderr)
            return 2
        try:
            write_atomic(out, lines)
        except OSError as e:
            print(f"refusing: cannot write sidecar {out}: {e}", file=sys.stderr)
            return 2
        print(f"projected {len(docs)} document(s) -> {out}")
        for sk in skipped:
            print(f"SKIPPED measurement {sk['id']} ({sk['metric']}): "
                  f"{sk['why']} — value={sk['value']!r}", file=sys.stderr)
        if skipped:
            print(f"{len(skipped)} measurement(s) not projectable; "
                  f"record --num to include them", file=sys.stderr)
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
        lines, docs, skipped = projection_ndjson(conn)
        if a.out:
            pathlib.Path(a.out).write_text(lines, encoding="utf-8")
            print(f"projected {len(docs)} document(s) -> {a.out}")
        else:
            print(lines, end="")
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


if __name__ == "__main__":
    sys.exit(main())
