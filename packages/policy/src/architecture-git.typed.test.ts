/**
 * Typed Git failure and cancellation controls for architecture policy.
 */
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { Effect, Fiber } from "effect";
import {
  ArchitectureGit,
  ArchitectureGitError,
  bindGitCommandForTest,
  currentGitCommandBinding,
  liveArchitectureGit,
  runArchitectureCheck,
} from "./architecture-git.js";
import { runArchitectureCli } from "./architecture-cli.js";
import { canonicalize } from "@foreman/core";

function git(repo: string, args: string[]) {
  const r = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${r.stderr || r.stdout}`);
  }
  return (r.stdout || "").trim();
}

function initRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "foreman-git-typed-"));
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "t@t"]);
  git(repo, ["config", "user.name", "t"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  return repo;
}

describe("typed Git failures", () => {
  it("nonexistent repository fails as git_failure not clean absent", async () => {
    const missing = join(tmpdir(), "foreman-no-repo-" + Date.now());
    const result = await Effect.runPromise(
      Effect.either(
        Effect.gen(function* () {
          const g = yield* ArchitectureGit;
          return yield* g.catBlob(missing, "a".repeat(40), "nope.ts");
        }).pipe(Effect.provide(liveArchitectureGit)),
      ),
    );
    assert.equal(result._tag, "Left");
    if (result._tag === "Left") {
      assert.equal(result.left.reason, "git_failure");
    }

    const tree = await Effect.runPromise(
      Effect.either(
        Effect.gen(function* () {
          const g = yield* ArchitectureGit;
          return yield* g.treeEntry(missing, "a".repeat(40), "nope.ts");
        }).pipe(Effect.provide(liveArchitectureGit)),
      ),
    );
    assert.equal(tree._tag, "Left");
    if (tree._tag === "Left") {
      assert.equal(tree.left.reason, "git_failure");
    }
  });

  it("invalid object fails as git_failure", async () => {
    const repo = initRepo();
    try {
      writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-m", "c"]);
      const result = await Effect.runPromise(
        Effect.either(
          Effect.gen(function* () {
            const g = yield* ArchitectureGit;
            return yield* g.catBlob(repo, "0".repeat(40), "a.ts");
          }).pipe(Effect.provide(liveArchitectureGit)),
        ),
      );
      assert.equal(result._tag, "Left");
      if (result._tag === "Left") {
        assert.equal(result.left.reason, "git_failure");
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("legitimately absent path returns null from catBlob and present:false from treeEntry", async () => {
    const repo = initRepo();
    try {
      writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-m", "c"]);
      const head = git(repo, ["rev-parse", "HEAD"]).toLowerCase();
      const blob = await Effect.runPromise(
        Effect.gen(function* () {
          const g = yield* ArchitectureGit;
          return yield* g.catBlob(repo, head, "missing/path.ts");
        }).pipe(Effect.provide(liveArchitectureGit)),
      );
      assert.equal(blob, null);
      const entry = await Effect.runPromise(
        Effect.gen(function* () {
          const g = yield* ArchitectureGit;
          return yield* g.treeEntry(repo, head, "missing/path.ts");
        }).pipe(Effect.provide(liveArchitectureGit)),
      );
      assert.equal(entry.present, false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("production binding is real git with empty prefix", () => {
    bindGitCommandForTest(null);
    const b = currentGitCommandBinding();
    assert.equal(b.executable, "git");
    assert.deepEqual(b.prefixArgs, []);
  });

  it("liveArchitectureGit still invokes real Git after injection restore", async () => {
    bindGitCommandForTest(null);
    const repo = initRepo();
    try {
      writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-m", "c"]);
      const head = git(repo, ["rev-parse", "HEAD"]).toLowerCase();
      const entry = await Effect.runPromise(
        Effect.gen(function* () {
          const g = yield* ArchitectureGit;
          return yield* g.treeEntry(repo, head, "a.ts");
        }).pipe(Effect.provide(liveArchitectureGit)),
      );
      assert.equal(entry.present, true);
      assert.equal(entry.isExecutable, false);
      const blob = await Effect.runPromise(
        Effect.gen(function* () {
          const g = yield* ArchitectureGit;
          return yield* g.catBlob(repo, head, "a.ts");
        }).pipe(Effect.provide(liveArchitectureGit)),
      );
      assert.ok(blob && blob.byteLength > 0);
    } finally {
      bindGitCommandForTest(null);
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("cancellation terminates an owned Node child after start marker", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "foreman-git-cancel-"));
    const marker = join(tmp, "started.pid");
    const fixture = join(tmp, "block.mjs");
    // Single Node process: write pid, no descendants, stay alive on a timer
    writeFileSync(
      fixture,
      [
        `import { writeFileSync } from "node:fs";`,
        `writeFileSync(${JSON.stringify(marker)}, String(process.pid) + "\\n");`,
        `setInterval(() => {}, 1 << 30);`,
        ``,
      ].join("\n"),
      "utf8",
    );
    bindGitCommandForTest({
      executable: process.execPath,
      prefixArgs: [fixture],
    });
    try {
      const program = Effect.gen(function* () {
        const g = yield* ArchitectureGit;
        return yield* g.listPaths(tmp, "HEAD");
      }).pipe(Effect.provide(liveArchitectureGit));

      const fiber = Effect.runFork(program);

      let pid: number | null = null;
      const startDeadline = Date.now() + 5_000;
      while (Date.now() < startDeadline) {
        if (existsSync(marker)) {
          const text = readFileSync(marker, "utf8").trim();
          const n = Number(text);
          if (Number.isInteger(n) && n > 1) {
            pid = n;
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(pid !== null && pid > 1, "child never wrote start marker");
      assert.doesNotThrow(() => process.kill(pid!, 0));

      await Effect.runPromise(Fiber.interrupt(fiber));
      const exit = await Effect.runPromise(Fiber.await(fiber));
      // Interruption must not complete as Success
      assert.equal(exit._tag, "Failure", "expected fiber Failure on interrupt");

      let dead = false;
      const deadDeadline = Date.now() + 3_000;
      while (Date.now() < deadDeadline) {
        try {
          process.kill(pid!, 0);
          await new Promise((r) => setTimeout(r, 20));
        } catch {
          dead = true;
          break;
        }
      }
      assert.equal(dead, true, "owned child still live after interrupt");
    } finally {
      bindGitCommandForTest(null);
      try {
        if (existsSync(marker)) {
          const n = Number(readFileSync(marker, "utf8").trim());
          if (Number.isInteger(n) && n > 1) {
            try {
              process.kill(n, "SIGKILL");
            } catch {
              // already dead
            }
          }
        }
      } catch {
        // ignore
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("extensionless executable CLI", () => {
  it("rejects executable-mode extensionless Python shebang via real Git", async () => {
    const repo = initRepo();
    try {
      mkdirSync(join(repo, "packages"), { recursive: true });
      writeFileSync(join(repo, "packages/a.ts"), "export const a = 1;\n");
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-m", "base"]);
      const base = git(repo, ["rev-parse", "HEAD"]).toLowerCase();
      mkdirSync(join(repo, "bin"), { recursive: true });
      const tool = join(repo, "bin/release-tool");
      writeFileSync(tool, "#!/usr/bin/env python3\nprint(1)\n");
      chmodSync(tool, 0o755);
      git(repo, ["add", "-A"]);
      // Ensure executable bit is recorded
      spawnSync("git", ["update-index", "--chmod=+x", "bin/release-tool"], {
        cwd: repo,
      });
      git(repo, ["commit", "-m", "tool"]);

      const lines: string[] = [];
      let stderr = "";
      const code = await Effect.runPromise(
        runArchitectureCli(
          ["check", "--base", base, "--repo-root", repo],
          {
            writeStdout: (l) => lines.push(l),
            writeStderr: (l) => {
              stderr += l;
            },
          },
          repo,
        ).pipe(Effect.provide(liveArchitectureGit)),
      );
      assert.equal(code, 1);
      assert.equal(stderr, "");
      const body = JSON.parse(lines[0]!);
      assert.equal(body._tag, "Fail");
      assert.ok(
        body.findings.some(
          (f: { path: string; reason: string }) =>
            f.path === "bin/release-tool" &&
            (f.reason === "prohibited_python" ||
              f.reason === "prohibited_extensionless_executable"),
        ),
        JSON.stringify(body),
      );
      assert.equal(lines[0]!.trimEnd(), canonicalize(body));
      assert.ok(!lines[0]!.includes("print(1)"));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("accepts TypeScript with Node shebang", async () => {
    const repo = initRepo();
    try {
      mkdirSync(join(repo, "packages"), { recursive: true });
      writeFileSync(join(repo, "packages/a.ts"), "export const a = 1;\n");
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-m", "base"]);
      const base = git(repo, ["rev-parse", "HEAD"]).toLowerCase();
      writeFileSync(
        join(repo, "packages/cli.ts"),
        "#!/usr/bin/env node\nexport const n = 1;\n",
      );
      chmodSync(join(repo, "packages/cli.ts"), 0o755);
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-m", "cli"]);

      const result = await Effect.runPromise(
        runArchitectureCheck(repo, base).pipe(
          Effect.provide(liveArchitectureGit),
        ),
      );
      assert.equal(result._tag, "Pass", JSON.stringify(result));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects symlink candidate as special mode", async () => {
    const repo = initRepo();
    try {
      mkdirSync(join(repo, "packages"), { recursive: true });
      writeFileSync(join(repo, "packages/a.ts"), "export const a = 1;\n");
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-m", "base"]);
      const base = git(repo, ["rev-parse", "HEAD"]).toLowerCase();
      // Create a symlink file and force git to record mode 120000
      const { symlinkSync } = await import("node:fs");
      symlinkSync("packages/a.ts", join(repo, "bin-link"));
      git(repo, ["add", "-A"]);
      // Confirm mode
      const modeOut = spawnSync(
        "git",
        ["ls-files", "-s", "bin-link"],
        { cwd: repo, encoding: "utf8" },
      );
      assert.ok(
        (modeOut.stdout || "").startsWith("120000") ||
          (modeOut.stdout || "").includes("120000"),
        "expected symlink mode in index: " + modeOut.stdout,
      );
      git(repo, ["commit", "-m", "link"]);

      const result = await Effect.runPromise(
        runArchitectureCheck(repo, base).pipe(
          Effect.provide(liveArchitectureGit),
        ),
      );
      assert.equal(result._tag, "Fail", JSON.stringify(result));
      assert.ok(
        result.findings.some(
          (f) =>
            f.path === "bin-link" &&
            (f.reason === "prohibited_special_mode" ||
              f.reason === "manifest_bundle_linked"),
        ),
        JSON.stringify(result),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

// silence unused
void ArchitectureGitError;
