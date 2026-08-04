import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import { canonicalize } from "@foreman/core";
import {
  parseArchitectureArgv,
  runArchitectureCli,
} from "./architecture-cli.js";
import {
  ArchitectureGit,
  ArchitectureGitError,
} from "./architecture-git.js";

describe("parseArchitectureArgv", () => {
  it("accepts check --base and optional --repo-root", () => {
    assert.deepEqual(
      parseArchitectureArgv(
        ["node", "architecture-policy.js", "check", "--base", "abc"],
        "/cwd",
      ),
      { command: "check", base: "abc", repoRoot: "/cwd" },
    );
    assert.deepEqual(
      parseArchitectureArgv(
        [
          "check",
          "--base",
          "main",
          "--repo-root",
          "/repo",
        ],
        "/cwd",
      ),
      { command: "check", base: "main", repoRoot: "/repo" },
    );
  });

  it("rejects unknown duplicate missing and extra", () => {
    assert.equal(
      "error" in parseArchitectureArgv(["check"], "/c"),
      true,
    );
    assert.equal(
      "error" in
        parseArchitectureArgv(["check", "--base", "a", "--base", "b"], "/c"),
      true,
    );
    assert.equal(
      "error" in
        parseArchitectureArgv(["check", "--base", "a", "extra"], "/c"),
      true,
    );
    assert.equal(
      "error" in
        parseArchitectureArgv(["check", "--base", "a", "--unknown", "x"], "/c"),
      true,
    );
    assert.equal(
      "error" in parseArchitectureArgv(["check", "--base"], "/c"),
      true,
    );
    assert.equal(
      "error" in parseArchitectureArgv(["relocate", "--base", "a"], "/c"),
      true,
    );
  });
});

describe("runArchitectureCli", () => {
  it("exits 64 on bad argv and 1 on git failure without secrets", async () => {
    const gitLayer = Layer.succeed(ArchitectureGit, {
      resolveIdentity: () =>
        Effect.fail(new ArchitectureGitError("git_failure")),
      nameStatusDelta: () => Effect.fail(new ArchitectureGitError("git_failure")),
      listPaths: () => Effect.fail(new ArchitectureGitError("git_failure")),
      catBlob: () => Effect.fail(new ArchitectureGitError("git_failure")),
      treeEntry: () => Effect.fail(new ArchitectureGitError("git_failure")),
      recheckHead: () => Effect.void,
    });
    const lines: string[] = [];
    const code = await Effect.runPromise(
      runArchitectureCli(
        ["check"],
        { writeStdout: (l) => lines.push(l), writeStderr: () => {} },
        "/cwd",
      ).pipe(Effect.provide(gitLayer)),
    );
    assert.equal(code, 64);
    assert.ok(lines[0]!.includes("schema_mismatch"));
    assert.ok(!lines[0]!.includes("GIT_"));

    lines.length = 0;
    const code2 = await Effect.runPromise(
      runArchitectureCli(
        ["check", "--base", "main", "--repo-root", "/repo"],
        { writeStdout: (l) => lines.push(l), writeStderr: () => {} },
        "/cwd",
      ).pipe(Effect.provide(gitLayer)),
    );
    assert.equal(code2, 1);
    const body = JSON.parse(lines[0]!);
    assert.equal(body._tag, "Failed");
    assert.equal(body.reason, "git_failure");
    // Canonical closed shape
    assert.equal(
      lines[0]!.trimEnd(),
      canonicalize(body),
    );
  });
});
