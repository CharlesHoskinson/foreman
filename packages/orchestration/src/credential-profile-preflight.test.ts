/**
 * Sprint 3 R7B1: profile-bound preflight wrapper and store — TDD.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  chmodSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Effect } from "effect";
import { canonicalize, isCanonicalJsonText } from "@foreman/core";
import {
  makeCredentialProfileRecord,
  PROFILE_JSON_NAME,
  PROFILES_DIR_NAME,
  profileIdentityOf,
  renderCredentialProfileRecordFile,
} from "./credential-profile.js";
import {
  CREDENTIAL_PROFILE_PREFLIGHT_SCHEMA_VERSION,
  DEFAULT_CODEX_CREDENTIAL_PROFILE_ID,
  DEFAULT_GROK_CREDENTIAL_PROFILE_ID,
  MAX_CREDENTIAL_PROFILE_PREFLIGHT_BYTES,
  PROFILE_PREFLIGHT_DIR_NAME,
  ProfilePreflightStoreFailure,
  buildVendorHomeChildEnv,
  decodeCredentialProfilePreflightV1,
  defaultCredentialProfileId,
  isProfilePreflightDecodeFailure,
  liveCredentialProfilePreflightStore,
  makeCredentialProfilePreflight,
  parseCredentialProfilePreflightBytes,
  profilePreflightDirectoryAnchorSupported,
  profilePreflightRecordPath,
  readProfilePreflightRecord,
  renderCredentialProfilePreflight,
  renderCredentialProfilePreflightFile,
  setProfilePreflightRaceHook,
  writeProfilePreflightRecord,
  type CredentialProfilePreflightV1,
} from "./credential-profile-preflight.js";
import type { VendorPreflightRecordV1 } from "./vendor-preflight-contract.js";
import {
  decodeVendorPreflightRecordV1,
  isVendorPreflightContractFailure,
} from "./vendor-preflight-contract.js";

const FIXED_TS = "2026-08-04T15:00:00.000Z";

function readyRecord(
  overrides: Partial<VendorPreflightRecordV1> = {},
): VendorPreflightRecordV1 {
  const base: VendorPreflightRecordV1 = {
    schemaVersion: 1,
    vendor: "grok",
    timestamp: FIXED_TS,
    resolvedPath: "/usr/bin/grok",
    reportedVersion: "0.2.118",
    versionFloor: "0.2.118",
    facts: {
      discoverable: {
        value: "discoverable",
        evidenceClass: "probed",
        reason: "CLI resolved on PATH",
      },
      authenticated: {
        value: "authenticated",
        evidenceClass: "probed",
        reason: "auth probe matched positive marker",
      },
      current: {
        value: "current",
        evidenceClass: "probed",
        reason: "reported version meets floor",
      },
    },
    probes: [
      {
        kind: "version",
        argv: ["grok", "--version"],
        outcome: "completed",
        exitCode: 0,
      },
      {
        kind: "auth",
        argv: ["grok", "models"],
        outcome: "completed",
        exitCode: 0,
      },
    ],
    remediation: { kind: "none", instruction: null },
  };
  return { ...base, ...overrides };
}

function sampleWrapper(
  overrides: Partial<CredentialProfilePreflightV1> = {},
): CredentialProfilePreflightV1 {
  const profile = makeCredentialProfileRecord("grok-default", "grok");
  const base = makeCredentialProfilePreflight(
    profile.profileId,
    profileIdentityOf(profile),
    "grok",
    readyRecord(),
  );
  return { ...base, ...overrides };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "profile-preflight-"));
}

/**
 * Seed R7A-owned authority only: state root, credential-profiles, profile
 * directory, and a valid profile.json that binds the given id/vendor.
 * The store must never create those; tests seed them so write can only
 * create the preflight child.
 */
function seedR7aAuthority(
  stateRoot: string,
  profileId: string,
  vendor: "grok" | "codex" = "grok",
): string {
  const auth = join(stateRoot, PROFILES_DIR_NAME, profileId);
  mkdirSync(auth, { recursive: true, mode: 0o700 });
  const rec = makeCredentialProfileRecord(profileId, vendor);
  writeFileSync(
    join(auth, PROFILE_JSON_NAME),
    renderCredentialProfileRecordFile(rec),
    { mode: 0o600 },
  );
  return auth;
}

