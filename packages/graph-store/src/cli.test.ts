import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { cmdVersionRef, runGraphStoreCli } from "./cli.js";
import { runContractMain } from "./contract-suite.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

describe("GraphStore CLI", () => {
  it("version-ref accepts main as Ok", () => {
    const lines: string[] = [];
    const code = cmdVersionRef(["main"], {
      writeStdout: (t) => lines.push(t),
      writeStderr: () => {},
    });
    assert.equal(code, 0);
    assert.ok(lines.join("").includes('"Ok"'));
    assert.ok(lines.join("").includes("main"));
  });

  it("version-ref rejects branch:main with exit 1", () => {
    const lines: string[] = [];
    const code = cmdVersionRef(["branch:main"], {
      writeStdout: (t) => lines.push(t),
      writeStderr: () => {},
    });
    assert.equal(code, 1);
    assert.ok(lines.join("").includes("Rejected"));
  });

  it("version-ref missing arg exits 2", () => {
    let err = "";
    const code = cmdVersionRef([], {
      writeStdout: () => {},
      writeStderr: (t) => {
        err += t;
      },
    });
    assert.equal(code, 2);
    assert.ok(err.includes("usage"));
  });

  it("contract files_only exits 0", () => {
    const code = runContractMain(["files_only"]);
    assert.equal(code, 0);
  });

  it("contract stub --expect-fail exits 0", () => {
    const code = runContractMain(["stub", "--expect-fail"]);
    assert.equal(code, 0);
  });

  it("unknown command exits 2", () => {
    let err = "";
    const code = runGraphStoreCli(["nope"], {
      writeStdout: () => {},
      writeStderr: (t) => {
        err += t;
      },
    });
    assert.equal(code, 2);
    assert.ok(err.includes("unknown command"));
  });

  it("smoke returns ok JSON", () => {
    const out: string[] = [];
    const code = runGraphStoreCli(["smoke"], {
      writeStdout: (t) => out.push(t),
      writeStderr: () => {},
    });
    assert.equal(code, 0);
    const text = out.join("");
    assert.ok(text.includes('"ok":true') || text.includes('"ok": true'));
    assert.ok(text.includes("FilesOnlyGraphStore"));
  });

  it("capabilities lists all optional unavailable for files-only", () => {
    const out: string[] = [];
    const code = runGraphStoreCli(["capabilities"], {
      writeStdout: (t) => out.push(t),
      writeStderr: () => {},
      env: { ...process.env, FOREMAN_GRAPH_STORE: "files_only" },
    });
    assert.equal(code, 0);
    const text = out.join("");
    assert.ok(text.includes("time_travel"));
    assert.ok(text.includes("branch_merge"));
    assert.ok(text.includes("cross_run_query"));
  });
});

describe("compiled CLI runtime (when built)", () => {
  it("runs graph-store.js without repository node_modules when present", () => {
    const artifact = join(
      repoRoot,
      "skills/foreman/runtime/dist/graph-store.js",
    );
    if (!existsSync(artifact)) {
      // Build not yet run in this worktree; skip rather than false fail.
      return;
    }
    const tmp = mkdtempSync(join(tmpdir(), "gs-rt-"));
    try {
      const dest = join(tmp, "graph-store.js");
      cpSync(artifact, dest);
      const r = spawnSync(process.execPath, [dest, "version-ref", "main"], {
        encoding: "utf8",
        env: { ...process.env, NODE_PATH: "" },
        cwd: tmp,
      });
      assert.equal(r.status, 0, r.stderr || r.stdout);
      assert.ok((r.stdout || "").includes("Ok"));
      const bad = spawnSync(
        process.execPath,
        [dest, "version-ref", "branch:main"],
        {
          encoding: "utf8",
          env: { ...process.env, NODE_PATH: "" },
          cwd: tmp,
        },
      );
      assert.equal(bad.status, 1);
      assert.ok((bad.stdout || "").includes("Rejected"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
