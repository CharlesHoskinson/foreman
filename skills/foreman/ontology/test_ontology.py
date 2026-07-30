#!/usr/bin/env python3
"""Discrimination test for the ontology schema. Every constraint must be shown
to REJECT a known-bad write, not merely to accept a good one."""
import sqlite3, os, sys

DB = "/tmp/ont_test.db"
if os.path.exists(DB):
    os.remove(DB)
c = sqlite3.connect(DB)
c.executescript(open("/root/fm-wt/integrate/skills/foreman/ontology/schema.sql").read())
c.execute("PRAGMA foreign_keys = ON")

TS = "2026-07-30T12:00:00Z"
ok, bad = [], []

def rejects(label, sql, params=()):
    try:
        c.execute(sql, params); c.commit(); bad.append("NOT REJECTED: " + label)
    except sqlite3.Error:
        ok.append(("rejected", label))

def accepts(label, sql, params=()):
    try:
        c.execute(sql, params); c.commit(); ok.append(("accepted", label))
    except sqlite3.Error as e:
        bad.append(f"rejected a GOOD write: {label} ({e})")

def seed(sql):
    c.executescript(sql); c.commit()

# positive control
accepts("Claim node", "INSERT INTO node(id,kind,plane,created_at) VALUES(1,'Claim','knowledge',?)", (TS,))
accepts("provenance", "INSERT INTO provenance(id,extractor_is_human,extracted_at,confidence,source_locator) VALUES(1,0,?,'extracted','commit abc')", (TS,))
accepts("claim", "INSERT INTO claim(node_id,claim_key,text,status,provenance_id) VALUES(1,'c1','first','live',1)")

# rejections
rejects("disjointness: Entity on the work plane",
        "INSERT INTO node(id,kind,plane,created_at) VALUES(90,'Entity','work',?)", (TS,))
rejects("timestamp shape: 'yesterday'",
        "INSERT INTO node(id,kind,plane,created_at) VALUES(91,'Claim','knowledge','yesterday')")

seed(f"INSERT INTO node(id,kind,plane,created_at) VALUES(2,'Claim','knowledge','{TS}');")
rejects("ClaimStatus 'Asserted' (what the projector emitted before today)",
        "INSERT INTO claim(node_id,claim_key,text,status,provenance_id) VALUES(2,'c2','x','Asserted',1)")

seed(f"INSERT INTO node(id,kind,plane,created_at) VALUES(3,'Finding','work','{TS}');")
rejects("FindingSeverity 'Open' (what the projector emitted before today)",
        "INSERT INTO finding(node_id,severity,text,at) VALUES(3,'Open','x',?)", (TS,))

seed(f"INSERT INTO node(id,kind,plane,created_at) VALUES(92,'Commit','artifact','{TS}');")
rejects("claim row attached to a Commit node (composite FK)",
        "INSERT INTO claim(node_id,claim_key,text,status,provenance_id) VALUES(92,'c92','x','live',1)")

seed(f"""
INSERT INTO node(id,kind,plane,created_at) VALUES(10,'Claim','knowledge','{TS}');
INSERT INTO claim(node_id,claim_key,text,status,provenance_id) VALUES(10,'c10','ten','live',1);
INSERT INTO node(id,kind,plane,created_at) VALUES(20,'Supersession','lineage','{TS}');
INSERT INTO node(id,kind,plane,created_at) VALUES(21,'Supersession','lineage','{TS}');
""")
accepts("supersession carrying at + reason",
        "INSERT INTO supersession(node_id,old_id,new_id,at,reason) VALUES(20,1,10,?,'measured again')", (TS,))
rejects("supersession with a blank reason",
        "INSERT INTO supersession(node_id,old_id,new_id,at,reason) VALUES(21,10,1,?,'   ')", (TS,))
rejects("a second successor for the same node (head would be ill-defined)",
        "INSERT INTO supersession(node_id,old_id,new_id,at,reason) VALUES(21,1,10,?,'fork')", (TS,))

seed(f"""
INSERT INTO node(id,kind,plane,created_at) VALUES(30,'Metric','work','{TS}');
INSERT INTO metric(node_id,name) VALUES(30,'suite pass count');
INSERT INTO node(id,kind,plane,created_at) VALUES(31,'Commit','artifact','{TS}');
INSERT INTO commit_node(node_id,sha) VALUES(31,'d44461e');
INSERT INTO node(id,kind,plane,created_at) VALUES(32,'Measurement','work','{TS}');
""")
rejects("Measurement.value '447 pass / 0 fail' (not a scalar)",
        "INSERT INTO measurement(node_id,metric_id,subject_id,value,value_text,at) VALUES(32,30,31,'447 pass / 0 fail','447',?)", (TS,))
accepts("Measurement with a scalar value",
        "INSERT INTO measurement(node_id,metric_id,subject_id,value,value_text,at) VALUES(32,30,31,447,'447',?)", (TS,))

# cycle guards must terminate
seed(f"""
INSERT INTO node(id,kind,plane,created_at) VALUES(40,'Claim','knowledge','{TS}');
INSERT INTO claim(node_id,claim_key,text,status,provenance_id) VALUES(40,'x1','a','live',1);
INSERT INTO node(id,kind,plane,created_at) VALUES(41,'Claim','knowledge','{TS}');
INSERT INTO claim(node_id,claim_key,text,status,provenance_id) VALUES(41,'x2','b','live',1);
INSERT INTO claim_contradicts(claim_id,contradicts_id) VALUES(40,41);
INSERT INTO claim_contradicts(claim_id,contradicts_id) VALUES(41,40);
""")
n = len(c.execute("SELECT * FROM claim_contradiction_reach").fetchall())
ok.append(("terminated", f"contradiction view on a 2-cycle ({n} rows)"))
n = len(c.execute("SELECT * FROM claim_head").fetchall())
ok.append(("terminated", f"claim_head view ({n} rows)"))
for v in ("lint_plane_violation", "lint_knowledge_in_work", "lint_supersession_cycle"):
    n = len(c.execute(f"SELECT * FROM {v}").fetchall())
    if n:
        bad.append(f"{v} returned {n} rows on a clean graph")
    else:
        ok.append(("clean", v))

print(f"PASSED {len(ok)}")
for k, l in ok:
    print(f"  {k:10} {l}")
if bad:
    print(f"\nFAILED {len(bad)}")
    for b in bad:
        print("  " + b)
    sys.exit(1)
print("\nevery constraint discriminates")