describe("default profile ids and paths", () => {
  it("maps grok and codex to closed defaults", () => {
    assert.equal(defaultCredentialProfileId("grok"), DEFAULT_GROK_CREDENTIAL_PROFILE_ID);
    assert.equal(defaultCredentialProfileId("codex"), DEFAULT_CODEX_CREDENTIAL_PROFILE_ID);
    assert.equal(DEFAULT_GROK_CREDENTIAL_PROFILE_ID, "grok-default");
    assert.equal(DEFAULT_CODEX_CREDENTIAL_PROFILE_ID, "codex-default");
  });

  it("builds the exact profile-scoped preflight path", () => {
    const p = profilePreflightRecordPath("/state", "lane-a", "grok");
    assert.equal(
      p,
      join("/state", "credential-profiles", "lane-a", "preflight", "grok.json"),
    );
  });
});

describe("buildVendorHomeChildEnv", () => {
  it("sets GROK_HOME and removes CODEX_HOME without mutating caller", () => {
    const caller: NodeJS.ProcessEnv = {
      HOME: "/home/u",
      GROK_HOME: "/old/grok",
      CODEX_HOME: "/old/codex",
      PATH: "/usr/bin",
    };
    const frozen = { ...caller };
    const child = buildVendorHomeChildEnv(caller, "grok", "/profile/homes/grok");
    assert.equal(child.GROK_HOME, "/profile/homes/grok");
    assert.equal(Object.hasOwn(child, "CODEX_HOME"), false);
    assert.equal(child.HOME, "/home/u");
    assert.deepEqual(caller, frozen);
  });

  it("sets CODEX_HOME and removes GROK_HOME without mutating caller", () => {
    const caller: NodeJS.ProcessEnv = {
      GROK_HOME: "/old/grok",
      CODEX_HOME: "/old/codex",
    };
    const frozen = { ...caller };
    const child = buildVendorHomeChildEnv(caller, "codex", "/profile/homes/codex");
    assert.equal(child.CODEX_HOME, "/profile/homes/codex");
    assert.equal(Object.hasOwn(child, "GROK_HOME"), false);
    assert.deepEqual(caller, frozen);
  });

  it("on Windows removes all case variants of vendor home keys", () => {
    const caller: NodeJS.ProcessEnv = {
      GROK_HOME: "/ambient/grok",
      grok_home: "/mixed/grok",
      Grok_Home: "/title/grok",
      CODEX_HOME: "/ambient/codex",
      codex_home: "/mixed/codex",
      Codex_Home: "/title/codex",
      PATH: "C:\\Windows",
    };
    const frozen = { ...caller };
    const child = buildVendorHomeChildEnv(
      caller,
      "grok",
      "C:\\profiles\\homes\\grok",
      "win32",
    );
    assert.equal(child.GROK_HOME, "C:\\profiles\\homes\\grok");
    // No residual case variants of either vendor home key.
    for (const key of Object.keys(child)) {
      const upper = key.toUpperCase();
      if (upper === "GROK_HOME") {
        assert.equal(key, "GROK_HOME");
      }
      assert.notEqual(upper, "CODEX_HOME");
    }
    assert.deepEqual(caller, frozen);
  });

  it("on POSIX keeps mixed-case non-canonical keys (case-sensitive)", () => {
    const caller: NodeJS.ProcessEnv = {
      GROK_HOME: "/old/grok",
      grok_home: "/mixed/still-present",
      CODEX_HOME: "/old/codex",
      codex_home: "/mixed/codex-present",
    };
    const child = buildVendorHomeChildEnv(
      caller,
      "grok",
      "/profile/homes/grok",
      "linux",
    );
    assert.equal(child.GROK_HOME, "/profile/homes/grok");
    assert.equal(Object.hasOwn(child, "CODEX_HOME"), false);
    // Exact non-canonical keys are not stripped on POSIX.
    assert.equal(child.grok_home, "/mixed/still-present");
    assert.equal(child.codex_home, "/mixed/codex-present");
  });
});

