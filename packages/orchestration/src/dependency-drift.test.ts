/**
 * dependency-drift: pure authority, strict [[tools]] parse, reconcile, CLI.
 * Sprint 3 R4B3 — TDD.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import {
  BoundedFs,
  type BoundedReadResult,
} from "./queue-services.js";
import {
  EXIT_AGREE,
  EXIT_DRIFT,
  EXIT_FAIL_CLOSED,
  MAX_DRIFT_INPUT_BYTES,
  MSG_NO_DRIFT,
  PSEUDO_IDS,
  UNPROVISIONED_IDS,
  buildCheckerAuthority,
  collectCheckerAuthority,
  parseManifestTools,
  providedBy,
  reconcileDependencyDrift,
  runDependencyDrift,
  stripDriftNodeArgv,
  type DriftIo,
  type ManifestToolRecord,
} from "./dependency-drift.js";

function captureIo(): DriftIo & {
  readonly stdout: () => string;
  readonly stderr: () => string;
} {
  let out = "";
  let err = "";
  return {
    writeStdout: (t) => {
      out += t;
    },
    writeStderr: (t) => {
      err += t;
    },
    stdout: () => out,
    stderr: () => err,
  };
}

function memFs(
  files: ReadonlyMap<string, BoundedReadResult | string>,
): Layer.Layer<BoundedFs> {
  return Layer.succeed(BoundedFs, {
    readFileBounded: (path, maxBytes) =>
      Effect.sync(() => {
        const v = files.get(path);
        if (v === undefined) return { _tag: "Absent" as const };
        if (typeof v !== "string") return v;
        const bytes = Buffer.byteLength(v, "utf8");
        if (bytes > maxBytes) return { _tag: "Oversized" as const };
        return { _tag: "Ok" as const, text: v };
      }),
  });
}

// ---------------------------------------------------------------------------
// Task 1 — pure authority + parser + reconcile
// ---------------------------------------------------------------------------

describe("buildCheckerAuthority / collectCheckerAuthority", () => {
  it("unions must+should across every profile and both WSL states", () => {
    const a = collectCheckerAuthority();
    // soft must
    assert.ok(a.checkerIds.includes("git"));
    assert.ok(a.checkerIds.includes("grok"));
    assert.ok(a.checkerIds.includes("strace"));
    // hard must
    assert.ok(a.checkerIds.includes("docker"));
    assert.ok(a.checkerIds.includes("flock"));
    // full must
    assert.ok(a.checkerIds.includes("bats"));
    assert.ok(a.checkerIds.includes("lychee"));
    // durable should
    assert.ok(a.checkerIds.includes("nats-server"));
    assert.ok(a.checkerIds.includes("nats-cli"));
    // soft should
    assert.ok(a.checkerIds.includes("node"));
    // WSL-only should
    assert.ok(a.checkerIds.includes("foreman-launch"));
    assert.ok(a.checkerIds.includes("foreman_home_fs"));
  });

  it("mandatory set is the union of must lists only", () => {
    const a = collectCheckerAuthority();
    assert.ok(a.checkerMust.includes("git"));
    assert.ok(a.checkerMust.includes("strace"));
    assert.ok(a.checkerMust.includes("docker"));
    assert.ok(a.checkerMust.includes("bats"));
    assert.ok(a.checkerMust.includes("coreutils"));
    // should-only tools must not appear in mandatory
    assert.ok(!a.checkerMust.includes("node"));
    assert.ok(!a.checkerMust.includes("nats-server"));
    assert.ok(!a.checkerMust.includes("foreman-launch"));
    assert.ok(!a.checkerMust.includes("timeout"));
  });

  it("orders checker ids and must ids deterministically", () => {
    const a = collectCheckerAuthority();
    const sortedIds = [...a.checkerIds].sort((x, y) =>
      x < y ? -1 : x > y ? 1 : 0,
    );
    const sortedMust = [...a.checkerMust].sort((x, y) =>
      x < y ? -1 : x > y ? 1 : 0,
    );
    assert.deepEqual([...a.checkerIds], sortedIds);
    assert.deepEqual([...a.checkerMust], sortedMust);
  });

  it("buildCheckerAuthority is pure over injected profile rows", () => {
    const a = buildCheckerAuthority([
      { must: ["z", "a"], should: ["m"] },
      { must: ["a"], should: ["b", "z"] },
    ]);
    assert.deepEqual([...a.checkerIds], ["a", "b", "m", "z"]);
    assert.deepEqual([...a.checkerMust], ["a", "z"]);
  });
});

describe("pseudo IDs, package aliases, unprovisioned", () => {
  it("names the three pseudo IDs", () => {
    assert.ok(PSEUDO_IDS.has("foreman_home_fs"));
    assert.ok(PSEUDO_IDS.has("foreman_skill"));
    assert.ok(PSEUDO_IDS.has("foreman-launch"));
    assert.equal(PSEUDO_IDS.size, 3);
  });

  it("maps flock → util-linux and timeout → coreutils", () => {
    assert.equal(providedBy("flock"), "util-linux");
    assert.equal(providedBy("timeout"), "coreutils");
    assert.equal(providedBy("git"), "git");
  });

  it("names deliberately unprovisioned durable transport IDs", () => {
    assert.ok(UNPROVISIONED_IDS.has("nats-server"));
    assert.ok(UNPROVISIONED_IDS.has("nats-cli"));
    assert.equal(UNPROVISIONED_IDS.size, 2);
  });
});

describe("parseManifestTools strict [[tools]]", () => {
  it("parses id + required pairs and ignores unrelated sections", () => {
    const text = `
schema_version = 1
[platform]
primary = "wsl"

[[tools]]
id = "git"
profile = ["soft"]
required = true
notes = "ok"

[[vendor_capabilities]]
vendor = "grok"

[[tools]]
id = "node"
required = false
`;
    const r = parseManifestTools(text);
    assert.equal(r._tag, "Ok");
    if (r._tag !== "Ok") return;
    assert.equal(r.records.length, 2);
    assert.deepEqual(
      r.records.map((x) => [x.id, x.required]),
      [
        ["git", true],
        ["node", false],
      ],
    );
    assert.deepEqual([...r.ids], ["git", "node"]);
    assert.deepEqual([...r.requiredIds], ["git"]);
  });

  it("rejects missing id", () => {
    const r = parseManifestTools(`
[[tools]]
required = true
`);
    assert.equal(r._tag, "Error");
    if (r._tag !== "Error") return;
    assert.match(r.reason, /missing id/i);
  });

  it("rejects duplicate id", () => {
    const r = parseManifestTools(`
[[tools]]
id = "git"
required = true

[[tools]]
id = "git"
required = true
`);
    assert.equal(r._tag, "Error");
    if (r._tag !== "Error") return;
    assert.match(r.reason, /duplicate id/i);
  });

  it("rejects missing required flag", () => {
    const r = parseManifestTools(`
[[tools]]
id = "git"
`);
    assert.equal(r._tag, "Error");
    if (r._tag !== "Error") return;
    assert.match(r.reason, /missing required/i);
  });

  it("rejects invalid Boolean for required", () => {
    const r = parseManifestTools(`
[[tools]]
id = "git"
required = yes
`);
    assert.equal(r._tag, "Error");
    if (r._tag !== "Error") return;
    assert.match(r.reason, /invalid|boolean|required/i);
  });

  it("ignores id = lines outside [[tools]] records", () => {
    const r = parseManifestTools(`
id = "not-a-tool"
[pins]
id = "pin-id"

[[tools]]
id = "real"
required = false
`);
    assert.equal(r._tag, "Ok");
    if (r._tag !== "Ok") return;
    assert.deepEqual([...r.ids], ["real"]);
  });
});

describe("reconcileDependencyDrift output classes and exit codes", () => {
  const baseManifest: ManifestToolRecord[] = [
    { id: "git", required: true },
    { id: "node", required: false },
    { id: "extra-manifest", required: false },
  ];

  it("returns exit 0 and no-drift line when records agree", () => {
    const r = reconcileDependencyDrift({
      checkerIds: ["git", "node", "foreman_skill"],
      checkerMust: ["git", "foreman_skill"],
      tools: baseManifest.filter((t) => t.id !== "extra-manifest"),
      bootstrapText: "install git node\n",
    });
    assert.equal(r.exitCode, EXIT_AGREE);
    assert.ok(r.stdout.some((l) => l.includes(MSG_NO_DRIFT)));
    assert.equal(r.stderr.length, 0);
    assert.ok(!r.stdout.some((l) => l.startsWith("DRIFT ")));
  });

  it("DRIFT when checker gates on id absent from manifest", () => {
    const r = reconcileDependencyDrift({
      checkerIds: ["git", "mystery"],
      checkerMust: ["git"],
      tools: [{ id: "git", required: true }],
      bootstrapText: "git mystery\n",
    });
    assert.equal(r.exitCode, EXIT_DRIFT);
    assert.ok(
      r.stdout.some(
        (l) =>
          l ===
          "DRIFT checker gates on 'mystery' but env/reference-manifest.toml does not declare it",
      ),
    );
    assert.ok(
      r.stdout.some((l) =>
        l.includes("DEPENDENCY DRIFT -- records disagree"),
      ),
    );
  });

  it("INFO when manifest declares an id the checker does not report", () => {
    const r = reconcileDependencyDrift({
      checkerIds: ["git"],
      checkerMust: ["git"],
      tools: [
        { id: "git", required: true },
        { id: "psscriptanalyzer", required: false },
      ],
      bootstrapText: "git\n",
    });
    assert.equal(r.exitCode, EXIT_AGREE);
    assert.ok(
      r.stdout.some(
        (l) =>
          l ===
          'INFO  manifest declares "psscriptanalyzer" but env/tool-check.sh does not report it',
      ),
    );
  });

  it("INFO for deliberately unprovisioned durable transport ids", () => {
    const r = reconcileDependencyDrift({
      checkerIds: ["git", "nats-server", "nats-cli"],
      checkerMust: ["git"],
      tools: [
        { id: "git", required: true },
        { id: "nats-server", required: false },
        { id: "nats-cli", required: false },
      ],
      bootstrapText: "git\n",
    });
    assert.equal(r.exitCode, EXIT_AGREE);
    assert.ok(
      r.stdout.some((l) =>
        l.includes(
          '"nats-server" is gated but deliberately not provisioned',
        ),
      ),
    );
    assert.ok(
      r.stdout.some((l) =>
        l.includes('"nats-cli" is gated but deliberately not provisioned'),
      ),
    );
  });

  it("DRIFT when provisioner has no install route (with package alias)", () => {
    const r = reconcileDependencyDrift({
      checkerIds: ["flock", "timeout", "strace"],
      checkerMust: ["flock", "strace"],
      tools: [
        { id: "flock", required: true },
        { id: "timeout", required: false },
        { id: "strace", required: true },
      ],
      // util-linux present for flock; coreutils absent so timeout drifts;
      // strace also absent.
      bootstrapText: "install util-linux only\n",
    });
    assert.equal(r.exitCode, EXIT_DRIFT);
    assert.ok(
      r.stdout.some(
        (l) =>
          l ===
          "DRIFT checker gates on 'timeout' but env/bootstrap-wsl.sh has no install route for it (looked for 'coreutils')",
      ),
    );
    assert.ok(
      r.stdout.some(
        (l) =>
          l ===
          "DRIFT checker gates on 'strace' but env/bootstrap-wsl.sh has no install route for it (looked for 'strace')",
      ),
    );
    // flock alias satisfied via util-linux
    assert.ok(!r.stdout.some((l) => l.includes("gates on 'flock'")));
  });

  it("DRIFT when manifest required=true but checker grades should-only", () => {
    const r = reconcileDependencyDrift({
      checkerIds: ["git", "strace"],
      checkerMust: ["git"], // strace visible but not mandatory
      tools: [
        { id: "git", required: true },
        { id: "strace", required: true },
      ],
      bootstrapText: "git strace\n",
    });
    assert.equal(r.exitCode, EXIT_DRIFT);
    assert.ok(
      r.stdout.some(
        (l) =>
          l ===
          "DRIFT env/reference-manifest.toml marks 'strace' required = true but env/tool-check.sh grades it should_*, so a host without it still reports READY",
      ),
    );
  });

  it("skips pseudo IDs for manifest and provisioner rules", () => {
    const r = reconcileDependencyDrift({
      checkerIds: ["git", "foreman_skill", "foreman_home_fs", "foreman-launch"],
      checkerMust: ["git", "foreman_skill"],
      tools: [{ id: "git", required: true }],
      bootstrapText: "git\n",
    });
    assert.equal(r.exitCode, EXIT_AGREE);
    assert.ok(!r.stdout.some((l) => l.startsWith("DRIFT ")));
  });

  it("returns exit 2 when checker authority is empty", () => {
    const r = reconcileDependencyDrift({
      checkerIds: [],
      checkerMust: [],
      tools: [{ id: "git", required: true }],
      bootstrapText: "git\n",
    });
    assert.equal(r.exitCode, EXIT_FAIL_CLOSED);
    assert.ok(r.stderr.some((l) => /empty|authority|zero/i.test(l)));
  });

  it("emits diagnostics in deterministic sorted order by id", () => {
    const r = reconcileDependencyDrift({
      checkerIds: ["z-tool", "a-tool"],
      checkerMust: [],
      tools: [],
      bootstrapText: "a-tool z-tool\n",
    });
    assert.equal(r.exitCode, EXIT_DRIFT);
    const driftLines = r.stdout.filter((l) => l.startsWith("DRIFT checker gates"));
    assert.equal(driftLines.length, 2);
    assert.ok(driftLines[0]!.includes("'a-tool'"));
    assert.ok(driftLines[1]!.includes("'z-tool'"));
  });
});

// ---------------------------------------------------------------------------
// Task 2 — typed CLI / Effect boundary
// ---------------------------------------------------------------------------

describe("stripDriftNodeArgv", () => {
  it("strips node binary and script path", () => {
    assert.deepEqual(
      stripDriftNodeArgv([
        "/usr/bin/node",
        "/repo/skills/foreman/runtime/dist/dependency-drift.js",
      ]),
      [],
    );
  });
});

describe("runDependencyDrift CLI", () => {
  it("agrees on explicit test inputs (exit 0, no drift)", async () => {
    const manifest = `
[[tools]]
id = "git"
required = true

[[tools]]
id = "node"
required = false
`;
    const bootstrap = "install git node util-linux coreutils\n";
    const io = captureIo();
    const code = await Effect.runPromise(
      runDependencyDrift(["node", "dependency-drift.js"], io, {
        repoRoot: "/repo",
        layer: memFs(
          new Map([
            ["/repo/env/reference-manifest.toml", manifest],
            ["/repo/env/bootstrap-wsl.sh", bootstrap],
          ]),
        ),
        authority: {
          checkerIds: ["git", "node", "foreman_skill"],
          checkerMust: ["git", "foreman_skill"],
        },
      }),
    );
    assert.equal(code, EXIT_AGREE);
    assert.match(io.stdout(), /dependencies: no drift/);
    assert.equal(io.stderr(), "");
  });

  it("rejects unknown arguments with exit 2", async () => {
    const io = captureIo();
    const code = await Effect.runPromise(
      runDependencyDrift(["node", "dependency-drift.js", "--nope"], io, {
        repoRoot: "/repo",
        layer: memFs(new Map()),
      }),
    );
    assert.equal(code, EXIT_FAIL_CLOSED);
    assert.match(io.stderr(), /invalid|unknown|usage/i);
  });

  it("fail-closed on unreadable / absent manifest", async () => {
    const io = captureIo();
    const code = await Effect.runPromise(
      runDependencyDrift(["node", "dependency-drift.js"], io, {
        repoRoot: "/repo",
        layer: memFs(
          new Map([
            ["/repo/env/bootstrap-wsl.sh", "git\n"],
          ]),
        ),
        authority: {
          checkerIds: ["git"],
          checkerMust: ["git"],
        },
      }),
    );
    assert.equal(code, EXIT_FAIL_CLOSED);
    assert.match(io.stderr(), /unreadable|absent|ERROR/i);
    assert.doesNotMatch(io.stderr(), /\/repo\//);
  });

  it("fail-closed on oversized input over MAX_DRIFT_INPUT_BYTES", async () => {
    const io = captureIo();
    const files = new Map<string, BoundedReadResult | string>([
      ["/repo/env/reference-manifest.toml", { _tag: "Oversized" }],
      ["/repo/env/bootstrap-wsl.sh", "git\n"],
    ]);
    const code = await Effect.runPromise(
      runDependencyDrift(["node", "dependency-drift.js"], io, {
        repoRoot: "/repo",
        layer: memFs(files),
        authority: {
          checkerIds: ["git"],
          checkerMust: ["git"],
        },
      }),
    );
    assert.equal(code, EXIT_FAIL_CLOSED);
    assert.match(io.stderr(), /oversized|ERROR/i);
    assert.doesNotMatch(io.stderr(), /\/repo\//);
  });

  it("fail-closed on malformed tools table", async () => {
    const io = captureIo();
    const code = await Effect.runPromise(
      runDependencyDrift(["node", "dependency-drift.js"], io, {
        repoRoot: "/repo",
        layer: memFs(
          new Map([
            [
              "/repo/env/reference-manifest.toml",
              `[[tools]]\nrequired = true\n`,
            ],
            ["/repo/env/bootstrap-wsl.sh", "git\n"],
          ]),
        ),
        authority: {
          checkerIds: ["git"],
          checkerMust: ["git"],
        },
      }),
    );
    assert.equal(code, EXIT_FAIL_CLOSED);
    assert.match(io.stderr(), /malformed|missing id|ERROR/i);
  });

  it("reports DRIFT exit 1 for fixture disagreement", async () => {
    const io = captureIo();
    const code = await Effect.runPromise(
      runDependencyDrift(["node", "dependency-drift.js"], io, {
        repoRoot: "/repo",
        layer: memFs(
          new Map([
            [
              "/repo/env/reference-manifest.toml",
              `[[tools]]\nid = "git"\nrequired = true\n`,
            ],
            ["/repo/env/bootstrap-wsl.sh", "git mystery\n"],
          ]),
        ),
        authority: {
          checkerIds: ["git", "mystery"],
          checkerMust: ["git"],
        },
      }),
    );
    assert.equal(code, EXIT_DRIFT);
    assert.match(io.stdout(), /DRIFT checker gates on 'mystery'/);
  });

  it("enforces MAX_DRIFT_INPUT_BYTES bound of 1 MiB", () => {
    assert.equal(MAX_DRIFT_INPUT_BYTES, 1_048_576);
  });

  it("default repository root resolves this worktree when run without override", async () => {
    // Live read of authored tree via default resolveRepoRoot path.
    const io = captureIo();
    const code = await Effect.runPromise(
      runDependencyDrift(["node", "dependency-drift.js"], io, {
        // no repoRoot override: implementation must resolve from import.meta / cwd
      }),
    );
    assert.equal(code, EXIT_AGREE);
    assert.match(io.stdout(), /dependencies: no drift/);
  });

  it("does not read or parse env/tool-check.sh source", async () => {
    // Provide a trap tool-check that would blow up if opened; only manifest
    // and bootstrap are required inputs.
    const dir = mkdtempSync(join(tmpdir(), "drift-"));
    mkdirSync(join(dir, "env"), { recursive: true });
    writeFileSync(
      join(dir, "env/reference-manifest.toml"),
      `[[tools]]\nid = "git"\nrequired = true\n`,
      "utf8",
    );
    writeFileSync(join(dir, "env/bootstrap-wsl.sh"), "git\n", "utf8");
    // Unreadable trap at tool-check path — must not be opened.
    writeFileSync(join(dir, "env/tool-check.sh"), "must_soft=(git)\n", "utf8");
    chmodSync(join(dir, "env/tool-check.sh"), 0o000);

    const io = captureIo();
    try {
      const code = await Effect.runPromise(
        runDependencyDrift(["node", "dependency-drift.js"], io, {
          repoRoot: dir,
          authority: {
            checkerIds: ["git", "foreman_skill"],
            checkerMust: ["git", "foreman_skill"],
          },
        }),
      );
      assert.equal(code, EXIT_AGREE);
    } finally {
      try {
        chmodSync(join(dir, "env/tool-check.sh"), 0o644);
      } catch {
        /* ignore */
      }
    }
  });
});
