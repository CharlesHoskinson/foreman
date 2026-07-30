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
#
# Env:
#   FOREMAN_SESSION_DB   override db path (default <repo>/.foreman/session.db)
#
# @exitcode 0 ok; 2 usage error
import argparse
import json
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1

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
  superseded_by  INTEGER REFERENCES facts(id)
);

CREATE TABLE IF NOT EXISTS measurements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  metric       TEXT NOT NULL,
  value        TEXT NOT NULL,
  command      TEXT,
  measured_ts  TEXT NOT NULL,
  measured_sha TEXT,
  scope_paths  TEXT,
  session_id   TEXT
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
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return Path(out)
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


def db_path():
    env = os.environ.get("FOREMAN_SESSION_DB")
    if env:
        return Path(env)
    d = repo_root() / ".foreman"
    d.mkdir(parents=True, exist_ok=True)
    return d / "session.db"


def connect():
    p = db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(p))
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.execute(
        "INSERT OR IGNORE INTO schema_meta(key,value) VALUES('version',?)",
        (str(SCHEMA_VERSION),),
    )
    conn.commit()
    return conn


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
        "SELECT * FROM measurements ORDER BY id DESC"
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
    if stale:
        A(f"LAUNCH POINT: {stale} measurement(s) are not fresh — re-run them before "
          f"quoting any of their numbers. Then work the open obligations above.")
    else:
        A("LAUNCH POINT: every measurement is fresh. Work the open obligations above.")
    return "\n".join(L)


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
    p = sub.add_parser("obligation"); p.add_argument("statement"); p.add_argument("--blocker")
    p = sub.add_parser("close")
    p.add_argument("obligation_id", type=int)
    p.add_argument("--status", default="done", choices=["done", "blocked", "open"])
    p.add_argument("--blocker")
    p = sub.add_parser("supersede")
    p.add_argument("fact_id", type=int); p.add_argument("statement"); p.add_argument("--evidence")

    a = ap.parse_args()
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
        cur.execute(
            "INSERT INTO measurements(metric,value,command,measured_ts,measured_sha,"
            "scope_paths,session_id) VALUES(?,?,?,?,?,?,?)",
            (a.metric, a.value, a.command, now_iso(), git_sha(),
             "\n".join(a.scope), current_session()))
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

    if a.cmd == "supersede":
        cur.execute(
            "INSERT INTO facts(statement,evidence,established_ts,session_id) VALUES(?,?,?,?)",
            (a.statement, a.evidence, now_iso(), current_session()))
        new_id = cur.lastrowid
        cur.execute("UPDATE facts SET superseded_by=? WHERE id=?", (new_id, a.fact_id))
        conn.commit(); print(f"fact {a.fact_id} superseded by {new_id}"); return 0

    return 2


if __name__ == "__main__":
    sys.exit(main())