describe("decodeCredentialProfilePreflightV1", () => {
  it("accepts canonical round trip", () => {
    const w = sampleWrapper();
    const text = renderCredentialProfilePreflight(w);
    assert.ok(isCanonicalJsonText(text));
    assert.equal(text, canonicalize(w as unknown));
    const decoded = decodeCredentialProfilePreflightV1(JSON.parse(text));
    assert.ok(!isProfilePreflightDecodeFailure(decoded));
    assert.equal(decoded.schemaVersion, CREDENTIAL_PROFILE_PREFLIGHT_SCHEMA_VERSION);
    assert.equal(decoded.profileId, w.profileId);
    assert.equal(decoded.vendor, "grok");
    assert.equal(decoded.record.vendor, "grok");
  });

  it("file render ends with exactly one LF", () => {
    const body = renderCredentialProfilePreflightFile(sampleWrapper());
    assert.ok(body.endsWith("\n"));
    assert.equal(body.endsWith("\n\n"), false);
  });

  it("rejects unknown keys", () => {
    const raw = { ...sampleWrapper(), extra: true };
    const d = decodeCredentialProfilePreflightV1(raw);
    assert.ok(isProfilePreflightDecodeFailure(d));
    assert.equal(d.reason, "unknown_key");
  });

  it("rejects invalid profile id", () => {
    const d = decodeCredentialProfilePreflightV1(
      sampleWrapper({ profileId: "../evil" }),
    );
    assert.ok(isProfilePreflightDecodeFailure(d));
    assert.equal(d.reason, "invalid_profile_id");
  });

  it("rejects unsupported vendor", () => {
    const d = decodeCredentialProfilePreflightV1({
      ...sampleWrapper(),
      vendor: "claude",
    });
    assert.ok(isProfilePreflightDecodeFailure(d));
    assert.equal(d.reason, "unsupported_vendor");
  });

  it("rejects vendor mismatch between wrapper and nested record", () => {
    const d = decodeCredentialProfilePreflightV1(
      makeCredentialProfilePreflight(
        "codex-default",
        profileIdentityOf(makeCredentialProfileRecord("codex-default", "codex")),
        "codex",
        readyRecord({ vendor: "grok" }),
      ),
    );
    assert.ok(isProfilePreflightDecodeFailure(d));
    // Nested record may fail contract first (vendor enum in nested decode
    // with mismatched facts) — either vendor_mismatch or invalid_nested_record.
    assert.ok(
      d.reason === "vendor_mismatch" || d.reason === "invalid_nested_record",
    );
  });

  it("rejects invalid nested vendor record", () => {
    const w = sampleWrapper();
    const d = decodeCredentialProfilePreflightV1({
      ...w,
      record: { schemaVersion: 1, vendor: "grok" },
    });
    assert.ok(isProfilePreflightDecodeFailure(d));
    assert.equal(d.reason, "invalid_nested_record");
  });

  it("rejects profile id mismatch against expected", () => {
    const d = decodeCredentialProfilePreflightV1(sampleWrapper(), {
      profileId: "other-id",
    });
    assert.ok(isProfilePreflightDecodeFailure(d));
    assert.equal(d.reason, "profile_mismatch");
  });

  it("rejects profile-identity mismatch against expected", () => {
    const d = decodeCredentialProfilePreflightV1(sampleWrapper(), {
      profileIdentity: "a".repeat(64),
    });
    assert.ok(isProfilePreflightDecodeFailure(d));
    assert.equal(d.reason, "profile_identity_mismatch");
  });

  it("rejects vendor mismatch against expected", () => {
    const d = decodeCredentialProfilePreflightV1(sampleWrapper(), {
      vendor: "codex",
    });
    assert.ok(isProfilePreflightDecodeFailure(d));
    assert.equal(d.reason, "vendor_mismatch");
  });
});

describe("parseCredentialProfilePreflightBytes", () => {
  it("rejects duplicate keys at any depth", () => {
    const text = '{"schemaVersion":1,"profileId":"grok-default","profileIdentity":"' +
      "a".repeat(64) +
      '","vendor":"grok","record":{"schemaVersion":1,"schemaVersion":1}}';
    const bytes = Buffer.from(text, "utf8");
    const p = parseCredentialProfilePreflightBytes(bytes);
    assert.equal(p._tag, "Fail");
    if (p._tag === "Fail") {
      assert.equal(p.reason, "duplicate_key");
    }
  });

  it("rejects oversize input", () => {
    const big = Buffer.alloc(MAX_CREDENTIAL_PROFILE_PREFLIGHT_BYTES + 1, 0x61);
    const p = parseCredentialProfilePreflightBytes(big);
    assert.equal(p._tag, "Fail");
    if (p._tag === "Fail") {
      assert.equal(p.reason, "oversized");
    }
  });

  it("rejects malformed UTF-8", () => {
    const p = parseCredentialProfilePreflightBytes(Buffer.from([0xff, 0xfe, 0xfd]));
    assert.equal(p._tag, "Fail");
    if (p._tag === "Fail") {
      assert.equal(p.reason, "malformed_utf8");
    }
  });

  it("accepts canonical file body with trailing LF", () => {
    const body = renderCredentialProfilePreflightFile(sampleWrapper());
    const p = parseCredentialProfilePreflightBytes(Buffer.from(body, "utf8"));
    assert.equal(p._tag, "Ok");
  });
});

