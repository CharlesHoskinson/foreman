/**
 * R7B2-A: profile-bound lane admission core — RED-first tests.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { Effect, Layer } from "effect";
import {
  CredentialProfileFs,
  initProfile,
  liveCredentialProfile,
  liveCredentialProfileFs,
  type CredentialProfileFsShape,
  type CredentialProfileInput,
} from "./credential-profile.js";
import {
  CredentialProfilePreflightStore,
  ProfilePreflightStoreFailure,
  liveCredentialProfilePreflightStore,
  makeCredentialProfilePreflight,
  profilePreflightRecordPath,
  writeProfilePreflightRecord,
  type CredentialProfilePreflightExpected,
  type CredentialProfilePreflightV1,
} from "./credential-profile-preflight.js";
import {
  CREDENTIAL_PROFILE_LANE_REFUSAL_REASONS,
  admitCredentialProfileLane,
} from "./credential-profile-lane.js";
import type { VendorPreflightRecordV1 } from "./vendor-preflight-contract.js";
import { profilePreflightDirectoryAnchorSupported } from "./credential-profile-preflight.js";

const livePersistLane = {
  skip: !profilePreflightDirectoryAnchorSupported(),
};

const FIXED_TS = "2026-08-05T15:00:00Z";

type Fixture = {
  readonly root: string;
  readonly input: CredentialProfileInput;
  readonly wrapper: CredentialProfilePreflightV1;
};

const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

function readyRecord(): VendorPreflightRecordV1 {
  return {
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
        reason: "ready",
      },
      authenticated: {
        value: "authenticated",
        evidenceClass: "probed",
        reason: "ready",
      },
      current: {
        value: "current",
        evidenceClass: "probed",
        reason: "ready",
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
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "foreman-profile-lane-"));
  roots.add(root);
  const stateRoot = join(root, "state");
  const worktreeRoot = join(root, "worktree");
  mkdirSync(stateRoot, { recursive: true });
  mkdirSync(worktreeRoot, { recursive: true });
  const input: CredentialProfileInput = {
    stateRoot,
    worktreeRoot,
    profileId: "lane-a",
    vendor: "grok",
  };
  const initialized = Effect.runSync(
    initProfile(input).pipe(Effect.provide(liveCredentialProfile)),
  );
  assert.equal(initialized._tag, "Initialized");
  if (initialized._tag !== "Initialized") throw new Error("fixture_failed");
  const wrapper = makeCredentialProfilePreflight(
    initialized.profileId,
    initialized.profileIdentity,
    initialized.vendor,
    readyRecord(),
  );
  return { root, input, wrapper };
}

function runWithLayers(
  input: CredentialProfileInput,
  fs: CredentialProfileFsShape,
  store: {
    readonly read: (
      path: string,
      expected?: CredentialProfilePreflightExpected,
    ) => Effect.Effect<CredentialProfilePreflightV1, ProfilePreflightStoreFailure>;
    readonly write: (
      path: string,
      wrapper: CredentialProfilePreflightV1,
    ) => Effect.Effect<void, ProfilePreflightStoreFailure>;
  },
) {
  return Effect.runSync(
    admitCredentialProfileLane(input).pipe(
      Effect.provide(
        Layer.merge(
          Layer.succeed(CredentialProfileFs, fs),
          Layer.succeed(CredentialProfilePreflightStore, store),
        ),
      ),
    ),
  );
}

function storeReturning(wrapper: CredentialProfilePreflightV1) {
  return {
    read: () => Effect.succeed(wrapper),
    write: () => Effect.void,
  };
}

describe("admitCredentialProfileLane", () => {
  // Requires a published preflight record, so it needs the same POSIX-only
  // directory anchor the preflight store requires. See foreman-setup.test.ts.
  it("admits one ready wrapper and returns the verified config root", livePersistLane, () => {
    const f = fixture();
    Effect.runSync(
      writeProfilePreflightRecord(
        profilePreflightRecordPath(
          f.input.stateRoot,
          f.input.profileId,
          f.input.vendor,
        ),
        f.wrapper,
      ),
    );

    const result = Effect.runSync(
      admitCredentialProfileLane(f.input).pipe(
        Effect.provide(
          Layer.merge(
            liveCredentialProfile,
            liveCredentialProfilePreflightStore,
          ),
        ),
      ),
    );

    assert.deepEqual(result, {
      _tag: "Admitted",
      profileId: f.wrapper.profileId,
      vendor: f.wrapper.vendor,
      configRoot: join(
        f.input.stateRoot,
        "credential-profiles",
        f.input.profileId,
        "homes",
        f.input.vendor,
      ),
      profileIdentity: f.wrapper.profileIdentity,
    });
  });

  it("reads only the exact profile record with the exact expected binding", () => {
    const f = fixture();
    const reads: Array<{
      readonly path: string;
      readonly expected?: CredentialProfilePreflightExpected;
    }> = [];
    const store = {
      read: (path: string, expected?: CredentialProfilePreflightExpected) => {
        reads.push(expected === undefined ? { path } : { path, expected });
        return Effect.succeed(f.wrapper);
      },
      write: () => Effect.void,
    };

    const result = runWithLayers(f.input, liveCredentialProfileFs, store);

    assert.equal(result._tag, "Admitted");
    assert.deepEqual(reads, [
      {
        path: profilePreflightRecordPath(
          f.input.stateRoot,
          f.input.profileId,
          f.input.vendor,
        ),
        expected: {
          profileId: f.wrapper.profileId,
          profileIdentity: f.wrapper.profileIdentity,
          vendor: f.wrapper.vendor,
        },
      },
    ]);
  });

  for (const fact of ["discoverable", "authenticated", "current"] as const) {
    it(`refuses when ${fact} is not ready`, () => {
      const f = fixture();
      const record = readyRecord();
      const facts = {
        ...record.facts,
        [fact]: {
          ...record.facts[fact],
          value:
            fact === "discoverable"
              ? "missing"
              : fact === "authenticated"
                ? "unknown"
                : "outdated",
        },
      } as VendorPreflightRecordV1["facts"];
      const wrapper = { ...f.wrapper, record: { ...record, facts } };

      assert.deepEqual(
        runWithLayers(
          f.input,
          liveCredentialProfileFs,
          storeReturning(wrapper),
        ),
        { _tag: "Refused", reason: "preflight_not_ready" },
      );
    });
  }

  it("refuses a wrapper that does not match the resolved profile", () => {
    const f = fixture();
    const wrapper = { ...f.wrapper, profileIdentity: "f".repeat(64) };
    assert.deepEqual(
      runWithLayers(
        f.input,
        liveCredentialProfileFs,
        storeReturning(wrapper),
      ),
      { _tag: "Refused", reason: "profile_mismatch" },
    );
  });

  for (const [failure, expected] of [
    ["path_invalid", "authority_invalid"],
    ["absent", "authority_missing"],
    ["oversized", "authority_invalid"],
    ["unreadable", "unreadable"],
    ["linked_path", "linked_path"],
    ["malformed", "authority_invalid"],
    ["decode_failed", "authority_invalid"],
    ["identity_changed", "identity_changed"],
  ] as const) {
    it(`maps store ${failure} to closed reason ${expected}`, () => {
      const f = fixture();
      const store = {
        read: () => Effect.fail(new ProfilePreflightStoreFailure(failure)),
        write: () => Effect.void,
      };
      assert.deepEqual(
        runWithLayers(f.input, liveCredentialProfileFs, store),
        { _tag: "Refused", reason: expected },
      );
    });
  }

  it("re-resolves and refuses when profile authority changes", () => {
    const f = fixture();
    let profileReads = 0;
    const fs: CredentialProfileFsShape = {
      ...liveCredentialProfileFs,
      readFile: (path, maxBytes) => {
        if (path.endsWith("profile.json")) {
          profileReads += 1;
          if (profileReads === 2) return { _tag: "Unreadable" };
        }
        return liveCredentialProfileFs.readFile(path, maxBytes);
      },
    };

    assert.deepEqual(
      runWithLayers(f.input, fs, storeReturning(f.wrapper)),
      { _tag: "Refused", reason: "unreadable" },
    );
    assert.equal(profileReads, 2);
  });

  it("uses a closed refusal vocabulary", () => {
    assert.deepEqual(CREDENTIAL_PROFILE_LANE_REFUSAL_REASONS, [
      "invalid_arguments",
      "authority_missing",
      "authority_invalid",
      "profile_mismatch",
      "preflight_not_ready",
      "linked_path",
      "identity_changed",
      "unreadable",
    ]);
  });
});
