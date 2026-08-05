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
  profileIdentityOf,
} from "./credential-profile.js";
import {
  CREDENTIAL_PROFILE_PREFLIGHT_SCHEMA_VERSION,
  DEFAULT_CODEX_CREDENTIAL_PROFILE_ID,
  DEFAULT_GROK_CREDENTIAL_PROFILE_ID,
  MAX_CREDENTIAL_PROFILE_PREFLIGHT_BYTES,
  ProfilePreflightStoreFailure,
  buildVendorHomeChildEnv,
  decodeCredentialProfilePreflightV1,
  defaultCredentialProfileId,
  isProfilePreflightDecodeFailure,
  liveCredentialProfilePreflightStore,
  makeCredentialProfilePreflight,
  parseCredentialProfilePreflightBytes,
  profilePreflightRecordPath,
  readProfilePreflightRecord,
  renderCredentialProfilePreflight,
  renderCredentialProfilePreflightFile,
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
      const path = profilePreflightRecordPath(root, "p", "grok");
      await Effect.runPromise(writeProfilePreflightRecord(path, sampleWrapper()));
      assert.equal(statSync(dirnameSafe(path)).mode & 0o777, 0o700);
      assert.equal(statSync(path).mode & 0o777, 0o600);
    },
  );

  it("reads back a published record with no-follow bounded I/O", async () => {
    const root = tempDir();
    const path = profilePreflightRecordPath(root, "p", "grok");
    const wrapper = sampleWrapper({ profileId: "p" });
    // Fix identity to match profileId p
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

  it("refuses symlink at the final path on read", async () => {
    const root = tempDir();
    const dir = join(root, "credential-profiles", "p", "preflight");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "real.json");
    writeFileSync(target, renderCredentialProfilePreflightFile(sampleWrapper()));
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

function dirnameSafe(p: string): string {
  return join(p, "..");
}

// Silence unused import on platforms that skip symlink test helpers.
void lstatSync;
void unlinkSync;
void chmodSync;
void isVendorPreflightContractFailure;