describe("CredentialProfilePreflightStore", () => {
  it("writes canonical JSON with one trailing LF at the exact path", async () => {
    const root = tempDir();
    seedR7aAuthority(root, "grok-default");
    const path = profilePreflightRecordPath(root, "grok-default", "grok");
    const wrapper = sampleWrapper();

    await Effect.runPromise(
      writeProfilePreflightRecord(path, wrapper).pipe(
        Effect.provide(liveCredentialProfilePreflightStore),
      ),
    );

    assert.ok(existsSync(path));
    const text = readFileSync(path, "utf8");
    assert.ok(text.endsWith("\n"));
    assert.equal(text.endsWith("\n\n"), false);
    const line = text.slice(0, -1);
    assert.ok(isCanonicalJsonText(line));
    const decoded = decodeCredentialProfilePreflightV1(JSON.parse(line));
    assert.ok(!isProfilePreflightDecodeFailure(decoded));
    assert.equal(decoded.profileId, "grok-default");

    const leftovers = readdirSync(dirnameSafe(path)).filter((n) =>
      n.includes(".tmp"),
    );
    assert.deepEqual(leftovers, []);
  });

  it(
    "uses owner-only POSIX modes for the parent and record",
    { skip: process.platform === "win32" },
    async () => {
      const root = tempDir();
      seedR7aAuthority(root, "p");
      const path = profilePreflightRecordPath(root, "p", "grok");
      const rec = makeCredentialProfileRecord("p", "grok");
      const fixed = makeCredentialProfilePreflight(
        "p",
        profileIdentityOf(rec),
        "grok",
        readyRecord(),
      );
      await Effect.runPromise(writeProfilePreflightRecord(path, fixed));
      assert.equal(statSync(dirnameSafe(path)).mode & 0o777, 0o700);
      assert.equal(statSync(path).mode & 0o777, 0o600);
    },
  );

  it("reads back a published record with no-follow bounded I/O", async () => {
    const root = tempDir();
    seedR7aAuthority(root, "p");
    const path = profilePreflightRecordPath(root, "p", "grok");
    const rec = makeCredentialProfileRecord("p", "grok");
    const fixed = makeCredentialProfilePreflight(
      "p",
      profileIdentityOf(rec),
      "grok",
      readyRecord(),
    );
    await Effect.runPromise(writeProfilePreflightRecord(path, fixed));
    const read = await Effect.runPromise(
      readProfilePreflightRecord(path, {
        profileId: "p",
        profileIdentity: fixed.profileIdentity,
        vendor: "grok",
      }),
    );
    assert.equal(read.profileId, "p");
    assert.equal(read.vendor, "grok");
  });

  it("refuses to create missing credential-profiles or profile authority", async () => {
    const root = tempDir();
    // State root only — no R7A credential-profiles.
    const path = profilePreflightRecordPath(root, "p", "grok");
    const rec = makeCredentialProfileRecord("p", "grok");
    const fixed = makeCredentialProfilePreflight(
      "p",
      profileIdentityOf(rec),
      "grok",
      readyRecord(),
    );
    const either = await Effect.runPromise(
      writeProfilePreflightRecord(path, fixed).pipe(Effect.either),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "absent");
    }
    assert.equal(existsSync(join(root, PROFILES_DIR_NAME)), false);
  });

  it("refuses write when profile.json is missing under authority", async () => {
    const root = tempDir();
    const auth = join(root, PROFILES_DIR_NAME, "p");
    mkdirSync(auth, { recursive: true, mode: 0o700 });
    // No profile.json
    const path = profilePreflightRecordPath(root, "p", "grok");
    const rec = makeCredentialProfileRecord("p", "grok");
    const fixed = makeCredentialProfilePreflight(
      "p",
      profileIdentityOf(rec),
      "grok",
      readyRecord(),
    );
    const either = await Effect.runPromise(
      writeProfilePreflightRecord(path, fixed).pipe(Effect.either),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "absent");
    }
    assert.equal(
      existsSync(join(auth, PROFILE_PREFLIGHT_DIR_NAME)),
      false,
      "must not create preflight without profile.json",
    );
  });

  it("refuses symlink at the final path on read", async () => {
    const root = tempDir();
    seedR7aAuthority(root, "p");
    const dir = join(root, PROFILES_DIR_NAME, "p", PROFILE_PREFLIGHT_DIR_NAME);
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "real.json");
    const rec = makeCredentialProfileRecord("p", "grok");
    const fixed = makeCredentialProfilePreflight(
      "p",
      profileIdentityOf(rec),
      "grok",
      readyRecord(),
    );
    writeFileSync(target, renderCredentialProfilePreflightFile(fixed));
    const linkPath = join(dir, "grok.json");
    try {
      symlinkSync(target, linkPath);
    } catch {
      // Windows without privilege: skip
      return;
    }
    const either = await Effect.runPromise(
      readProfilePreflightRecord(linkPath).pipe(Effect.either),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.ok(either.left instanceof ProfilePreflightStoreFailure);
      assert.equal(either.left.reason, "linked_path");
      // Sanitized: reason only, no path leakage via message.
      assert.equal(
        Object.prototype.hasOwnProperty.call(either.left, "detail"),
        false,
      );
    }
  });

  it("refuses linked preflight directory on read", async () => {
    const root = tempDir();
    seedR7aAuthority(root, "p");
    const profileDir = join(root, PROFILES_DIR_NAME, "p");
    const realPreflight = join(root, "outside-preflight");
    mkdirSync(realPreflight, { recursive: true });
    const rec = makeCredentialProfileRecord("p", "grok");
    const fixed = makeCredentialProfilePreflight(
      "p",
      profileIdentityOf(rec),
      "grok",
      readyRecord(),
    );
    writeFileSync(
      join(realPreflight, "grok.json"),
      renderCredentialProfilePreflightFile(fixed),
    );
    const linkPreflight = join(profileDir, PROFILE_PREFLIGHT_DIR_NAME);
    try {
      symlinkSync(realPreflight, linkPreflight);
    } catch {
      return;
    }
    const path = join(linkPreflight, "grok.json");
    const either = await Effect.runPromise(
      readProfilePreflightRecord(path).pipe(Effect.either),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "linked_path");
    }
  });

  it("refuses linked credential-profiles ancestor on write", async () => {
    const root = tempDir();
    const outside = join(root, "outside-profiles");
    mkdirSync(outside, { recursive: true });
    // Seed R7A under the outside target, then link credential-profiles.
    mkdirSync(join(outside, "p"), { recursive: true, mode: 0o700 });
    writeFileSync(join(outside, "p", PROFILE_JSON_NAME), "{}\n", {
      mode: 0o600,
    });
    const profilesLink = join(root, PROFILES_DIR_NAME);
    try {
      symlinkSync(outside, profilesLink);
    } catch {
      return;
    }
    const path = profilePreflightRecordPath(root, "p", "grok");
    const rec = makeCredentialProfileRecord("p", "grok");
    const fixed = makeCredentialProfilePreflight(
      "p",
      profileIdentityOf(rec),
      "grok",
      readyRecord(),
    );
    const either = await Effect.runPromise(
      writeProfilePreflightRecord(path, fixed).pipe(Effect.either),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "linked_path");
    }
  });

  it("refuses linked profile directory on write", async () => {
    const root = tempDir();
    const profilesRoot = join(root, PROFILES_DIR_NAME);
    mkdirSync(profilesRoot, { recursive: true });
    const outside = join(root, "outside-profile");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, PROFILE_JSON_NAME), "{}\n", { mode: 0o600 });
    const profileLink = join(profilesRoot, "p");
    try {
      symlinkSync(outside, profileLink);
    } catch {
      return;
    }
    const path = profilePreflightRecordPath(root, "p", "grok");
    const rec = makeCredentialProfileRecord("p", "grok");
    const fixed = makeCredentialProfilePreflight(
      "p",
      profileIdentityOf(rec),
      "grok",
      readyRecord(),
    );
    const either = await Effect.runPromise(
      writeProfilePreflightRecord(path, fixed).pipe(Effect.either),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "linked_path");
    }
  });

  it("returns absent for missing file", async () => {
    const path = join(tempDir(), "missing.json");
    const either = await Effect.runPromise(
      readProfilePreflightRecord(path).pipe(Effect.either),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "absent");
    }
  });

  it("rejects relative paths as path_invalid", async () => {
    const either = await Effect.runPromise(
      writeProfilePreflightRecord("relative/path.json", sampleWrapper()).pipe(
        Effect.either,
      ),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "path_invalid");
    }
  });

  it("atomic publish replaces previous content", async () => {
    const root = tempDir();
    seedR7aAuthority(root, "p");
    const path = profilePreflightRecordPath(root, "p", "grok");
    const rec = makeCredentialProfileRecord("p", "grok");
    const id = profileIdentityOf(rec);
    const first = makeCredentialProfilePreflight(
      "p",
      id,
      "grok",
      readyRecord({
        facts: {
          discoverable: {
            value: "discoverable",
            evidenceClass: "probed",
            reason: "first write reason unique",
          },
          authenticated: {
            value: "authenticated",
            evidenceClass: "probed",
            reason: "auth",
          },
          current: {
            value: "current",
            evidenceClass: "probed",
            reason: "cur",
          },
        },
      }),
    );
    // Second record must remain a valid closed nested VendorPreflightRecordV1
    // (not-authenticated requires rem.kind === "login"). Differ only by a
    // unique fact reason so atomic publish can be observed without weakening
    // wrapper decode.
    const second = makeCredentialProfilePreflight(
      "p",
      id,
      "grok",
      readyRecord({
        facts: {
          discoverable: {
            value: "discoverable",
            evidenceClass: "probed",
            reason: "second write reason unique",
          },
          authenticated: {
            value: "authenticated",
            evidenceClass: "probed",
            reason: "auth probe matched positive marker",
          },
          current: {
            value: "current",
            evidenceClass: "probed",
            reason: "cur",
          },
        },
      }),
    );
    await Effect.runPromise(writeProfilePreflightRecord(path, first));
    await Effect.runPromise(writeProfilePreflightRecord(path, second));
    const text = readFileSync(path, "utf8");
    assert.match(text, /second write reason unique/);
    assert.doesNotMatch(text, /first write reason unique/);
    const outer = decodeCredentialProfilePreflightV1(JSON.parse(text));
    assert.ok(!isProfilePreflightDecodeFailure(outer));
    assert.equal(
      outer.record.facts.discoverable.reason,
      "second write reason unique",
    );
  });

  it("cleans up temp files after a failed write of an invalid wrapper", async () => {
    const root = tempDir();
    seedR7aAuthority(root, "p");
    const path = profilePreflightRecordPath(root, "p", "grok");
    const bad = sampleWrapper({
      profileId: "not valid!!",
    }) as CredentialProfilePreflightV1;
    const either = await Effect.runPromise(
      writeProfilePreflightRecord(path, bad).pipe(Effect.either),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "decode_failed");
    }
    // Parent may or may not exist; no .tmp leftovers if dir exists.
    const dir = dirnameSafe(path);
    if (existsSync(dir)) {
      const leftovers = readdirSync(dir).filter((n) => n.includes(".tmp"));
      assert.deepEqual(leftovers, []);
    }
  });

  it("sanitized failures never embed path or exception text", async () => {
    const either = await Effect.runPromise(
      readProfilePreflightRecord("/no/such/path/preflight.json").pipe(
        Effect.either,
      ),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      const s = JSON.stringify(either.left);
      assert.doesNotMatch(s, /\/no\/such/);
      assert.doesNotMatch(s, /Error|ENOENT|stack/i);
      assert.equal(either.left.reason, "absent");
    }
  });
});

