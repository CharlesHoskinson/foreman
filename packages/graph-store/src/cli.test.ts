import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  cmdSmoke,
  cmdVersionRef,
  runGraphStoreCli,
  serializeCliFailure,
} from "./cli.js";
import { runContractMain } from "./contract-suite.js";
import { graphStoreFailure } from "./failures.js";

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

  it("smoke returns deterministic ok JSON without absolute paths", () => {
    const out: string[] = [];
    const code = cmdSmoke([], {
      writeStdout: (t) => out.push(t),
      writeStderr: () => {},
    });
    assert.equal(code, 0);
    const text = out.join("");
    assert.ok(text.includes('"ok":true') || text.includes('"ok": true'));
    assert.ok(text.includes("FilesOnlyGraphStore"));
    assert.ok(text.includes("<ephemeral>"));
    assert.ok(!text.includes(tmpdir()));
    assert.ok(!/\/home\//.test(text));
    assert.ok(!/\/tmp\//.test(text));
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

  it("serializeCliFailure is closed and redacts absolute paths", () => {
    const f = serializeCliFailure(
      new Error("EACCES: permission denied, open '/home/secret/key'"),
    );
    assert.equal(f._tag, "Failed");
    assert.equal(f.reason, "internal_failed");
    assert.ok(!f.message.includes("/home/"));
    const branded = serializeCliFailure(
      graphStoreFailure(
        "hard_link_rejected",
        "CURRENT is hard-linked (nlink=2)",
      ),
    );
    assert.equal(branded.reason, "hard_link_rejected");
  });
});

describe("compiled CLI runtime", () => {
  it("requires artifact and runs copied GraphStore bundle without repository node_modules", () => {
    const artifact = join(
      repoRoot,
      "skills/foreman/runtime/dist/graph-store.js",
    );
    assert.ok(
      existsSync(artifact),
      `required runtime artifact missing: ${artifact}`,
    );
    const tmp = mkdtempSync(join(tmpdir(), "gs-rt-"));
    try {
      const dest = join(tmp, "graph-store.js");
      cpSync(artifact, dest);
      const cleanEnv = {
        ...process.env,
        NODE_PATH: "",
        NODE_OPTIONS: "",
      };
      // Remove any inherited module path leakage
      delete (cleanEnv as { NODE_PATH?: string }).NODE_PATH;

      const versionOk = spawnSync(
        process.execPath,
        [dest, "version-ref", "main"],
        {
          encoding: "utf8",
          env: cleanEnv,
          cwd: tmp,
        },
      );
      assert.equal(versionOk.status, 0, versionOk.stderr || versionOk.stdout);
      assert.ok((versionOk.stdout || "").includes("Ok"));

      const versionBad = spawnSync(
        process.execPath,
        [dest, "version-ref", "branch:main"],
        {
          encoding: "utf8",
          env: cleanEnv,
          cwd: tmp,
        },
      );
      assert.equal(versionBad.status, 1);
      assert.ok((versionBad.stdout || "").includes("Rejected"));

      // Execute GraphStore contract suite from the copied bundle
      const contract = spawnSync(
        process.execPath,
        [dest, "contract", "files_only"],
        {
          encoding: "utf8",
          env: cleanEnv,
          cwd: tmp,
          timeout: 120_000,
        },
      );
      assert.equal(contract.status, 0, contract.stderr || contract.stdout);
      assert.ok((contract.stdout || "").includes("SUITE OK"));

      const smoke = spawnSync(process.execPath, [dest, "smoke"], {
        encoding: "utf8",
        env: cleanEnv,
        cwd: tmp,
        timeout: 60_000,
      });
      assert.equal(smoke.status, 0, smoke.stderr || smoke.stdout);
      const smokeOut = smoke.stdout || "";
      assert.ok(smokeOut.includes('"ok":true') || smokeOut.includes('"ok": true'));
      assert.ok(!smokeOut.includes(tmpdir()));
      assert.ok(!/\/home\//.test(smokeOut));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
