import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALLOWED_MODE_CHANGES,
  ALLOWED_ROOT_MD,
  EXIT_CLEAN,
  EXIT_VIOLATIONS,
  evaluateRepoHygiene,
  renderRepoHygiene,
  type HygieneSnapshot,
} from "./repo-hygiene.js";

const EMPTY: HygieneSnapshot = {
  trackedMarkdownRoot: [],
  hashedPaths: [],
  base: "origin/main",
  changedPaths: [],
  baseModes: new Map(),
  headModes: new Map(),
  hasShebang: () => false,
};

function snap(over: Partial<HygieneSnapshot>): HygieneSnapshot {
  return { ...EMPTY, ...over };
}

function violations(s: HygieneSnapshot): string[] {
  return evaluateRepoHygiene(s)
    .lines.filter((l) => l.kind === "violation")
    .map((l) => l.text);
}

function infos(s: HygieneSnapshot): string[] {
  return evaluateRepoHygiene(s)
    .lines.filter((l) => l.kind === "info")
    .map((l) => l.text);
}

describe("rule 1: root markdown allowlist", () => {
  it("accepts every allowlisted root document", () => {
    const s = snap({ trackedMarkdownRoot: [...ALLOWED_ROOT_MD] });
    assert.deepEqual(violations(s), []);
    assert.equal(evaluateRepoHygiene(s).exitCode, EXIT_CLEAN);
  });

  it("refuses a root document that is not allowlisted", () => {
    const s = snap({ trackedMarkdownRoot: ["FOREMAN_REPORT.md"] });
    const v = violations(s);
    assert.equal(v.length, 1);
    assert.match(v[0]!, /^root markdown not in the allowlist: FOREMAN_REPORT\.md/);
    // The message must name where the allowlist now lives, not the old shell.
    assert.match(v[0]!, /packages\/policy\/src\/repo-hygiene\.ts/);
    assert.equal(evaluateRepoHygiene(s).exitCode, EXIT_VIOLATIONS);
  });

  it("ignores markdown below the root", () => {
    const s = snap({ trackedMarkdownRoot: [] });
    assert.deepEqual(violations(s), []);
  });
});

describe("rule 2: state-document sprawl", () => {
  it("allows exactly one RESUME.md", () => {
    assert.deepEqual(violations(snap({ trackedMarkdownRoot: ["RESUME.md"] })), []);
  });

  it("refuses a second resume, a checkpoint, and a state snapshot", () => {
    for (const f of ["RESUME-2026-08-01.md", "CHECKPOINT.md", "STATE-now.md"]) {
      const v = violations(snap({ trackedMarkdownRoot: ["RESUME.md", f] }));
      // Not allowlisted, so rule 1 fires too; rule 2 must fire as well.
      assert.ok(
        v.some((t) => t.startsWith(`state-document sprawl: ${f}`)),
        `expected sprawl violation for ${f}, got ${JSON.stringify(v)}`,
      );
    }
  });
});

describe("rule 3: duplicate content under docs/evidence", () => {
  it("refuses two evidence paths with the same object id", () => {
    const s = snap({
      hashedPaths: [
        { path: "docs/evidence/a.md", oid: "aaa" },
        { path: "docs/evidence/b.md", oid: "aaa" },
      ],
    });
    const v = violations(s);
    assert.equal(v.length, 1);
    assert.match(v[0]!, /^duplicate content under docs\/evidence: /);
    assert.match(v[0]!, /docs\/evidence\/a\.md docs\/evidence\/b\.md/);
  });

  it("reports one violation per duplicated object id, not per path", () => {
    const s = snap({
      hashedPaths: [
        { path: "docs/evidence/a.md", oid: "aaa" },
        { path: "docs/evidence/b.md", oid: "aaa" },
        { path: "docs/evidence/c.md", oid: "aaa" },
      ],
    });
    assert.equal(violations(s).length, 1);
  });

  it("does not fire when only one copy is under docs/evidence", () => {
    const s = snap({
      hashedPaths: [
        { path: "docs/evidence/a.md", oid: "aaa" },
        { path: "docs/design/a.md", oid: "aaa" },
      ],
    });
    assert.deepEqual(
      violations(s).filter((t) => t.startsWith("duplicate content")),
      [],
    );
  });
});

describe("rule 4: root file duplicates documentation", () => {
  it("refuses a root file byte-identical to one under docs/", () => {
    const s = snap({
      hashedPaths: [
        { path: "NOTES.md", oid: "bbb" },
        { path: "docs/notes.md", oid: "bbb" },
      ],
    });
    const v = violations(s);
    assert.ok(
      v.some((t) =>
        t.startsWith("root file duplicates documentation: NOTES.md is byte-identical to docs/notes.md"),
      ),
      JSON.stringify(v),
    );
  });

  it("does not fire for distinct content", () => {
    const s = snap({
      hashedPaths: [
        { path: "NOTES.md", oid: "bbb" },
        { path: "docs/notes.md", oid: "ccc" },
      ],
    });
    assert.deepEqual(
      violations(s).filter((t) => t.startsWith("root file duplicates")),
      [],
    );
  });
});