describe("profile preflight authority race seams", () => {
  it("vanished profile authority after capture fails closed before publish", async () => {
    const root = tempDir();
    seedR7aAuthority(root, "p");
    const path = profilePreflightRecordPath(root, "p", "grok");
    const rec = makeCredentialProfileRecord("p", "grok");
    const fixed = makeCredentialProfilePreflight(
      "p",
      profileIdentityOf(rec),
      "grok",
      readyRecord(),
    );
    const authDir = join(root, PROFILES_DIR_NAME, "p");
    setProfilePreflightRaceHook({
      afterCaptureAuthority: () => {
        // Remove the whole profile authority after capture.
        rmSync(authDir, { recursive: true, force: true });
      },
    });
    try {
      const either = await Effect.runPromise(
        writeProfilePreflightRecord(path, fixed).pipe(Effect.either),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assert.ok(
          either.left.reason === "identity_changed" ||
            either.left.reason === "absent" ||
            either.left.reason === "write_failed",
        );
      }
      assert.equal(existsSync(path), false);
    } finally {
      setProfilePreflightRaceHook(undefined);
    }
  });

  it("state-root link swap after capture fails closed", async () => {
    const outer = tempDir();
    const realState = join(outer, "real-state");
    mkdirSync(realState, { recursive: true });
    seedR7aAuthority(realState, "p");
    // Use realState as the state root path for the write.
    const path = profilePreflightRecordPath(realState, "p", "grok");
    const rec = makeCredentialProfileRecord("p", "grok");
    const fixed = makeCredentialProfilePreflight(
      "p",
      profileIdentityOf(rec),
      "grok",
      readyRecord(),
    );
    const parked = join(outer, "parked-state");
    const attacker = join(outer, "attacker-state");
    mkdirSync(attacker, { recursive: true });
    seedR7aAuthority(attacker, "p");

    setProfilePreflightRaceHook({
      afterCaptureAuthority: () => {
        // Swap state root path to a symlink pointing at the attacker tree.
        renameSync(realState, parked);
        try {
          symlinkSync(attacker, realState);
        } catch {
          // Restore if symlink unsupported.
          renameSync(parked, realState);
        }
      },
    });
    try {
      const either = await Effect.runPromise(
        writeProfilePreflightRecord(path, fixed).pipe(Effect.either),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assert.ok(
          either.left.reason === "linked_path" ||
            either.left.reason === "identity_changed" ||
            either.left.reason === "absent" ||
            either.left.reason === "write_failed",
        );
      }
      // Must not publish into the attacker tree via the swapped path.
      assert.equal(
        existsSync(profilePreflightRecordPath(attacker, "p", "grok")),
        false,
      );
    } finally {
      setProfilePreflightRaceHook(undefined);
    }
  });

  it(
    "parent swap at publication boundary does not publish into attacker dir",
    {
      skip:
        process.platform === "win32" ||
        !profilePreflightDirectoryAnchorSupported(),
    },
    async () => {
      const root = tempDir();
      seedR7aAuthority(root, "p");
      const path = profilePreflightRecordPath(root, "p", "grok");
      const rec = makeCredentialProfileRecord("p", "grok");
      const fixed = makeCredentialProfilePreflight(
        "p",
        profileIdentityOf(rec),
        "grok",
        readyRecord(),
      );
      // Create preflight first so bind succeeds, then swap it.
      const preflightDir = join(
        root,
        PROFILES_DIR_NAME,
        "p",
        PROFILE_PREFLIGHT_DIR_NAME,
      );
      mkdirSync(preflightDir, { recursive: true, mode: 0o700 });
      const outside = join(root, "outside-preflight");
      mkdirSync(outside, { recursive: true });
      const parked = join(root, "parked-preflight");

      setProfilePreflightRaceHook({
        afterBindParentDir: () => {
          // Replace preflight path with a symlink to outside after bind.
          renameSync(preflightDir, parked);
          try {
            symlinkSync(outside, preflightDir);
          } catch {
            renameSync(parked, preflightDir);
          }
        },
      });
      try {
        const either = await Effect.runPromise(
          writeProfilePreflightRecord(path, fixed).pipe(Effect.either),
        );
        assert.equal(either._tag, "Left");
        if (either._tag === "Left") {
          assert.ok(
            either.left.reason === "linked_path" ||
              either.left.reason === "identity_changed" ||
              either.left.reason === "write_failed",
          );
        }
        // Anchored publish must not land the record under the attacker path.
        assert.equal(existsSync(join(outside, "grok.json")), false);
        // Path-visible publish must not succeed after the swap.
        assert.equal(existsSync(path), false);
      } finally {
        setProfilePreflightRaceHook(undefined);
      }
    },
  );

  it(
    "profile-directory swap cannot redirect preflight creation",
    {
      skip:
        process.platform === "win32" ||
        !profilePreflightDirectoryAnchorSupported(),
    },
    async () => {
      const root = tempDir();
      seedR7aAuthority(root, "p");
      const path = profilePreflightRecordPath(root, "p", "grok");
      const rec = makeCredentialProfileRecord("p", "grok");
      const fixed = makeCredentialProfilePreflight(
        "p",
        profileIdentityOf(rec),
        "grok",
        readyRecord(),
      );
      const profileDir = join(root, PROFILES_DIR_NAME, "p");
      const outside = join(root, "outside-profile");
      mkdirSync(outside, { recursive: true });
      const parked = join(root, "parked-profile");

      setProfilePreflightRaceHook({
        beforeCreatePreflightDir: () => {
          // After profile dir is bound/validated, swap it to the attacker.
          renameSync(profileDir, parked);
          try {
            symlinkSync(outside, profileDir);
          } catch {
            renameSync(parked, profileDir);
          }
        },
      });
      try {
        const either = await Effect.runPromise(
          writeProfilePreflightRecord(path, fixed).pipe(Effect.either),
        );
        assert.equal(either._tag, "Left");
        if (either._tag === "Left") {
          assert.ok(
            either.left.reason === "linked_path" ||
              either.left.reason === "identity_changed" ||
              either.left.reason === "write_failed" ||
              either.left.reason === "absent" ||
              either.left.reason === "decode_failed",
          );
        }
        // Must not create preflight under the attacker profile directory.
        assert.equal(
          existsSync(join(outside, PROFILE_PREFLIGHT_DIR_NAME)),
          false,
          "must not create preflight under swapped profile directory",
        );
        assert.equal(existsSync(path), false);
      } finally {
        setProfilePreflightRaceHook(undefined);
      }
    },
  );

  it(
    "concurrent EEXIST preflight create enforces owner-only mode through descriptor",
    {
      skip:
        process.platform === "win32" ||
        !profilePreflightDirectoryAnchorSupported(),
    },
    async () => {
      const root = tempDir();
      seedR7aAuthority(root, "p");
      const path = profilePreflightRecordPath(root, "p", "grok");
      const rec = makeCredentialProfileRecord("p", "grok");
      const fixed = makeCredentialProfilePreflight(
        "p",
        profileIdentityOf(rec),
        "grok",
        readyRecord(),
      );
      const preflightDir = join(
        root,
        PROFILES_DIR_NAME,
        "p",
        PROFILE_PREFLIGHT_DIR_NAME,
      );
      // Concurrent supply: after observe-missing, before mkdir → EEXIST.
      // World-writable so a skipped mode fix is observable.
      setProfilePreflightRaceHook({
        beforeMkdirPreflightDir: () => {
          mkdirSync(preflightDir, { recursive: false, mode: 0o777 });
          // Ensure the concurrent directory is not owner-only.
          chmodSync(preflightDir, 0o777);
        },
      });
      try {
        await Effect.runPromise(writeProfilePreflightRecord(path, fixed));
        assert.equal(existsSync(path), true, "write must publish after EEXIST");
        // Must not accept the concurrent directory without 0700 enforcement.
        const mode = statSync(preflightDir).mode & 0o777;
        assert.equal(
          mode,
          0o700,
          "concurrent EEXIST preflight dir must be owner-only 0700 via descriptor",
        );
      } finally {
        setProfilePreflightRaceHook(undefined);
      }
    },
  );

  it("in-place profile.json rewrite before preflight create fails closed", async () => {
    const root = tempDir();
    seedR7aAuthority(root, "p", "grok");
    const path = profilePreflightRecordPath(root, "p", "grok");
    const rec = makeCredentialProfileRecord("p", "grok");
    const fixed = makeCredentialProfilePreflight(
      "p",
      profileIdentityOf(rec),
      "grok",
      readyRecord(),
    );
    const profileJson = join(root, PROFILES_DIR_NAME, "p", PROFILE_JSON_NAME);
    // Different binding (codex) rewritten in place — same path, typically same inode.
    const attacker = makeCredentialProfileRecord("p", "codex");

    setProfilePreflightRaceHook({
      beforeCreatePreflightDir: () => {
        writeFileSync(
          profileJson,
          renderCredentialProfileRecordFile(attacker),
          { mode: 0o600 },
        );
      },
    });
    try {
      const either = await Effect.runPromise(
        writeProfilePreflightRecord(path, fixed).pipe(Effect.either),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assert.ok(
          either.left.reason === "decode_failed" ||
            either.left.reason === "identity_changed" ||
            either.left.reason === "write_failed" ||
            either.left.reason === "malformed",
        );
      }
      assert.equal(existsSync(path), false);
    } finally {
      setProfilePreflightRaceHook(undefined);
    }
  });

  it("in-place profile.json rewrite before final publication fails closed", async () => {
    const root = tempDir();
    seedR7aAuthority(root, "p", "grok");
    const path = profilePreflightRecordPath(root, "p", "grok");
    const rec = makeCredentialProfileRecord("p", "grok");
    const fixed = makeCredentialProfilePreflight(
      "p",
      profileIdentityOf(rec),
      "grok",
      readyRecord(),
    );
    const profileJson = join(root, PROFILES_DIR_NAME, "p", PROFILE_JSON_NAME);
    const attacker = makeCredentialProfileRecord("p", "codex");

    setProfilePreflightRaceHook({
      beforePublishRename: () => {
        writeFileSync(
          profileJson,
          renderCredentialProfileRecordFile(attacker),
          { mode: 0o600 },
        );
      },
    });
    try {
      const either = await Effect.runPromise(
        writeProfilePreflightRecord(path, fixed).pipe(Effect.either),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assert.ok(
          either.left.reason === "decode_failed" ||
            either.left.reason === "identity_changed" ||
            either.left.reason === "write_failed" ||
            either.left.reason === "malformed",
        );
      }
      // Must not publish under a rewritten authority binding.
      assert.equal(existsSync(path), false);
    } finally {
      setProfilePreflightRaceHook(undefined);
    }
  });
});

function dirnameSafe(p: string): string {
  return join(p, "..");
}

// Silence unused import on platforms that skip symlink test helpers.
void lstatSync;
void unlinkSync;
void chmodSync;
void isVendorPreflightContractFailure;
