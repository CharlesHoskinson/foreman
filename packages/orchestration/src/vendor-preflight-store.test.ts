/**
 * PreflightRecordStore: bounded reads and atomic owner-only writes.
 * Sprint 3 R4C — TDD red-first.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Effect } from "effect";
import { canonicalize, isCanonicalJsonText } from "@foreman/core";
import {
  decodeVendorPreflightRecordV1,
  isVendorPreflightContractFailure,
  type VendorPreflightRecordV1,
} from "./vendor-preflight-contract.js";
import {
  MAX_PREFLIGHT_RECORD_BYTES,
  PreflightRecordStore,
  PreflightStoreFailure,
  livePreflightRecordStore,
} from "./vendor-preflight-store.js";

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

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "preflight-store-"));
}

describe("MAX_PREFLIGHT_RECORD_BYTES", () => {
  it("is 1,048,576 bytes", () => {
    assert.equal(MAX_PREFLIGHT_RECORD_BYTES, 1_048_576);
  });
});

describe("PreflightRecordStore write", () => {
  it("writes canonical JSON with one trailing LF, mode 0600, parent 0700", async () => {
    const dir = tempDir();
    const parent = join(dir, "preflight");
    const path = join(parent, "grok.json");
    const rec = readyRecord();

    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* PreflightRecordStore;
        yield* store.write(path, rec);
      }).pipe(Effect.provide(livePreflightRecordStore)),
    );

    assert.ok(existsSync(path));
    const parentMode = statSync(parent).mode & 0o777;
    const fileMode = statSync(path).mode & 0o777;
    assert.equal(parentMode, 0o700);
    assert.equal(fileMode, 0o600);

    const text = readFileSync(path, "utf8");
    assert.ok(text.endsWith("\n"));
    assert.equal(text.endsWith("\n\n"), false);
    const line = text.slice(0, -1);
    assert.ok(isCanonicalJsonText(line));
    assert.equal(line, canonicalize(rec as unknown));
    const decoded = decodeVendorPreflightRecordV1(JSON.parse(line));
    assert.ok(!isVendorPreflightContractFailure(decoded));
    assert.equal(decoded.vendor, "grok");

    // No temporary files left in the directory.
    const leftovers = readdirSync(parent).filter((n) => n.includes(".tmp"));
    assert.deepEqual(leftovers, []);
  });

  it("replaces an existing complete record only after durable temp write", async () => {
    const dir = tempDir();
    const path = join(dir, "grok.json");
    const first = readyRecord({
      facts: {
        discoverable: {
          value: "discoverable",
          evidenceClass: "probed",
          reason: "first write reason unique",
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
    });
    const second = readyRecord({
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
          reason: "reported version meets floor",
        },
      },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* PreflightRecordStore;
        yield* store.write(path, first);
        yield* store.write(path, second);
      }).pipe(Effect.provide(livePreflightRecordStore)),
    );

    const text = readFileSync(path, "utf8");
    assert.match(text, /second write reason unique/);
    assert.doesNotMatch(text, /first write reason unique/);
  });

  it("rejects a relative path without writing", async () => {
    const either = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* PreflightRecordStore;
        return yield* store.write("relative/grok.json", readyRecord()).pipe(
          Effect.either,
        );
      }).pipe(Effect.provide(livePreflightRecordStore)),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.ok(either.left instanceof PreflightStoreFailure);
      assert.equal(either.left.reason, "path_invalid");
    }
  });
});

describe("PreflightRecordStore read", () => {
  it("decodes a written record through decodeVendorPreflightRecordV1", async () => {
    const dir = tempDir();
    const path = join(dir, "grok.json");
    const rec = readyRecord();

    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* PreflightRecordStore;
        yield* store.write(path, rec);
        const got = yield* store.read(path);
        assert.equal(got.vendor, "grok");
        assert.equal(got.facts.authenticated.value, "authenticated");
      }).pipe(Effect.provide(livePreflightRecordStore)),
    );
  });

  it("returns absent for a missing path", async () => {
    const dir = tempDir();
    const path = join(dir, "missing.json");
    const either = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* PreflightRecordStore;
        return yield* store.read(path).pipe(Effect.either);
      }).pipe(Effect.provide(livePreflightRecordStore)),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "absent");
    }
  });

  it("bounds input to MAX_PREFLIGHT_RECORD_BYTES before JSON parse", async () => {
    const dir = tempDir();
    const path = join(dir, "huge.json");
    // Oversized raw payload — one byte past the bound.
    const huge = "x".repeat(MAX_PREFLIGHT_RECORD_BYTES + 1);
    writeFileSync(path, huge, "utf8");

    const either = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* PreflightRecordStore;
        return yield* store.read(path).pipe(Effect.either);
      }).pipe(Effect.provide(livePreflightRecordStore)),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "oversized");
    }
  });

  it("rejects malformed JSON and unknown fields via the public decoder", async () => {
    const dir = tempDir();
    const badJson = join(dir, "bad.json");
    writeFileSync(badJson, "{not-json\n", "utf8");
    const eitherJson = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* PreflightRecordStore;
        return yield* store.read(badJson).pipe(Effect.either);
      }).pipe(Effect.provide(livePreflightRecordStore)),
    );
    assert.equal(eitherJson._tag, "Left");
    if (eitherJson._tag === "Left") {
      assert.equal(eitherJson.left.reason, "malformed_json");
    }

    const badSchema = join(dir, "schema.json");
    writeFileSync(
      badSchema,
      JSON.stringify({ schemaVersion: 99, extra: true }) + "\n",
      "utf8",
    );
    const eitherSchema = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* PreflightRecordStore;
        return yield* store.read(badSchema).pipe(Effect.either);
      }).pipe(Effect.provide(livePreflightRecordStore)),
    );
    assert.equal(eitherSchema._tag, "Left");
    if (eitherSchema._tag === "Left") {
      assert.equal(eitherSchema.left.reason, "decode_failed");
    }
  });

  it("rejects a relative path", async () => {
    const either = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* PreflightRecordStore;
        return yield* store.read("relative.json").pipe(Effect.either);
      }).pipe(Effect.provide(livePreflightRecordStore)),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "path_invalid");
    }
  });

  it("returns unreadable when the path is not a regular file", async () => {
    const dir = tempDir();
    const either = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* PreflightRecordStore;
        return yield* store.read(dir).pipe(Effect.either);
      }).pipe(Effect.provide(livePreflightRecordStore)),
    );
    assert.equal(either._tag, "Left");
    if (either._tag === "Left") {
      assert.equal(either.left.reason, "unreadable");
    }
  });
});
