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

  it("reads the qualified graph under its 32 MiB release bound", async () => {
    const repo = initRepo();
    try {
      const graphDir = join(repo, "graphify-out");
      mkdirSync(graphDir, { recursive: true });
      writeFileSync(
        join(graphDir, "graph.json"),
        Buffer.alloc(1024 * 1024 + 1, 0x20),
      );
      git(repo, ["add", "graphify-out/graph.json"]);
      git(repo, ["commit", "-m", "graph"]);
      const head = git(repo, ["rev-parse", "HEAD"]).toLowerCase();
      const blob = await Effect.runPromise(
        Effect.gen(function* () {
          const g = yield* ArchitectureGit;
          return yield* g.catBlob(
            repo,
            head,
            "graphify-out/graph.json",
          );
        }).pipe(Effect.provide(liveArchitectureGit)),
      );
      assert.equal(blob?.byteLength, 1024 * 1024 + 1);
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
      // Windows may hold a short-lived handle after the owned child dies;
      // Node retries EPERM/EBUSY on recursive rm when maxRetries is set.
      rmSync(tmp, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  });

  /**
   * RED witness for missing cancel finalizer: Fiber.interrupt must not
   * complete until the owned child has emitted close (cwd handle released).
   * Fixture delays exit after SIGTERM so a fire-and-forget kill returns early
   * while the child is still live — base without close-wait fails immediately.
   */
  it("Fiber interruption does not complete before owned-child close cleanup", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "foreman-git-cancel-close-"));
    const marker = join(tmp, "started.pid");
    const fixture = join(tmp, "block-close.mjs");
    const exitDelayMs = 250;
    writeFileSync(
      fixture,
      [
        `import { writeFileSync } from "node:fs";`,
        `writeFileSync(${JSON.stringify(marker)}, String(process.pid) + "\\n");`,
        `const stop = () => {`,
        `  setTimeout(() => process.exit(1), ${exitDelayMs});`,
        `};`,
        `process.on("SIGTERM", stop);`,
        `process.on("SIGINT", stop);`,
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

      const t0 = Date.now();
      await Effect.runPromise(Fiber.interrupt(fiber));
      const interruptMs = Date.now() - t0;
      const exit = await Effect.runPromise(Fiber.await(fiber));
      assert.equal(exit._tag, "Failure", "expected fiber Failure on interrupt");

      // Immediate: finalizer must have observed close (child fully gone).
      // Without wait-for-close, SIGTERM + delayed exit leaves the child live.
      let stillAlive = true;
      try {
        process.kill(pid!, 0);
      } catch {
        stillAlive = false;
      }
      assert.equal(
        stillAlive,
        false,
        "interrupt completed before owned child close (child still live)",
      );
      // Interrupt path must have waited at least the fixture delay (POSIX).
      // Windows may terminate without delivering SIGTERM; still require close.
      if (process.platform !== "win32") {
        assert.ok(
          interruptMs >= exitDelayMs - 50,
          `interrupt returned too early (${interruptMs}ms < ~${exitDelayMs}ms close delay)`,
        );
      }
      assert.ok(
        interruptMs < 5_000,
        `interrupt blocked too long (${interruptMs}ms)`,
      );
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
      // Windows cleanup assertion: cwd handle must be released by close wait
      // so recursive rm succeeds (same failure mode as hosted run 30972467450).
      rmSync(tmp, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
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