describe("rule 5: file mode regression", () => {
  const modeSnap = (over: Partial<HygieneSnapshot>): HygieneSnapshot =>
    snap({
      changedPaths: ["pkg/x.sh"],
      baseModes: new Map([["pkg/x.sh", "100755"]]),
      headModes: new Map([["pkg/x.sh", "100644"]]),
      ...over,
    });

  it("refuses an undeclared mode change and names the declaration site", () => {
    const v = violations(modeSnap({}));
    assert.equal(v.length, 1);
    assert.match(v[0]!, /^file mode changed vs origin\/main: pkg\/x\.sh 100755 -> 100644/);
    assert.match(v[0]!, /add it to ALLOWED_MODE_CHANGES/);
    assert.match(v[0]!, /packages\/policy\/src\/repo-hygiene\.ts/);
  });

  it("reports a declared mode change as INFO and stays clean", () => {
    const declared = ALLOWED_MODE_CHANGES[0]!;
    const s = snap({
      changedPaths: [declared.path],
      baseModes: new Map([[declared.path, "100755"]]),
      headModes: new Map([[declared.path, "100644"]]),
    });
    const r = evaluateRepoHygiene(s);
    assert.equal(r.violations, 0);
    assert.equal(r.exitCode, EXIT_CLEAN);
    const i = infos(s);
    assert.ok(
      i.some((t) => t.startsWith(`declared mode change: ${declared.path} 100755 -> 100644`)),
      JSON.stringify(i),
    );
    // The reason travels with the report, so a reader can judge the exemption.
    assert.ok(i.some((t) => t.includes(declared.reason)));
  });

  it("does not exempt a different path", () => {
    assert.equal(violations(modeSnap({})).length, 1);
  });

  it("ignores a path deleted on this branch", () => {
    assert.deepEqual(violations(modeSnap({ headModes: new Map() })), []);
  });

  it("keeps an unchanged mode silent", () => {
    assert.deepEqual(
      violations(modeSnap({ headModes: new Map([["pkg/x.sh", "100755"]]) })),
      [],
    );
  });

  describe("new files have no base mode to regress from", () => {
    const newFile = (path: string, mode: string, shebang: boolean) =>
      snap({
        changedPaths: [path],
        baseModes: new Map(),
        headModes: new Map([[path, mode]]),
        hasShebang: () => shebang,
      });

    it("reports a non-executable shebang file as INFO, never a violation", () => {
      const s = newFile("tools/new.sh", "100644", true);
      assert.deepEqual(violations(s), []);
      assert.ok(
        infos(s).some((t) => t.startsWith("new file has a shebang and is not executable: tools/new.sh (100644)")),
      );
    });

    it("stays silent for an executable shebang file", () => {
      assert.deepEqual(infos(newFile("tools/new.sh", "100755", true)), []);
    });

    it("excludes .bats, which bats runs rather than executes", () => {
      assert.deepEqual(infos(newFile("tests/new.bats", "100644", true)), []);
    });

    it("stays silent without a shebang", () => {
      assert.deepEqual(infos(newFile("docs/new.md", "100644", false)), []);
    });
  });

  it("reports a missing base rather than treating it as clean", () => {
    const s = snap({ base: null, changedPaths: ["pkg/x.sh"] });
    assert.deepEqual(violations(s), []);
    assert.ok(
      infos(s).some((t) => t.startsWith("mode-regression check SKIPPED: no base ref")),
    );
  });
});

describe("rendering matches the shell contract", () => {
  it("prints the clean line and nothing else when there is nothing to say", () => {
    assert.equal(
      renderRepoHygiene(evaluateRepoHygiene(EMPTY)),
      "repo-hygiene: clean (root allowlist, no state sprawl, no duplicate evidence)\n",
    );
  });

  it("prefixes violations, counts them, and omits the clean line", () => {
    const out = renderRepoHygiene(
      evaluateRepoHygiene(snap({ trackedMarkdownRoot: ["X.md"] })),
    );
    assert.match(out, /^VIOLATION root markdown not in the allowlist: X\.md/);
    assert.match(out, /\nREPO HYGIENE FAILED: 1 violation\(s\)\.\n$/);
    assert.ok(!out.includes("repo-hygiene: clean"));
  });

  it("prefixes INFO with two spaces, as the shell did", () => {
    const out = renderRepoHygiene(evaluateRepoHygiene(snap({ base: null })));
    assert.match(out, /^INFO {2}mode-regression check SKIPPED/);
  });

  it("keeps INFO lines non-fatal", () => {
    const r = evaluateRepoHygiene(snap({ base: null }));
    assert.equal(r.exitCode, EXIT_CLEAN);
    assert.match(renderRepoHygiene(r), /repo-hygiene: clean/);
  });
});

describe("declaration list hygiene", () => {
  it("every entry carries a reason", () => {
    for (const e of ALLOWED_MODE_CHANGES) {
      assert.ok(e.path.length > 0, "path must be non-empty");
      assert.ok(
        e.reason.trim().length > 10,
        `ALLOWED_MODE_CHANGES entry ${e.path} needs a real reason`,
      );
    }
  });

  it("has no duplicate paths", () => {
    const seen = new Set<string>();
    for (const e of ALLOWED_MODE_CHANGES) {
      assert.ok(!seen.has(e.path), `duplicate declaration for ${e.path}`);
      seen.add(e.path);
    }
  });
});
