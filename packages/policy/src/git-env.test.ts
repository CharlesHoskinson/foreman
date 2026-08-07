import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Effect, Layer } from "effect";
import { canonicalize } from "@foreman/core";
import { gitArgv, sanitizedGitEnv } from "./git-env.js";
import { liveGitIdentity } from "./live-services.js";
import { GitIdentity } from "./services.js";
import {
  CANONICAL_REGISTER_ID,
  CANONICAL_REGISTER_RELPATH,
} from "./schema.js";
import { BEGIN_SENTINEL, END_SENTINEL } from "./register.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("sanitizedGitEnv / gitArgv", () => {
  it("strips GIT_* redirects and forces no-replace flags", () => {
    const env = sanitizedGitEnv({
      PATH: "/bin",
      HOME: "/home/t",
      GIT_DIR: "/evil/git",
      GIT_WORK_TREE: "/evil/wt",
      GIT_OBJECT_DIRECTORY: "/evil/obj",
      GIT_INDEX_FILE: "/evil/index",
      GIT_CONFIG: "/evil/config",
      FOO: "bar",
    });
    assert.equal(env["GIT_DIR"], undefined);
    assert.equal(env["GIT_WORK_TREE"], undefined);
    assert.equal(env["GIT_OBJECT_DIRECTORY"], undefined);
    assert.equal(env["GIT_INDEX_FILE"], undefined);
    assert.equal(env["GIT_CONFIG"], undefined);
    assert.equal(env["GIT_NO_REPLACE_OBJECTS"], "1");
    assert.equal(env["GIT_TERMINAL_PROMPT"], "0");
    assert.equal(env["GIT_OPTIONAL_LOCKS"], "0");
    assert.equal(env["FOO"], "bar");
    assert.deepEqual(gitArgv(["rev-parse", "HEAD"]), [
      "--no-replace-objects",
      "rev-parse",
      "HEAD",
    ]);
  });
});

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
    throw new Error(r.stderr || r.stdout);
  }
  return r.stdout.trim();
}

describe("liveGitIdentity resists hostile GIT_DIR and replace refs", () => {
  it("uses explicit cwd despite inherited GIT_DIR / GIT_WORK_TREE", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "foreman-gitenv-"));
    const evil = mkdtempSync(join(tmpdir(), "foreman-evil-"));
    try {
      git(tmp, ["init"]);
      git(tmp, ["config", "user.email", "t@t"]);
      git(tmp, ["config", "user.name", "t"]);
      git(tmp, ["config", "commit.gpgsign", "false"]);
      const abs = join(tmp, CANONICAL_REGISTER_RELPATH);
      mkdirSync(dirname(abs), { recursive: true });
      const reg = canonicalize({
        schemaVersion: 1,
        registerId: CANONICAL_REGISTER_ID,
        currentEntries: [
          {
            actionKind: "none",
            evidence: "e",
            id: "DST-0060",
            owner: "o",
            recordedAt: "2026-08-04T00:00:41-06:00",
            recoveryStatus: "pending",
            requiredCondition: "g",
            state: "blocked",
            targetOrAction: "t",
          },
        ],
        historicalIncidents: [],
      });
      writeFileSync(
        abs,
        [BEGIN_SENTINEL, reg, END_SENTINEL, ""].join("\n"),
      );
      git(tmp, ["add", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "c"]);
      git(evil, ["init"]);
      const head = git(tmp, ["rev-parse", "HEAD"]).toLowerCase();

      const prevDir = process.env["GIT_DIR"];
      const prevWt = process.env["GIT_WORK_TREE"];
      process.env["GIT_DIR"] = join(evil, ".git");
      process.env["GIT_WORK_TREE"] = evil;
      try {
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const g = yield* GitIdentity;
            return yield* g.snapshotAuthority(tmp, CANONICAL_REGISTER_RELPATH);
          }).pipe(Effect.provide(liveGitIdentity)),
        );
        assert.equal(result.snapshot.commitC, head);
        assert.ok(result.commitBlobBytes.byteLength > 0);
      } finally {
        if (prevDir === undefined) delete process.env["GIT_DIR"];
        else process.env["GIT_DIR"] = prevDir;
        if (prevWt === undefined) delete process.env["GIT_WORK_TREE"];
        else process.env["GIT_WORK_TREE"] = prevWt;
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(evil, { recursive: true, force: true });
    }
  });

  it("does not follow replace refs for HEAD blob", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "foreman-replace-"));
    try {
      git(tmp, ["init"]);
      git(tmp, ["config", "user.email", "t@t"]);
      git(tmp, ["config", "user.name", "t"]);
      git(tmp, ["config", "commit.gpgsign", "false"]);
      const abs = join(tmp, CANONICAL_REGISTER_RELPATH);
      mkdirSync(dirname(abs), { recursive: true });
      const good = canonicalize({
        schemaVersion: 1,
        registerId: CANONICAL_REGISTER_ID,
        currentEntries: [
          {
            actionKind: "none",
            evidence: "good",
            id: "DST-0060",
            owner: "o",
            recordedAt: "2026-08-04T00:00:41-06:00",
            recoveryStatus: "pending",
            requiredCondition: "g",
            state: "blocked",
            targetOrAction: "t",
          },
        ],
        historicalIncidents: [],
      });
      writeFileSync(
        abs,
        [BEGIN_SENTINEL, good, END_SENTINEL, ""].join("\n"),
      );
      git(tmp, ["add", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "good"]);
      const goodHead = git(tmp, ["rev-parse", "HEAD"]).toLowerCase();

      const bad = canonicalize({
        schemaVersion: 1,
        registerId: CANONICAL_REGISTER_ID,
        currentEntries: [
          {
            actionKind: "none",
            evidence: "REPLACED",
            id: "DST-0060",
            owner: "o",
            recordedAt: "2026-08-04T00:00:41-06:00",
            recoveryStatus: "pending",
            requiredCondition: "g",
            state: "blocked",
            targetOrAction: "t",
          },
        ],
        historicalIncidents: [],
      });
      writeFileSync(
        abs,
        [BEGIN_SENTINEL, bad, END_SENTINEL, ""].join("\n"),
      );
      git(tmp, ["add", CANONICAL_REGISTER_RELPATH]);
      git(tmp, ["commit", "-m", "bad"]);
      const badHead = git(tmp, ["rev-parse", "HEAD"]).toLowerCase();
      git(tmp, ["replace", badHead, goodHead]);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const g = yield* GitIdentity;
          return yield* g.snapshotAuthority(tmp, CANONICAL_REGISTER_RELPATH);
        }).pipe(Effect.provide(liveGitIdentity)),
      );
      assert.equal(result.snapshot.commitC, badHead);
      const text = new TextDecoder().decode(result.commitBlobBytes);
      assert.ok(text.includes("REPLACED"));
      assert.ok(!text.includes('"evidence":"good"'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    void root;
  });
});
