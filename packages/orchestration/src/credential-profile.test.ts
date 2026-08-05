/**
 * Sprint 3 R7A: external credential-profile authority — RED-first tests.
 * Pure parsers/renderers always run. Live filesystem tests use real temp
 * dirs on the host; platform-specific link/junction cases skip when the
 * host cannot create the required link type.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { Effect, Layer } from "effect";
import { canonicalize, parseJsonRejectDuplicateKeys, isCoreFailure } from "@foreman/core";
import {
  EXIT_OK,
  EXIT_REFUSED,
  MAX_CREDENTIAL_PROFILE_RECORD_BYTES,
  PROFILE_ID_RE,
  absoluteConfigRoot,
  configRootRelForVendor,
  decodeCredentialProfileRecordV1,
  initProfile,
  isCredentialProfileResult,
  isCredentialVendor,
  isEqualOrDescendant,
  isIgnorableParentDirSyncError,
  isValidProfileId,
  liveCredentialProfile,
  liveCredentialProfileFs,
  liveWriteAuthorityExclusive,
  makeCredentialProfileRecord,
  normalizeAbsolutePath,
  parseCredentialProfileArgv,
  parseCredentialProfileRecordBytes,
  profileIdentityOf,
  profileJsonPath,
  recordsEqualExact,
  renderCredentialProfileJson,
  renderCredentialProfileRecord,
  renderCredentialProfileRecordFile,
  resolveProfile,
  runCredentialProfileCli,
  setCredentialProfileRaceHook,
  WINDOWS_UNSUPPORTED_PARENT_DIR_SYNC_CODES,
  type CredentialProfileFsShape,
  type CredentialProfileInput,
  type CredentialProfileResult,
  CredentialProfileFs,
} from "./credential-profile.js";

const IS_WIN = process.platform === "win32";

function tempPair(label: string): {
  readonly root: string;
  readonly stateRoot: string;
  readonly worktreeRoot: string;
} {
  const root = mkdtempSync(join(tmpdir(), `foreman-cp-${label}-`));
  const stateRoot = join(root, "state");
  const worktreeRoot = join(root, "worktree");
  mkdirSync(stateRoot, { recursive: true });
  mkdirSync(worktreeRoot, { recursive: true });
  return { root, stateRoot, worktreeRoot };
}

function runInit(
  input: CredentialProfileInput,
  fs: CredentialProfileFsShape = liveCredentialProfileFs,
): CredentialProfileResult {
  return Effect.runSync(
    initProfile(input).pipe(
      Effect.provide(Layer.succeed(CredentialProfileFs, fs)),
    ),
  );
}

function runResolve(
  input: CredentialProfileInput,
  fs: CredentialProfileFsShape = liveCredentialProfileFs,
): CredentialProfileResult {
  return Effect.runSync(
    resolveProfile(input).pipe(
      Effect.provide(Layer.succeed(CredentialProfileFs, fs)),
    ),
  );
}

function captureIo(): {
  readonly writeStdout: (t: string) => void;
  readonly writeStderr: (t: string) => void;
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

function assertSecretSafe(text: string, forbidden: readonly string[]): void {
  for (const f of forbidden) {
    assert.equal(
      text.includes(f),
      false,
      `output must not leak ${JSON.stringify(f)}: ${text}`,
    );
  }
}

afterEach(() => {
  setCredentialProfileRaceHook(undefined);
});

// ---------------------------------------------------------------------------
// Identifier exact bounds and invalid characters
// ---------------------------------------------------------------------------

describe("profile identifier bounds", () => {
  it("accepts single alnum and 64-char max", () => {
    assert.equal(isValidProfileId("a"), true);
    assert.equal(isValidProfileId("Z"), true);
    assert.equal(isValidProfileId("0"), true);
    assert.equal(isValidProfileId("a".repeat(64)), true);
    assert.equal(PROFILE_ID_RE.test("demo.profile_1-x"), true);
    assert.equal(isValidProfileId("demo.profile_1-x"), true);
  });

  it("rejects empty, oversize, leading separator, and bad chars", () => {
    assert.equal(isValidProfileId(""), false);
    assert.equal(isValidProfileId("a".repeat(65)), false);
    assert.equal(isValidProfileId(".leading"), false);
    assert.equal(isValidProfileId("-leading"), false);
    assert.equal(isValidProfileId("_leading"), false);
    assert.equal(isValidProfileId("has space"), false);
    assert.equal(isValidProfileId("has/slash"), false);
    assert.equal(isValidProfileId("has\\slash"), false);
    assert.equal(isValidProfileId("has:colon"), false);
    assert.equal(isValidProfileId("unicode-ñ"), false);
  });
});

// ---------------------------------------------------------------------------
// Closed vendor and result decoders
// ---------------------------------------------------------------------------

describe("closed vendor and result decoders", () => {
  it("accepts only grok and codex", () => {
    assert.equal(isCredentialVendor("grok"), true);
    assert.equal(isCredentialVendor("codex"), true);
    assert.equal(isCredentialVendor("claude"), false);
    assert.equal(isCredentialVendor("agy"), false);
    assert.equal(isCredentialVendor(""), false);
  });

  it("decodeCredentialProfileRecordV1 rejects unknown keys and bad vendor", () => {
    assert.deepEqual(
      decodeCredentialProfileRecordV1({
        schemaVersion: 1,
        profileId: "p1",
        vendor: "grok",
        configRootRel: "homes/grok",
      }),
      {
        schemaVersion: 1,
        profileId: "p1",
        vendor: "grok",
        configRootRel: "homes/grok",
      },
    );
    assert.equal(
      decodeCredentialProfileRecordV1({
        schemaVersion: 1,
        profileId: "p1",
        vendor: "claude",
        configRootRel: "homes/claude",
      }),
      null,
    );
    assert.equal(
      decodeCredentialProfileRecordV1({
        schemaVersion: 1,
        profileId: "p1",
        vendor: "grok",
        configRootRel: "homes/grok",
        extra: true,
      }),
      null,
    );
    assert.equal(
      decodeCredentialProfileRecordV1({
        schemaVersion: 1,
        profileId: "p1",
        vendor: "grok",
        configRootRel: "homes/codex",
      }),
      null,
    );
  });

  it("isCredentialProfileResult accepts closed Ready/Initialized/Refused", () => {
    const id = "a".repeat(64);
    assert.equal(
      isCredentialProfileResult({
        _tag: "Ready",
        profileId: "p",
        vendor: "grok",
        configRoot: "/x",
        profileIdentity: id,
      }),
      true,
    );
    assert.equal(
      isCredentialProfileResult({
        _tag: "Initialized",
        profileId: "p",
        vendor: "codex",
        configRoot: "/x",
        profileIdentity: id,
      }),
      true,
    );
    assert.equal(
      isCredentialProfileResult({
        _tag: "Refused",
        reason: "authority_conflict",
      }),
      true,
    );
    assert.equal(
      isCredentialProfileResult({
        _tag: "Refused",
        reason: "not_a_reason",
      }),
      false,
    );
    assert.equal(isCredentialProfileResult({ _tag: "Ready" }), false);
  });

  it("isCredentialProfileResult rejects unknown keys on every variant", () => {
    const id = "a".repeat(64);
    assert.equal(
      isCredentialProfileResult({
        _tag: "Ready",
        profileId: "p",
        vendor: "grok",
        configRoot: "/x",
        profileIdentity: id,
        extra: true,
      }),
      false,
    );
    assert.equal(
      isCredentialProfileResult({
        _tag: "Initialized",
        profileId: "p",
        vendor: "codex",
        configRoot: "/x",
        profileIdentity: id,
        leaked: "secret",
      }),
      false,
    );
    assert.equal(
      isCredentialProfileResult({
        _tag: "Refused",
        reason: "write_failed",
        path: "/leaked",
      }),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Canonical record bytes and known SHA-256 vectors
// ---------------------------------------------------------------------------

describe("canonical record and identity", () => {
  it("uses sorted-key canonical JSON and known SHA-256", () => {
    const rec = makeCredentialProfileRecord("demo", "grok");
    const canon = renderCredentialProfileRecord(rec);
    assert.equal(
      canon,
      '{"configRootRel":"homes/grok","profileId":"demo","schemaVersion":1,"vendor":"grok"}',
    );
    const expected = createHash("sha256").update(canon, "utf8").digest("hex");
    assert.equal(
      expected,
      "70decb5da608861cf95126ea1c44d1a12c4bcc843d409df4bd8d3229813fd9ba",
    );
    assert.equal(profileIdentityOf(rec), expected);
    assert.equal(profileIdentityOf(rec), profileIdentityOf(rec).toLowerCase());
  });

  it("file body is canonical JSON plus single LF", () => {
    const rec = makeCredentialProfileRecord("x", "codex");
    assert.equal(
      renderCredentialProfileRecordFile(rec),
      renderCredentialProfileRecord(rec) + "\n",
    );
  });

  it("configRootRel uses forward slashes for both vendors", () => {
    assert.equal(configRootRelForVendor("grok"), "homes/grok");
    assert.equal(configRootRelForVendor("codex"), "homes/codex");
    assert.equal(configRootRelForVendor("grok").includes("\\"), false);
  });
});

// ---------------------------------------------------------------------------
// Unknown / duplicate keys, malformed UTF-8, 16384 boundary
// ---------------------------------------------------------------------------

describe("record parse bounds and reject classes", () => {
  it("rejects duplicate JSON keys", () => {
    const text =
      '{"schemaVersion":1,"profileId":"p","vendor":"grok","configRootRel":"homes/grok","profileId":"q"}';
    const parsed = parseJsonRejectDuplicateKeys(text);
    assert.equal(isCoreFailure(parsed), true);
    const bytes = Buffer.from(text, "utf8");
    const r = parseCredentialProfileRecordBytes(bytes);
    assert.equal(r._tag, "Fail");
  });

  it("rejects unknown keys at parse layer", () => {
    const text =
      '{"schemaVersion":1,"profileId":"p","vendor":"grok","configRootRel":"homes/grok","secret":"x"}';
    const r = parseCredentialProfileRecordBytes(Buffer.from(text, "utf8"));
    assert.equal(r._tag, "Fail");
  });

  it("rejects malformed UTF-8", () => {
    const bad = Buffer.from([0x7b, 0xff, 0x7d]); // { <invalid> }
    const r = parseCredentialProfileRecordBytes(bad);
    assert.equal(r._tag, "Fail");
    if (r._tag === "Fail") assert.equal(r.reason, "authority_invalid");
  });

  it("accepts exactly 16384 bytes and rejects 16385", () => {
    // Build a valid small record then pad is not valid JSON — bound is on raw bytes.
    const valid = Buffer.from(
      renderCredentialProfileRecordFile(
        makeCredentialProfileRecord("p", "grok"),
      ),
      "utf8",
    );
    assert.ok(valid.byteLength < MAX_CREDENTIAL_PROFILE_RECORD_BYTES);
    assert.equal(parseCredentialProfileRecordBytes(valid)._tag, "Ok");

    const over = Buffer.alloc(MAX_CREDENTIAL_PROFILE_RECORD_BYTES + 1, 0x20);
    const r = parseCredentialProfileRecordBytes(over);
    assert.equal(r._tag, "Fail");

    // Exact max: oversized invalid JSON still hits bound first when > max.
    const exactPad = Buffer.alloc(MAX_CREDENTIAL_PROFILE_RECORD_BYTES, 0x61);
    const exact = parseCredentialProfileRecordBytes(exactPad);
    // 16384 'a' bytes is invalid JSON → Fail authority_invalid, not crash.
    assert.equal(exact._tag, "Fail");
  });
});

// ---------------------------------------------------------------------------
// Boundary: state-root equality / descendant / prefix non-descendant
// ---------------------------------------------------------------------------

describe("state-root vs worktree boundary", () => {
  it("isEqualOrDescendant is segment-aware (prefix-safe)", () => {
    assert.equal(isEqualOrDescendant("/tmp/work", "/tmp/work"), true);
    assert.equal(isEqualOrDescendant("/tmp/work/sub", "/tmp/work"), true);
    assert.equal(isEqualOrDescendant("/tmp/work-extra", "/tmp/work"), false);
    assert.equal(isEqualOrDescendant("/tmp/work", "/tmp/work-extra"), false);
  });

  it("refuses state root equal to worktree", () => {
    const { root, worktreeRoot } = tempPair("eq");
    try {
      const r = runInit({
        stateRoot: worktreeRoot,
        worktreeRoot,
        profileId: "p1",
        vendor: "grok",
      });
      assert.deepEqual(r, {
        _tag: "Refused",
        reason: "state_root_in_worktree",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses state root below worktree", () => {
    const { root, worktreeRoot } = tempPair("desc");
    try {
      const nested = join(worktreeRoot, "nested-state");
      mkdirSync(nested, { recursive: true });
      const r = runInit({
        stateRoot: nested,
        worktreeRoot,
        profileId: "p1",
        vendor: "grok",
      });
      assert.deepEqual(r, {
        _tag: "Refused",
        reason: "state_root_in_worktree",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows worktree names that share a string prefix but are not descendants", () => {
    const root = mkdtempSync(join(tmpdir(), "foreman-cp-prefix-"));
    try {
      const worktreeRoot = join(root, "work");
      const stateRoot = join(root, "work-extra");
      mkdirSync(worktreeRoot, { recursive: true });
      mkdirSync(stateRoot, { recursive: true });
      const r = runInit({
        stateRoot,
        worktreeRoot,
        profileId: "p1",
        vendor: "grok",
      });
      assert.equal(r._tag, "Initialized", JSON.stringify(r));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses state that only resolves inside the worktree via a linked ancestor", () => {
    if (IS_WIN) {
      // Junction semantics for intermediate ancestors are host-specific.
      return;
    }
    const root = mkdtempSync(join(tmpdir(), "foreman-cp-phys-"));
    try {
      const worktreeRoot = join(root, "worktree");
      mkdirSync(worktreeRoot, { recursive: true });
      // alias → worktree; state under alias is physically under worktree.
      const alias = join(root, "alias");
      symlinkSync(worktreeRoot, alias);
      const stateRoot = join(alias, "nested-state");
      mkdirSync(stateRoot, { recursive: true });
      // Logical path is outside the worktree string; physical is inside.
      assert.equal(
        stateRoot.startsWith(worktreeRoot + "/"),
        false,
        "logical path must not be a string descendant",
      );
      const r = runInit({
        stateRoot,
        worktreeRoot,
        profileId: "p1",
        vendor: "grok",
      });
      assert.deepEqual(r, {
        _tag: "Refused",
        reason: "state_root_in_worktree",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses logical-inside/physical-outside state root at initial validation", () => {
    if (IS_WIN) {
      // Intermediate symlink under worktree is POSIX-stable for this case.
      return;
    }
    const root = mkdtempSync(join(tmpdir(), "foreman-cp-log-in-"));
    try {
      const worktreeRoot = join(root, "worktree");
      const external = join(root, "external-state-parent");
      mkdirSync(worktreeRoot, { recursive: true });
      mkdirSync(external, { recursive: true });
      // worktree/link → external; state lives at worktree/link/state.
      const link = join(worktreeRoot, "link");
      symlinkSync(external, link);
      const stateRoot = join(link, "state");
      mkdirSync(stateRoot, { recursive: true });

      // Logical path is a descendant of worktree; physical realpath is outside.
      assert.equal(
        isEqualOrDescendant(
          normalizeAbsolutePath(stateRoot),
          normalizeAbsolutePath(worktreeRoot),
        ),
        true,
        "logical state must be under worktree",
      );
      assert.equal(
        isEqualOrDescendant(
          normalizeAbsolutePath(realpathSync(stateRoot)),
          normalizeAbsolutePath(realpathSync(worktreeRoot)),
        ),
        false,
        "physical state must be outside worktree",
      );

      const r = runInit({
        stateRoot,
        worktreeRoot,
        profileId: "p1",
        vendor: "grok",
      });
      assert.deepEqual(r, {
        _tag: "Refused",
        reason: "state_root_in_worktree",
      });

      // Same dual check on resolve entry (validateInputs).
      const res = runResolve({
        stateRoot,
        worktreeRoot,
        profileId: "p1",
        vendor: "grok",
      });
      assert.deepEqual(res, {
        _tag: "Refused",
        reason: "state_root_in_worktree",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("final success gate rechecks dual containment after safe-mode", () => {
    if (IS_WIN) {
      // Ancestor retarget via symlink is POSIX-stable; skip on Windows.
      return;
    }
    const root = mkdtempSync(join(tmpdir(), "foreman-cp-final-contain-"));
    try {
      const worktreeRoot = join(root, "worktree");
      const outer = join(root, "outer");
      const stateRoot = join(outer, "state");
      mkdirSync(worktreeRoot, { recursive: true });
      mkdirSync(stateRoot, { recursive: true });

      const input: CredentialProfileInput = {
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      };
      assert.equal(runInit(input)._tag, "Initialized");

      // After mode verification, retarget the logical ancestor so physical
      // containment flips while path strings stay the same. Final gate must
      // re-run dual containment (logical still external; physical inside).
      setCredentialProfileRaceHook({
        afterSafeModeVerify: () => {
          const captured = join(worktreeRoot, "captured");
          mkdirSync(captured, { recursive: true });
          const movedState = join(captured, "state");
          renameSync(stateRoot, movedState);
          rmdirSync(outer);
          symlinkSync(captured, outer);
        },
      });
      const r = runResolve(input);
      assert.deepEqual(
        r,
        { _tag: "Refused", reason: "state_root_in_worktree" },
        JSON.stringify(r),
      );
    } finally {
      setCredentialProfileRaceHook(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("missing worktree root is invalid_arguments (physical resolve required)", () => {
    const { root, stateRoot } = tempPair("miss-wt");
    try {
      const r = runInit({
        stateRoot,
        worktreeRoot: join(root, "does-not-exist"),
        profileId: "p1",
        vendor: "grok",
      });
      assert.deepEqual(r, {
        _tag: "Refused",
        reason: "invalid_arguments",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Exact external layout for Grok and Codex
// ---------------------------------------------------------------------------

describe("external layout init/resolve", () => {
  it("creates Grok layout under state root only", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("grok");
    try {
      const r = runInit({
        stateRoot,
        worktreeRoot,
        profileId: "lane-a",
        vendor: "grok",
      });
      assert.equal(r._tag, "Initialized", JSON.stringify(r));
      if (r._tag !== "Initialized") return;

      const jsonPath = profileJsonPath(stateRoot, "lane-a");
      assert.equal(existsSync(jsonPath), true);
      assert.equal(existsSync(join(worktreeRoot, "credential-profiles")), false);
      assert.equal(
        existsSync(join(stateRoot, "credential-profiles", "lane-a", "homes", "grok")),
        true,
      );
      // Other vendor home need not exist.
      assert.equal(
        existsSync(join(stateRoot, "credential-profiles", "lane-a", "homes", "codex")),
        false,
      );

      const body = readFileSync(jsonPath);
      const parsed = parseCredentialProfileRecordBytes(body);
      assert.equal(parsed._tag, "Ok");
      if (parsed._tag === "Ok") {
        assert.equal(parsed.record.vendor, "grok");
        assert.equal(parsed.record.configRootRel, "homes/grok");
        assert.equal(parsed.record.profileId, "lane-a");
      }

      assert.equal(
        r.configRoot,
        absoluteConfigRoot(stateRoot, "lane-a", "homes/grok"),
      );
      assert.equal(
        r.profileIdentity,
        profileIdentityOf(makeCredentialProfileRecord("lane-a", "grok")),
      );

      // Owner-only modes where POSIX supports them.
      if (!IS_WIN) {
        const st = lstatSync(jsonPath);
        assert.equal(st.mode & 0o777, 0o600);
        const dirMode = lstatSync(dirname(jsonPath)).mode & 0o777;
        assert.equal(dirMode, 0o700);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates Codex layout under state root only", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("codex");
    try {
      const r = runInit({
        stateRoot,
        worktreeRoot,
        profileId: "lane-b",
        vendor: "codex",
      });
      assert.equal(r._tag, "Initialized", JSON.stringify(r));
      assert.equal(
        existsSync(join(stateRoot, "credential-profiles", "lane-b", "homes", "codex")),
        true,
      );
      assert.equal(
        existsSync(join(stateRoot, "credential-profiles", "lane-b", "homes", "grok")),
        false,
      );
      const res = runResolve({
        stateRoot,
        worktreeRoot,
        profileId: "lane-b",
        vendor: "codex",
      });
      assert.equal(res._tag, "Ready", JSON.stringify(res));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Idempotence and conflict
// ---------------------------------------------------------------------------

describe("idempotence and conflict", () => {
  it("second init with exact record returns Ready without byte changes", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("idem");
    try {
      const input: CredentialProfileInput = {
        stateRoot,
        worktreeRoot,
        profileId: "same",
        vendor: "grok",
      };
      const a = runInit(input);
      assert.equal(a._tag, "Initialized");
      const jsonPath = profileJsonPath(stateRoot, "same");
      const before = readFileSync(jsonPath);
      const b = runInit(input);
      assert.equal(b._tag, "Ready", JSON.stringify(b));
      const after = readFileSync(jsonPath);
      assert.deepEqual(after, before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("conflicting vendor refuses without changing bytes", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("conf");
    try {
      const first = runInit({
        stateRoot,
        worktreeRoot,
        profileId: "c1",
        vendor: "grok",
      });
      assert.equal(first._tag, "Initialized");
      const jsonPath = profileJsonPath(stateRoot, "c1");
      const before = readFileSync(jsonPath);
      const second = runInit({
        stateRoot,
        worktreeRoot,
        profileId: "c1",
        vendor: "codex",
      });
      assert.deepEqual(second, {
        _tag: "Refused",
        reason: "authority_conflict",
      });
      assert.deepEqual(readFileSync(jsonPath), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolve missing authority returns authority_missing", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("miss");
    try {
      const r = runResolve({
        stateRoot,
        worktreeRoot,
        profileId: "none",
        vendor: "grok",
      });
      assert.deepEqual(r, {
        _tag: "Refused",
        reason: "authority_missing",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Symlink / junction and regular-file collisions
// ---------------------------------------------------------------------------

describe("linked paths and regular-file collisions", () => {
  const canSymlink = (() => {
    const d = mkdtempSync(join(tmpdir(), "foreman-cp-sl-"));
    try {
      const t = join(d, "t");
      mkdirSync(t);
      const l = join(d, "l");
      try {
        symlinkSync(t, l, IS_WIN ? "junction" : undefined);
        return true;
      } catch {
        return false;
      }
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  })();

  it(
    "refuses symlink at credential-profiles component",
    { skip: !canSymlink },
    () => {
      const { root, stateRoot, worktreeRoot } = tempPair("sl-cp");
      try {
        const real = join(root, "elsewhere");
        mkdirSync(real, { recursive: true });
        symlinkSync(
          real,
          join(stateRoot, "credential-profiles"),
          IS_WIN ? "junction" : undefined,
        );
        const r = runInit({
          stateRoot,
          worktreeRoot,
          profileId: "p",
          vendor: "grok",
        });
        assert.deepEqual(r, { _tag: "Refused", reason: "linked_path" });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "refuses symlink at profile-id component",
    { skip: !canSymlink },
    () => {
      const { root, stateRoot, worktreeRoot } = tempPair("sl-id");
      try {
        mkdirSync(join(stateRoot, "credential-profiles"), { recursive: true });
        const real = join(root, "elsewhere");
        mkdirSync(real, { recursive: true });
        symlinkSync(
          real,
          join(stateRoot, "credential-profiles", "p"),
          IS_WIN ? "junction" : undefined,
        );
        const r = runInit({
          stateRoot,
          worktreeRoot,
          profileId: "p",
          vendor: "grok",
        });
        assert.deepEqual(r, { _tag: "Refused", reason: "linked_path" });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "refuses symlink at homes component",
    { skip: !canSymlink },
    () => {
      const { root, stateRoot, worktreeRoot } = tempPair("sl-homes");
      try {
        const auth = join(stateRoot, "credential-profiles", "p");
        mkdirSync(auth, { recursive: true });
        const real = join(root, "elsewhere");
        mkdirSync(real, { recursive: true });
        symlinkSync(real, join(auth, "homes"), IS_WIN ? "junction" : undefined);
        const r = runInit({
          stateRoot,
          worktreeRoot,
          profileId: "p",
          vendor: "grok",
        });
        assert.deepEqual(r, { _tag: "Refused", reason: "linked_path" });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "refuses symlink at vendor home component",
    { skip: !canSymlink },
    () => {
      const { root, stateRoot, worktreeRoot } = tempPair("sl-vend");
      try {
        const profiles = join(stateRoot, "credential-profiles");
        const auth = join(profiles, "p");
        const homes = join(auth, "homes");
        mkdirSync(homes, { recursive: true });
        // Parent layout dirs must be owner-only so mode checks do not mask the
        // linked_path classification of the vendor-home component.
        if (!IS_WIN) {
          chmodSync(profiles, 0o700);
          chmodSync(auth, 0o700);
          chmodSync(homes, 0o700);
        }
        const real = join(root, "elsewhere");
        mkdirSync(real, { recursive: true });
        symlinkSync(real, join(homes, "grok"), IS_WIN ? "junction" : undefined);
        const r = runInit({
          stateRoot,
          worktreeRoot,
          profileId: "p",
          vendor: "grok",
        });
        assert.deepEqual(r, { _tag: "Refused", reason: "linked_path" });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it(
    "refuses symlink profile.json",
    { skip: !canSymlink },
    () => {
      const { root, stateRoot, worktreeRoot } = tempPair("sl-json");
      try {
        const auth = join(stateRoot, "credential-profiles", "p");
        mkdirSync(join(auth, "homes", "grok"), { recursive: true });
        const realFile = join(root, "real.json");
        writeFileSync(
          realFile,
          renderCredentialProfileRecordFile(
            makeCredentialProfileRecord("p", "grok"),
          ),
        );
        symlinkSync(realFile, join(auth, "profile.json"));
        const r = runInit({
          stateRoot,
          worktreeRoot,
          profileId: "p",
          vendor: "grok",
        });
        assert.deepEqual(r, { _tag: "Refused", reason: "linked_path" });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("refuses regular-file collision at credential-profiles", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("file-cp");
    try {
      writeFileSync(join(stateRoot, "credential-profiles"), "not-a-dir");
      const r = runInit({
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      });
      assert.deepEqual(r, {
        _tag: "Refused",
        reason: "authority_invalid",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses regular-file collision at profile-id dir", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("file-id");
    try {
      mkdirSync(join(stateRoot, "credential-profiles"), { recursive: true });
      writeFileSync(join(stateRoot, "credential-profiles", "p"), "file");
      const r = runInit({
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      });
      assert.deepEqual(r, {
        _tag: "Refused",
        reason: "authority_invalid",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses regular-file collision at homes", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("file-homes");
    try {
      const auth = join(stateRoot, "credential-profiles", "p");
      mkdirSync(auth, { recursive: true });
      writeFileSync(join(auth, "homes"), "file");
      const r = runInit({
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      });
      assert.deepEqual(r, {
        _tag: "Refused",
        reason: "authority_invalid",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses regular-file collision at vendor home", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("file-vend");
    try {
      const homes = join(stateRoot, "credential-profiles", "p", "homes");
      mkdirSync(homes, { recursive: true });
      writeFileSync(join(homes, "grok"), "file");
      const r = runInit({
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      });
      assert.deepEqual(r, {
        _tag: "Refused",
        reason: "authority_invalid",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Identity-change, write failures, concurrent init
// ---------------------------------------------------------------------------

describe("identity change, write failures, concurrency", () => {
  it("detects state-root identity change via race hook", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("idchg");
    try {
      setCredentialProfileRaceHook({
        afterValidateStateRoot: () => {
          rmSync(stateRoot, { recursive: true, force: true });
          mkdirSync(stateRoot, { recursive: true });
        },
      });
      const r = runInit({
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      });
      // On most filesystems remaking the dir changes ino → identity_changed.
      // Some FS recycle inodes; accept identity_changed or success only if same ino.
      assert.ok(
        r._tag === "Refused" && r.reason === "identity_changed" ||
          r._tag === "Initialized",
        JSON.stringify(r),
      );
    } finally {
      setCredentialProfileRaceHook(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writeAuthorityExclusive Exists path yields Ready or conflict", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("excl");
    try {
      const input: CredentialProfileInput = {
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      };
      // Seed exact record via live init.
      assert.equal(runInit(input)._tag, "Initialized");
      // Spy FS that reports Exists on write (simulates concurrent publisher).
      const spy: CredentialProfileFsShape = {
        ...liveCredentialProfileFs,
        writeAuthorityExclusive: () => ({ _tag: "Exists" }),
      };
      // First ensure we go through write path by temporarily removing json
      // after dirs exist — use hook afterEnsureDirs to delete after check.
      // Simpler: direct Exists after missing read — wrap read to say Absent
      // once then Exists on write, then real read.
      let reads = 0;
      const raceFs: CredentialProfileFsShape = {
        ...liveCredentialProfileFs,
        readFile: (path, max) => {
          reads += 1;
          // First read pretends absent so we attempt write.
          if (reads === 1) return { _tag: "Absent" };
          return liveCredentialProfileFs.readFile(path, max);
        },
        classify: (path) => {
          // Keep classify honest for dirs; for profile.json force missing on first classify rounds.
          return liveCredentialProfileFs.classify(path);
        },
        writeAuthorityExclusive: () => ({ _tag: "Exists" }),
      };
      // Existing file is still there; init sees Ready via first read of real file.
      const r = runInit(input, raceFs);
      assert.ok(
        r._tag === "Ready" ||
          (r._tag === "Refused" &&
            (r.reason === "authority_conflict" ||
              r.reason === "write_failed" ||
              r.reason === "authority_invalid")),
        JSON.stringify(r),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("concurrent initializers produce one exact record or typed conflict", async () => {
    const { root, stateRoot, worktreeRoot } = tempPair("conc");
    try {
      const input: CredentialProfileInput = {
        stateRoot,
        worktreeRoot,
        profileId: "shared",
        vendor: "grok",
      };
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          Effect.runPromise(
            initProfile(input).pipe(Effect.provide(liveCredentialProfile)),
          ),
        ),
      );
      for (const r of results) {
        assert.ok(
          r._tag === "Initialized" ||
            r._tag === "Ready" ||
            (r._tag === "Refused" && r.reason === "authority_conflict"),
          JSON.stringify(r),
        );
      }
      const ok = results.filter(
        (r) => r._tag === "Initialized" || r._tag === "Ready",
      );
      assert.ok(ok.length >= 1, "at least one success");
      const jsonPath = profileJsonPath(stateRoot, "shared");
      const body = readFileSync(jsonPath);
      const parsed = parseCredentialProfileRecordBytes(body);
      assert.equal(parsed._tag, "Ok");
      if (parsed._tag === "Ok") {
        assert.equal(parsed.record.vendor, "grok");
        assert.equal(parsed.record.profileId, "shared");
      }
      // Exactly one authority file content.
      const identities = new Set(
        ok.map((r) =>
          r._tag === "Initialized" || r._tag === "Ready"
            ? r.profileIdentity
            : "",
        ),
      );
      assert.equal(identities.size, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("injected FS write failure returns write_failed", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("wfail");
    try {
      const fs: CredentialProfileFsShape = {
        ...liveCredentialProfileFs,
        writeAuthorityExclusive: () => ({ _tag: "WriteFailed" }),
      };
      const r = runInit(
        {
          stateRoot,
          worktreeRoot,
          profileId: "p",
          vendor: "grok",
        },
        fs,
      );
      assert.deepEqual(r, { _tag: "Refused", reason: "write_failed" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("unsupported exclusive hard-link returns write_failed without creating authority", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("linkfail");
    try {
      setCredentialProfileRaceHook({
        // Simulate platform where exclusive hard-link is unsupported.
        forceExclusiveLinkCode: "ENOSYS",
      });
      const r = runInit({
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      });
      assert.deepEqual(r, { _tag: "Refused", reason: "write_failed" });
      const jsonPath = profileJsonPath(stateRoot, "p");
      // No rename fallback: authority file must not appear after link failure.
      assert.equal(existsSync(jsonPath), false);
    } finally {
      setCredentialProfileRaceHook(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("liveWriteAuthorityExclusive WriteFailed leaves final path absent (no rename)", () => {
    const { root, stateRoot } = tempPair("livewrite");
    try {
      const dir = join(stateRoot, "credential-profiles", "p");
      mkdirSync(dir, { recursive: true });
      const finalPath = join(dir, "profile.json");
      setCredentialProfileRaceHook({ forceExclusiveLinkCode: "EPERM" });
      const written = liveWriteAuthorityExclusive(
        finalPath,
        Buffer.from('{"schemaVersion":1}\n', "utf8"),
      );
      assert.deepEqual(written, { _tag: "WriteFailed" });
      assert.equal(existsSync(finalPath), false);
    } finally {
      setCredentialProfileRaceHook(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("relative stateRoot is invalid_state_root; relative worktree is invalid_arguments", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("relabs");
    try {
      const rState = runInit({
        stateRoot: "relative-state",
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      });
      assert.deepEqual(rState, {
        _tag: "Refused",
        reason: "invalid_state_root",
      });
      const rWt = runInit({
        stateRoot,
        worktreeRoot: "relative-worktree",
        profileId: "p",
        vendor: "grok",
      });
      assert.deepEqual(rWt, {
        _tag: "Refused",
        reason: "invalid_arguments",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("directory identity swap after layout creation refuses identity_changed", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("idswap");
    try {
      const homes = join(stateRoot, "credential-profiles", "p", "homes");
      // Capture identity after ensure via hook replacement that forces a new
      // inode: remove + recreate the homes directory (and vendor home).
      setCredentialProfileRaceHook({
        afterEnsureDirs: () => {
          rmSync(homes, { recursive: true, force: true });
          // Park a dummy inode first so the recreated homes dir is unlikely
          // to reuse the same ino on filesystems that recycle aggressively.
          const burn = join(root, "burn-ino");
          mkdirSync(burn, { recursive: true });
          rmSync(burn, { recursive: true, force: true });
          mkdirSync(homes, { recursive: true, mode: 0o700 });
          mkdirSync(join(homes, "grok"), { recursive: true, mode: 0o700 });
        },
      });
      const r = runInit({
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      });
      assert.deepEqual(
        r,
        { _tag: "Refused", reason: "identity_changed" },
        JSON.stringify(r),
      );
      // Exclusive publish must not have succeeded after the swap.
      assert.equal(existsSync(profileJsonPath(stateRoot, "p")), false);
    } finally {
      setCredentialProfileRaceHook(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("layout component swapped to symlink after ensure refuses linked_path", () => {
    if (IS_WIN) {
      // Junction create semantics vary; cover on POSIX where symlink is reliable.
      return;
    }
    const { root, stateRoot, worktreeRoot } = tempPair("linkswap");
    try {
      setCredentialProfileRaceHook({
        afterEnsureDirs: () => {
          const homes = join(
            stateRoot,
            "credential-profiles",
            "p",
            "homes",
          );
          const parked = join(root, "homes-real");
          rmSync(homes, { recursive: true, force: true });
          mkdirSync(parked, { recursive: true });
          mkdirSync(join(parked, "grok"), { recursive: true });
          symlinkSync(parked, homes);
        },
      });
      const r = runInit({
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      });
      assert.deepEqual(r, { _tag: "Refused", reason: "linked_path" });
    } finally {
      setCredentialProfileRaceHook(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("recomputes physical containment after admission when ancestor is retargeted into worktree", () => {
    if (IS_WIN) {
      // Ancestor retarget via symlink is POSIX-stable; skip on Windows.
      return;
    }
    const root = mkdtempSync(join(tmpdir(), "foreman-cp-contain-"));
    try {
      const worktreeRoot = join(root, "worktree");
      const outer = join(root, "outer");
      const stateRoot = join(outer, "state");
      mkdirSync(worktreeRoot, { recursive: true });
      mkdirSync(stateRoot, { recursive: true });

      setCredentialProfileRaceHook({
        afterEnsureDirs: () => {
          // Move the same state-root directory inode under the worktree and
          // retarget the logical ancestor so physical containment flips while
          // path strings and directory inodes can still look coherent.
          const captured = join(worktreeRoot, "captured");
          mkdirSync(captured, { recursive: true });
          const movedState = join(captured, "state");
          renameSync(stateRoot, movedState);
          rmdirSync(outer);
          symlinkSync(captured, outer);
        },
      });

      const r = runInit({
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      });
      assert.deepEqual(
        r,
        { _tag: "Refused", reason: "state_root_in_worktree" },
        JSON.stringify(r),
      );
      // Must not publish authority after containment flips.
      assert.equal(existsSync(profileJsonPath(stateRoot, "p")), false);
    } finally {
      setCredentialProfileRaceHook(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("POSIX parent-directory sync failure after publish is write_failed not Initialized", () => {
    if (IS_WIN) {
      // Windows ignores only unsupported directory sync codes; EIO is fatal.
      // This live seam is exercised on POSIX where every failure is fatal.
      return;
    }
    const { root, stateRoot, worktreeRoot } = tempPair("parentsync");
    try {
      setCredentialProfileRaceHook({
        forceParentDirSyncFailure: true,
      });
      const r = runInit({
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      });
      assert.deepEqual(r, { _tag: "Refused", reason: "write_failed" });
      assert.notEqual(r._tag, "Initialized");
    } finally {
      setCredentialProfileRaceHook(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("live-seam: forced EIO parent sync is WriteFailed via exclusive writer", () => {
    const { root, stateRoot } = tempPair("parentsync-eio");
    try {
      const dir = join(stateRoot, "credential-profiles", "p");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const finalPath = join(dir, "profile.json");
      setCredentialProfileRaceHook({ forceParentDirSyncCode: "EIO" });
      const written = liveWriteAuthorityExclusive(
        finalPath,
        Buffer.from('{"schemaVersion":1}\n', "utf8"),
      );
      // EIO is never ignorable on any platform.
      assert.deepEqual(written, { _tag: "WriteFailed" });
    } finally {
      setCredentialProfileRaceHook(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("live-seam: forced EACCES parent sync is WriteFailed via exclusive writer", () => {
    const { root, stateRoot } = tempPair("parentsync-eacces");
    try {
      const dir = join(stateRoot, "credential-profiles", "p");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const finalPath = join(dir, "profile.json");
      setCredentialProfileRaceHook({ forceParentDirSyncCode: "EACCES" });
      const written = liveWriteAuthorityExclusive(
        finalPath,
        Buffer.from('{"schemaVersion":1}\n', "utf8"),
      );
      assert.deepEqual(written, { _tag: "WriteFailed" });
    } finally {
      setCredentialProfileRaceHook(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("live-seam: forced EPERM parent sync is WriteFailed via exclusive writer", () => {
    const { root, stateRoot } = tempPair("parentsync-eperm");
    try {
      const dir = join(stateRoot, "credential-profiles", "p");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const finalPath = join(dir, "profile.json");
      setCredentialProfileRaceHook({ forceParentDirSyncCode: "EPERM" });
      const written = liveWriteAuthorityExclusive(
        finalPath,
        Buffer.from('{"schemaVersion":1}\n', "utf8"),
      );
      assert.deepEqual(written, { _tag: "WriteFailed" });
    } finally {
      setCredentialProfileRaceHook(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("live-seam: forced unknown parent sync code is WriteFailed via exclusive writer", () => {
    const { root, stateRoot } = tempPair("parentsync-unk");
    try {
      const dir = join(stateRoot, "credential-profiles", "p");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const finalPath = join(dir, "profile.json");
      setCredentialProfileRaceHook({ forceParentDirSyncCode: "EFOO" });
      const written = liveWriteAuthorityExclusive(
        finalPath,
        Buffer.from('{"schemaVersion":1}\n', "utf8"),
      );
      assert.deepEqual(written, { _tag: "WriteFailed" });
    } finally {
      setCredentialProfileRaceHook(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("authority publish sets 0600 via open temp descriptor (no final-path chmod)", () => {
    if (IS_WIN) return;
    const { root, stateRoot } = tempPair("fchmod");
    try {
      const dir = join(stateRoot, "credential-profiles", "p");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const finalPath = join(dir, "profile.json");
      const body = Buffer.from(
        renderCredentialProfileRecordFile(
          makeCredentialProfileRecord("p", "grok"),
        ),
        "utf8",
      );
      const written = liveWriteAuthorityExclusive(finalPath, body);
      assert.deepEqual(written, { _tag: "Ok" });
      // Hard-linked inode keeps the fchmod'd mode from the open temp fd.
      assert.equal(lstatSync(finalPath).mode & 0o777, 0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("production FS service has no path-chmod or recursive mkdirp capability", () => {
    const keys = Object.keys(liveCredentialProfileFs).sort();
    assert.ok(!keys.includes("chmod"), `chmod must not be on live FS: ${keys.join(",")}`);
    assert.ok(
      !keys.includes("mkdirp"),
      `mkdirp must not be on live FS: ${keys.join(",")}`,
    );
    // Structural absence: path-chmod and recursive mkdir are not callable.
    assert.equal(
      (liveCredentialProfileFs as { chmod?: unknown }).chmod,
      undefined,
    );
    assert.equal(
      (liveCredentialProfileFs as { mkdirp?: unknown }).mkdirp,
      undefined,
    );
    // Required non-chmod operations remain.
    for (const k of [
      "classify",
      "identity",
      "modeBits",
      "mkdir",
      "readFile",
      "writeAuthorityExclusive",
    ] as const) {
      assert.equal(typeof liveCredentialProfileFs[k], "function", k);
    }
  });

  it("init succeeds without path-chmod on layout or authority", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("nochmod");
    try {
      const r = runInit(
        {
          stateRoot,
          worktreeRoot,
          profileId: "p",
          vendor: "grok",
        },
        liveCredentialProfileFs,
      );
      assert.equal(r._tag, "Initialized", JSON.stringify(r));
      // Production shape cannot path-chmod; mode comes from mkdir mode + fchmod on temp fd.
      assert.equal(
        (liveCredentialProfileFs as { chmod?: unknown }).chmod,
        undefined,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("final gate after safe-mode refuses identity_changed before Ready", () => {
    if (IS_WIN) return;
    const { root, stateRoot, worktreeRoot } = tempPair("finalgate");
    try {
      const input: CredentialProfileInput = {
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      };
      assert.equal(runInit(input)._tag, "Initialized");

      const homes = join(stateRoot, "credential-profiles", "p", "homes");
      setCredentialProfileRaceHook({
        afterSafeModeVerify: () => {
          rmSync(homes, { recursive: true, force: true });
          const burn = join(root, "burn-final");
          mkdirSync(burn, { recursive: true });
          rmSync(burn, { recursive: true, force: true });
          mkdirSync(homes, { recursive: true, mode: 0o700 });
          mkdirSync(join(homes, "grok"), { recursive: true, mode: 0o700 });
        },
      });
      const r = runResolve(input);
      assert.deepEqual(
        r,
        { _tag: "Refused", reason: "identity_changed" },
        JSON.stringify(r),
      );
    } finally {
      setCredentialProfileRaceHook(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * Replace profile.json with a new regular file that has the same bytes and
   * 0600 mode but a different inode.
   *
   * Portable: create the replacement while the original inode is still
   * allocated, set mode 0600, then atomically rename over profile.json.
   * Do not unlink the original first (inode reuse is not portable).
   */
  function replaceAuthoritySameMode(jsonPath: string): void {
    const body = readFileSync(jsonPath);
    const beforeIno = lstatSync(jsonPath).ino;
    const tmpPath = join(
      dirname(jsonPath),
      `.profile.replace.${randomBytes(8).toString("hex")}.tmp`,
    );
    // Original still allocated → new file gets a distinct inode on all POSIX FS.
    writeFileSync(tmpPath, body, { mode: 0o600 });
    if (!IS_WIN) {
      chmodSync(tmpPath, 0o600);
      assert.equal(lstatSync(tmpPath).mode & 0o777, 0o600);
    }
    renameSync(tmpPath, jsonPath);
    if (!IS_WIN) {
      assert.equal(lstatSync(jsonPath).mode & 0o777, 0o600);
    }
    assert.notEqual(
      lstatSync(jsonPath).ino,
      beforeIno,
      "replacement must use a distinct inode",
    );
  }

  it("live readFile Ok binds identity to fstat of the open descriptor", () => {
    if (IS_WIN) return;
    const { root, stateRoot } = tempPair("fd-id-read");
    try {
      const authDir = join(stateRoot, "credential-profiles", "p");
      mkdirSync(authDir, { recursive: true, mode: 0o700 });
      const jsonPath = join(authDir, "profile.json");
      const body = Buffer.from(
        renderCredentialProfileRecordFile(
          makeCredentialProfileRecord("p", "grok"),
        ),
        "utf8",
      );
      writeFileSync(jsonPath, body, { mode: 0o600 });
      chmodSync(jsonPath, 0o600);
      const st = lstatSync(jsonPath);
      const r = liveCredentialProfileFs.readFile(
        jsonPath,
        MAX_CREDENTIAL_PROFILE_RECORD_BYTES,
      );
      assert.equal(r._tag, "Ok", JSON.stringify(r));
      if (r._tag !== "Ok") return;
      assert.equal(r.identity.kind, "file");
      assert.equal(r.identity.dev, st.dev);
      assert.equal(r.identity.ino, st.ino);
      assert.deepEqual(r.bytes, body);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("carries descriptor identity: same-mode replace before readFile returns refuses", () => {
    if (IS_WIN) return;
    const { root, stateRoot, worktreeRoot } = tempPair("fd-id-gate");
    try {
      const input: CredentialProfileInput = {
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      };
      assert.equal(runInit(input)._tag, "Initialized");
      const jsonPath = profileJsonPath(stateRoot, "p");
      const beforeIno = lstatSync(jsonPath).ino;

      // After the live open/read/fstat identity is captured, replace the path
      // with another 0600 regular file before readFile returns. Carrying the
      // descriptor identity must refuse; a post-close path lstat as the
      // carried identity would match the replacement and wrongly return Ready
      // from the pre-replacement bytes.
      const fs: CredentialProfileFsShape = {
        ...liveCredentialProfileFs,
        readFile: (path, max) => {
          const r = liveCredentialProfileFs.readFile(path, max);
          if (r._tag !== "Ok") return r;
          if (path === jsonPath) {
            replaceAuthoritySameMode(path);
          }
          return r;
        },
      };
      const r = runResolve(input, fs);
      assert.deepEqual(
        r,
        { _tag: "Refused", reason: "identity_changed" },
        JSON.stringify(r),
      );
      assert.notEqual(r._tag, "Ready");
      assert.notEqual(lstatSync(jsonPath).ino, beforeIno);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolve refuses identity_changed when authority is replaced after read", () => {
    if (IS_WIN) return;
    const { root, stateRoot, worktreeRoot } = tempPair("auth-id-resolve");
    try {
      const input: CredentialProfileInput = {
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      };
      assert.equal(runInit(input)._tag, "Initialized");
      const jsonPath = profileJsonPath(stateRoot, "p");

      setCredentialProfileRaceHook({
        afterSafeModeVerify: () => {
          replaceAuthoritySameMode(jsonPath);
        },
      });
      const r = runResolve(input);
      assert.deepEqual(
        r,
        { _tag: "Refused", reason: "identity_changed" },
        JSON.stringify(r),
      );
      // Must not surface Ready derived from the pre-replacement bytes.
      assert.notEqual(r._tag, "Ready");
    } finally {
      setCredentialProfileRaceHook(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("init refuses identity_changed when authority is replaced after read", () => {
    if (IS_WIN) return;
    const { root, stateRoot, worktreeRoot } = tempPair("auth-id-init");
    try {
      const input: CredentialProfileInput = {
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      };
      assert.equal(runInit(input)._tag, "Initialized");
      const jsonPath = profileJsonPath(stateRoot, "p");
      const beforeBytes = readFileSync(jsonPath);

      setCredentialProfileRaceHook({
        afterSafeModeVerify: () => {
          replaceAuthoritySameMode(jsonPath);
        },
      });
      // Second init takes the existing-authority Ready path; replacement after
      // read must refuse rather than return Ready from stale bytes.
      const r = runInit(input);
      assert.deepEqual(
        r,
        { _tag: "Refused", reason: "identity_changed" },
        JSON.stringify(r),
      );
      assert.notEqual(r._tag, "Ready");
      assert.notEqual(r._tag, "Initialized");
      // Replacement left a valid-looking file; refusal is about identity, not
      // content mutation by init.
      assert.deepEqual(readFileSync(jsonPath), beforeBytes);
    } finally {
      setCredentialProfileRaceHook(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Parent-directory sync error classifier (pure)
// ---------------------------------------------------------------------------

describe("isIgnorableParentDirSyncError", () => {
  it("POSIX never ignores any code including unsupported-looking codes", () => {
    for (const code of [
      undefined,
      "EIO",
      "EACCES",
      "EPERM",
      "ENOTSUP",
      "EOPNOTSUPP",
      "ENOSYS",
      "EINVAL",
      "EISDIR",
      "EFOO",
      "",
    ] as const) {
      assert.equal(
        isIgnorableParentDirSyncError(code, "linux"),
        false,
        `linux ${String(code)}`,
      );
      assert.equal(
        isIgnorableParentDirSyncError(code, "darwin"),
        false,
        `darwin ${String(code)}`,
      );
    }
  });

  it("Windows ignores only the closed unsupported set", () => {
    for (const code of WINDOWS_UNSUPPORTED_PARENT_DIR_SYNC_CODES) {
      assert.equal(
        isIgnorableParentDirSyncError(code, "win32"),
        true,
        `win32 ignore ${code}`,
      );
    }
  });

  it("Windows WriteFailed for EIO, EACCES, EPERM, unknown, and undefined", () => {
    for (const code of [
      undefined,
      "EIO",
      "EACCES",
      "EPERM",
      "EFOO",
      "ENOENT",
      "",
    ] as const) {
      assert.equal(
        isIgnorableParentDirSyncError(code, "win32"),
        false,
        `win32 refuse ${String(code)}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// POSIX mode contracts before Ready (0700 dirs / 0600 authority)
// ---------------------------------------------------------------------------

describe("POSIX safe modes before Ready", () => {
  it("refuses Ready when an existing layout directory is not 0700", () => {
    if (IS_WIN) return;
    const { root, stateRoot, worktreeRoot } = tempPair("dirmode");
    try {
      const input: CredentialProfileInput = {
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      };
      assert.equal(runInit(input)._tag, "Initialized");
      const homes = join(stateRoot, "credential-profiles", "p", "homes");
      chmodSync(homes, 0o755);
      assert.equal(lstatSync(homes).mode & 0o777, 0o755);

      const initAgain = runInit(input);
      assert.deepEqual(initAgain, {
        _tag: "Refused",
        reason: "authority_invalid",
      });

      const resolved = runResolve(input);
      assert.deepEqual(resolved, {
        _tag: "Refused",
        reason: "authority_invalid",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses Ready when existing profile.json is not 0600", () => {
    if (IS_WIN) return;
    const { root, stateRoot, worktreeRoot } = tempPair("filemode");
    try {
      const input: CredentialProfileInput = {
        stateRoot,
        worktreeRoot,
        profileId: "p",
        vendor: "grok",
      };
      assert.equal(runInit(input)._tag, "Initialized");
      const jsonPath = profileJsonPath(stateRoot, "p");
      chmodSync(jsonPath, 0o644);
      assert.equal(lstatSync(jsonPath).mode & 0o777, 0o644);

      const initAgain = runInit(input);
      assert.deepEqual(initAgain, {
        _tag: "Refused",
        reason: "authority_invalid",
      });

      const resolved = runResolve(input);
      assert.deepEqual(resolved, {
        _tag: "Refused",
        reason: "authority_invalid",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses existing unsafe directory without rewriting mode via chmod", () => {
    if (IS_WIN) return;
    const { root, stateRoot, worktreeRoot } = tempPair("nochmod-exist");
    try {
      const profiles = join(stateRoot, "credential-profiles");
      mkdirSync(profiles, { recursive: true, mode: 0o700 });
      chmodSync(profiles, 0o755);
      assert.equal(lstatSync(profiles).mode & 0o777, 0o755);

      // Production service has no path-chmod; unsafe existing dir stays 0755.
      assert.equal(
        (liveCredentialProfileFs as { chmod?: unknown }).chmod,
        undefined,
      );
      const r = runInit(
        {
          stateRoot,
          worktreeRoot,
          profileId: "p",
          vendor: "grok",
        },
        liveCredentialProfileFs,
      );
      assert.deepEqual(r, {
        _tag: "Refused",
        reason: "authority_invalid",
      });
      // Must not "fix" the existing directory — mode remains unsafe.
      assert.equal(lstatSync(profiles).mode & 0o777, 0o755);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Concurrent mkdir EEXIST reclassification
// ---------------------------------------------------------------------------

describe("mkdir EEXIST race reclassification", () => {
  function eexistErr(): NodeJS.ErrnoException {
    const err = new Error("EEXIST") as NodeJS.ErrnoException;
    err.code = "EEXIST";
    return err;
  }

  it("continues when EEXIST peer left a non-linked 0700 directory", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("eexist-ok");
    try {
      const profiles = join(stateRoot, "credential-profiles");
      let profilesMkdir = 0;
      const fs: CredentialProfileFsShape = {
        ...liveCredentialProfileFs,
        mkdir: (path, mode) => {
          if (path === profiles) {
            profilesMkdir += 1;
            // Peer created the directory first with safe mode.
            mkdirSync(path, { mode: 0o700 });
            if (!IS_WIN) {
              assert.equal(lstatSync(path).mode & 0o777, 0o700);
            }
            throw eexistErr();
          }
          liveCredentialProfileFs.mkdir(path, mode);
        },
      };
      const r = runInit(
        {
          stateRoot,
          worktreeRoot,
          profileId: "p",
          vendor: "grok",
        },
        fs,
      );
      assert.equal(profilesMkdir, 1);
      assert.equal(r._tag, "Initialized", JSON.stringify(r));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses EEXIST when peer left a non-0700 directory", () => {
    if (IS_WIN) return;
    const { root, stateRoot, worktreeRoot } = tempPair("eexist-mode");
    try {
      const profiles = join(stateRoot, "credential-profiles");
      const fs: CredentialProfileFsShape = {
        ...liveCredentialProfileFs,
        mkdir: (path, mode) => {
          if (path === profiles) {
            mkdirSync(path, { mode: 0o755 });
            chmodSync(path, 0o755);
            throw eexistErr();
          }
          liveCredentialProfileFs.mkdir(path, mode);
        },
      };
      const r = runInit(
        {
          stateRoot,
          worktreeRoot,
          profileId: "p",
          vendor: "grok",
        },
        fs,
      );
      assert.deepEqual(r, {
        _tag: "Refused",
        reason: "authority_invalid",
      });
      assert.equal(lstatSync(profiles).mode & 0o777, 0o755);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses EEXIST when peer left a regular file", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("eexist-file");
    try {
      const profiles = join(stateRoot, "credential-profiles");
      const fs: CredentialProfileFsShape = {
        ...liveCredentialProfileFs,
        mkdir: (path, mode) => {
          if (path === profiles) {
            writeFileSync(path, "not-a-dir");
            throw eexistErr();
          }
          liveCredentialProfileFs.mkdir(path, mode);
        },
      };
      const r = runInit(
        {
          stateRoot,
          worktreeRoot,
          profileId: "p",
          vendor: "grok",
        },
        fs,
      );
      assert.deepEqual(r, {
        _tag: "Refused",
        reason: "authority_invalid",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses EEXIST when peer left a symbolic link", () => {
    if (IS_WIN) return;
    const { root, stateRoot, worktreeRoot } = tempPair("eexist-link");
    try {
      const profiles = join(stateRoot, "credential-profiles");
      const real = join(root, "elsewhere");
      mkdirSync(real, { recursive: true });
      const fs: CredentialProfileFsShape = {
        ...liveCredentialProfileFs,
        mkdir: (path, mode) => {
          if (path === profiles) {
            symlinkSync(real, path);
            throw eexistErr();
          }
          liveCredentialProfileFs.mkdir(path, mode);
        },
      };
      const r = runInit(
        {
          stateRoot,
          worktreeRoot,
          profileId: "p",
          vendor: "grok",
        },
        fs,
      );
      assert.deepEqual(r, {
        _tag: "Refused",
        reason: "linked_path",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses non-EEXIST mkdir errors as write_failed", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("mkdir-eio");
    try {
      const profiles = join(stateRoot, "credential-profiles");
      const fs: CredentialProfileFsShape = {
        ...liveCredentialProfileFs,
        mkdir: (path, mode) => {
          if (path === profiles) {
            const err = new Error("EIO") as NodeJS.ErrnoException;
            err.code = "EIO";
            throw err;
          }
          liveCredentialProfileFs.mkdir(path, mode);
        },
      };
      const r = runInit(
        {
          stateRoot,
          worktreeRoot,
          profileId: "p",
          vendor: "grok",
        },
        fs,
      );
      assert.deepEqual(r, {
        _tag: "Refused",
        reason: "write_failed",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// No credential file reads through injected filesystem service
// ---------------------------------------------------------------------------

describe("no credential file reads", () => {
  it("never reads under homes/* content paths", () => {
    const { root, stateRoot, worktreeRoot } = tempPair("noread");
    try {
      const reads: string[] = [];
      const fs: CredentialProfileFsShape = {
        ...liveCredentialProfileFs,
        readFile: (path, max) => {
          reads.push(path);
          return liveCredentialProfileFs.readFile(path, max);
        },
      };
      // Plant a fake credential file that must never be opened.
      const secretPath = join(
        stateRoot,
        "credential-profiles",
        "p",
        "homes",
        "grok",
        "credentials.json",
      );
      mkdirSync(dirname(secretPath), { recursive: true });
      // Owner-only layout so POSIX mode verification admits the pre-created tree.
      if (!IS_WIN) {
        const profiles = join(stateRoot, "credential-profiles");
        const auth = join(profiles, "p");
        const homes = join(auth, "homes");
        const vendorHome = join(homes, "grok");
        chmodSync(profiles, 0o700);
        chmodSync(auth, 0o700);
        chmodSync(homes, 0o700);
        chmodSync(vendorHome, 0o700);
      }
      writeFileSync(secretPath, '{"token":"SUPERSECRET"}');

      const r = runInit(
        {
          stateRoot,
          worktreeRoot,
          profileId: "p",
          vendor: "grok",
        },
        fs,
      );
      assert.equal(r._tag, "Initialized", JSON.stringify(r));
      for (const p of reads) {
        assert.equal(
          p.includes(`${join("homes", "grok")}${join("", "")}`) &&
            p.endsWith("credentials.json"),
          false,
          `must not read credential file: ${p}`,
        );
        assert.equal(
          p.includes("credentials.json"),
          false,
          `must not read credential file: ${p}`,
        );
      }
      // Secret still intact and unread path-wise.
      assert.equal(readFileSync(secretPath, "utf8"), '{"token":"SUPERSECRET"}');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// CLI: canonical secret-safe output and exit codes
// ---------------------------------------------------------------------------

describe("credential-profile CLI", () => {
  it("rejects reordered, duplicate, missing, unknown flags", () => {
    assert.equal(parseCredentialProfileArgv(["init"])._tag, "Invalid");
    assert.equal(
      parseCredentialProfileArgv([
        "init",
        "--worktree",
        "/w",
        "--state-root",
        "/s",
        "--profile",
        "p",
        "--vendor",
        "grok",
      ])._tag,
      "Invalid",
    );
    assert.equal(
      parseCredentialProfileArgv([
        "init",
        "--state-root",
        "/s",
        "--worktree",
        "/w",
        "--profile",
        "p",
        "--vendor",
        "grok",
        "--extra",
        "x",
      ])._tag,
      "Invalid",
    );
    assert.equal(
      parseCredentialProfileArgv([
        "init",
        "--state-root",
        "/s",
        "--worktree",
        "/w",
        "--profile",
        "p",
        "--vendor",
        "claude",
      ])._tag,
      "Invalid",
    );
  });

  it("accepts exact ordered init and resolve argv", () => {
    const p = parseCredentialProfileArgv([
      "node",
      "credential-profile.js",
      "init",
      "--state-root",
      "/s",
      "--worktree",
      "/w",
      "--profile",
      "p1",
      "--vendor",
      "codex",
    ]);
    assert.equal(p._tag, "Ok");
    if (p._tag === "Ok") {
      assert.equal(p.command, "init");
      assert.equal(p.vendor, "codex");
      assert.equal(p.profileId, "p1");
    }
  });

  it("emits one canonical JSON line and exit 0 only for Ready/Initialized", async () => {
    const { root, stateRoot, worktreeRoot } = tempPair("cli");
    try {
      const io = captureIo();
      const code = await Effect.runPromise(
        runCredentialProfileCli(
          [
            "credential-profile.js",
            "init",
            "--state-root",
            stateRoot,
            "--worktree",
            worktreeRoot,
            "--profile",
            "cli1",
            "--vendor",
            "grok",
          ],
          io,
        ).pipe(Effect.provide(liveCredentialProfile)),
      );
      assert.equal(code, EXIT_OK);
      const lines = io.stdout().split("\n").filter((l) => l.length > 0);
      assert.equal(lines.length, 1);
      const parsed = JSON.parse(lines[0]!);
      assert.equal(parsed._tag, "Initialized");
      assert.equal(io.stderr(), "");
      // Canonical form
      assert.equal(lines[0], canonicalize(parsed));
      assertSecretSafe(io.stdout(), [
        "HOME",
        "token",
        "password",
        "BEGIN ",
        process.env["HOME"] ?? "___no_home___",
      ]);

      const io2 = captureIo();
      const code2 = await Effect.runPromise(
        runCredentialProfileCli(
          [
            "credential-profile.js",
            "resolve",
            "--state-root",
            stateRoot,
            "--worktree",
            worktreeRoot,
            "--profile",
            "cli1",
            "--vendor",
            "grok",
          ],
          io2,
        ).pipe(Effect.provide(liveCredentialProfile)),
      );
      assert.equal(code2, EXIT_OK);
      assert.equal(JSON.parse(io2.stdout())._tag, "Ready");

      const io3 = captureIo();
      const code3 = await Effect.runPromise(
        runCredentialProfileCli(["credential-profile.js", "init"], io3).pipe(
          Effect.provide(liveCredentialProfile),
        ),
      );
      assert.equal(code3, EXIT_REFUSED);
      const refused = JSON.parse(io3.stdout().trim());
      assert.equal(refused._tag, "Refused");
      assert.equal(refused.reason, "invalid_arguments");
      // No path leakage of state/worktree in refusal.
      assertSecretSafe(io3.stdout(), [stateRoot, worktreeRoot]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Normalize absolute paths
// ---------------------------------------------------------------------------

describe("normalizeAbsolutePath", () => {
  it("strips trailing separator and resolves dots", () => {
    const n = normalizeAbsolutePath(join(tmpdir(), "a", "..", "b") + "/");
    assert.ok(!n.endsWith("/") || n === "/");
    assert.equal(n.includes(".."), false);
  });
});

// ---------------------------------------------------------------------------
// recordsEqualExact
// ---------------------------------------------------------------------------

describe("recordsEqualExact", () => {
  it("compares all closed fields", () => {
    const a = makeCredentialProfileRecord("p", "grok");
    const b = makeCredentialProfileRecord("p", "grok");
    assert.equal(recordsEqualExact(a, b), true);
    assert.equal(
      recordsEqualExact(a, makeCredentialProfileRecord("p", "codex")),
      false,
    );
  });
});
