/**
 * Temporary-Git integration for architecture policy: hostile GIT_*, replace
 * refs, moving HEAD, oversized output, and end-to-end Pass/Fail.
 */
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { Effect } from "effect";
import { canonicalize, sha256Hex } from "@foreman/core";
import {
  liveArchitectureGit,
  runArchitectureCheck,
} from "./architecture-git.js";
import { runArchitectureCli } from "./architecture-cli.js";

function git(repo: string, args: string[], env?: NodeJS.ProcessEnv) {
  const r = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
      ...env,
    },
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${r.stderr || r.stdout}`);
  }
  return (r.stdout || "").trim();
}

function initRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "foreman-arch-"));
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "t@t"]);
  git(repo, ["config", "user.name", "t"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  return repo;
}

function write(repo: string, rel: string, body: string): void {
  const abs = join(repo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, "utf8");
}

function commitAll(repo: string, msg: string): string {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", msg, "--allow-empty"]);
  return git(repo, ["rev-parse", "HEAD"]).toLowerCase();
}

describe("architecture policy integration", () => {
  it("15. resists hostile GIT_DIR GIT_WORK_TREE and replace refs", async () => {
    const repo = initRepo();
    const evil = mkdtempSync(join(tmpdir(), "foreman-arch-evil-"));
    try {
      write(repo, "packages/ok.ts", `export const n = 1;\n`);
      const base = commitAll(repo, "base");
      write(repo, "packages/ok.ts", `export const n = 2;\n`);
      const head = commitAll(repo, "head");

      git(evil, ["init"]);
      // replace head with base in-repo
      git(repo, ["replace", head, base]);

      const prevDir = process.env["GIT_DIR"];
      const prevWt = process.env["GIT_WORK_TREE"];
      process.env["GIT_DIR"] = join(evil, ".git");
      process.env["GIT_WORK_TREE"] = evil;
      try {
        const result = await Effect.runPromise(
          runArchitectureCheck(repo, base).pipe(
            Effect.provide(liveArchitectureGit),
          ),
        );
        assert.equal(result.head, head);
        assert.equal(result._tag, "Pass");
      } finally {
        if (prevDir === undefined) delete process.env["GIT_DIR"];
        else process.env["GIT_DIR"] = prevDir;
        if (prevWt === undefined) delete process.env["GIT_WORK_TREE"];
        else process.env["GIT_WORK_TREE"] = prevWt;
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(evil, { recursive: true, force: true });
    }
  });

  it("16. fails closed on moving HEAD", async () => {
    const repo = initRepo();
    try {
      write(repo, "a.ts", `export const a = 1;\n`);
      const base = commitAll(repo, "base");
      write(repo, "b.ts", `export const b = 1;\n`);
      commitAll(repo, "head");

      const { ArchitectureGit, ArchitectureGitError } = await import(
        "./architecture-git.js"
      );
      const gitSvc = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* ArchitectureGit;
        }).pipe(Effect.provide(liveArchitectureGit)),
      );
      const id = await Effect.runPromise(gitSvc.resolveIdentity(repo, base));
      write(repo, "c.ts", `export const c = 1;\n`);
      commitAll(repo, "move");
      const moved = await Effect.runPromise(
        Effect.either(gitSvc.recheckHead(repo, id.head)),
      );
      assert.equal(moved._tag, "Left");
      if (moved._tag === "Left") {
        assert.ok(moved.left instanceof ArchitectureGitError);
        assert.equal(moved.left.reason, "head_moved");
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("end-to-end CLI Pass for clean TypeScript add and Fail for .py", async () => {
    const repo = initRepo();
    try {
      write(repo, "packages/a.ts", `export const a = 1;\n`);
      const base = commitAll(repo, "base");
      write(repo, "packages/b.ts", `export const b = 1;\n`);
      commitAll(repo, "head");

      const lines: string[] = [];
      const code = await Effect.runPromise(
        runArchitectureCli(
          [
            "node",
            "architecture-policy.js",
            "check",
            "--base",
            base,
            "--repo-root",
            repo,
          ],
          {
            writeStdout: (l) => lines.push(l),
            writeStderr: () => {},
          },
          repo,
        ).pipe(Effect.provide(liveArchitectureGit)),
      );
      assert.equal(code, 0);
      const pass = JSON.parse(lines[0]!);
      assert.equal(pass._tag, "Pass");
      assert.equal(pass.head.length, 40);
      assert.equal(pass.mergeBase.length, 40);
      assert.equal(pass.base.length, 40);

      // Fail branch: add py
      write(repo, "tools/bad.py", "print(1)\n");
      commitAll(repo, "py");
      lines.length = 0;
      const code2 = await Effect.runPromise(
        runArchitectureCli(
          ["check", "--base", base, "--repo-root", repo],
          {
            writeStdout: (l) => lines.push(l),
            writeStderr: () => {},
          },
          repo,
        ).pipe(Effect.provide(liveArchitectureGit)),
      );
      assert.equal(code2, 1);
      const fail = JSON.parse(lines[0]!);
      assert.equal(fail._tag, "Fail");
      assert.ok(
        fail.findings.some(
          (f: { path: string; reason: string }) =>
            f.path === "tools/bad.py" && f.reason === "prohibited_python",
        ),
      );
      // No raw content
      assert.ok(!lines[0]!.includes("print(1)"));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("accepts manifest-bound generated bundle in a temp repo", async () => {
    const repo = initRepo();
    try {
      write(repo, "packages/a.ts", `export const a = 1;\n`);
      const base = commitAll(repo, "base");
      const bundleBody = "export const runtime = true;\n";
      const bundleBytes = new TextEncoder().encode(bundleBody);
      const sha = sha256Hex(bundleBytes);
      const mf =
        canonicalize({
          artifacts: [
            {
              byteLength: bundleBytes.byteLength,
              id: "architecture-policy",
              relativePath: "dist/architecture-policy.js",
              sha256: sha,
            },
          ],
          nodeRange: ">=24 <25",
          schemaVersion: 2,
        }) + "\n";
      write(
        repo,
        "skills/foreman/runtime/dist/architecture-policy.js",
        bundleBody,
      );
      write(repo, "skills/foreman/runtime/manifest.json", mf);
      commitAll(repo, "bundle");

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

  it("reports legacy debt for unchanged .py without failing", async () => {
    const repo = initRepo();
    try {
      write(repo, "legacy/tool.py", "print('old')\n");
      write(repo, "packages/a.ts", `export const a = 1;\n`);
      const base = commitAll(repo, "base");
      write(repo, "packages/b.ts", `export const b = 1;\n`);
      commitAll(repo, "head");

      const result = await Effect.runPromise(
        runArchitectureCheck(repo, base).pipe(
          Effect.provide(liveArchitectureGit),
        ),
      );
      assert.equal(result._tag, "Pass");
      if (result._tag !== "Pass") return;
      assert.ok(
        result.legacyDebt.some(
          (d) =>
            d.path === "legacy/tool.py" && d.reason === "prohibited_python",
        ),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("CLI fails malformed manifest-only commit with empty stderr", async () => {
    const repo = initRepo();
    try {
      write(repo, "packages/a.ts", `export const a = 1;\n`);
      const base = commitAll(repo, "base");
      write(repo, "skills/foreman/runtime/manifest.json", "{not-json}\n");
      commitAll(repo, "bad-mf");

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
            f.path === "skills/foreman/runtime/manifest.json" &&
            f.reason === "schema_mismatch",
        ),
      );
      assert.equal(lines[0]!.trimEnd(), canonicalize(body));
      assert.ok(!lines[0]!.includes("{not-json}"));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("CLI fails closed-schema-invalid manifest-only commit", async () => {
    const repo = initRepo();
    try {
      write(repo, "packages/a.ts", `export const a = 1;\n`);
      const base = commitAll(repo, "base");
      const bad =
        canonicalize({
          artifacts: [
            {
              byteLength: 1,
              id: "x",
              relativePath: "../escape.js",
              sha256: "a".repeat(64),
            },
          ],
          nodeRange: ">=24 <25",
          schemaVersion: 2,
          unknownField: true,
        }) + "\n";
      write(repo, "skills/foreman/runtime/manifest.json", bad);
      commitAll(repo, "bad-schema");

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
      assert.ok(body.findings.length >= 1);
      assert.equal(lines[0]!.trimEnd(), canonicalize(body));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  // silence unused in case symlink not needed on this platform
  void symlinkSync;
});
