/**
 * R7B2-A: strict profile-bound lane admission CLI — RED-first tests.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { Effect, Layer } from "effect";
import {
  initProfile,
  liveCredentialProfile,
  type CredentialProfileInput,
} from "./credential-profile.js";
import {
  CredentialProfilePreflightStore,
  makeCredentialProfilePreflight,
} from "./credential-profile-preflight.js";
import {
  CREDENTIAL_PROFILE_LANE_EXIT_OK,
  CREDENTIAL_PROFILE_LANE_EXIT_REFUSED,
  parseCredentialProfileLaneArgv,
  runCredentialProfileLaneCli,
} from "./credential-profile-lane-cli.js";
import type { VendorPreflightRecordV1 } from "./vendor-preflight-contract.js";

const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

function captureIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      writeStdout: (text: string) => {
        stdout += text;
      },
      writeStderr: (text: string) => {
        stderr += text;
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function argv(input: CredentialProfileInput): readonly string[] {
  return [
    "admit",
    "--state-root",
    input.stateRoot,
    "--worktree",
    input.worktreeRoot,
    "--profile",
    input.profileId,
    "--vendor",
    input.vendor,
  ];
}

function readyRecord(): VendorPreflightRecordV1 {
  return {
    schemaVersion: 1,
    vendor: "grok",
    timestamp: "2026-08-05T15:00:00Z",
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

function makeInput(): {
  readonly root: string;
  readonly input: CredentialProfileInput;
} {
  const root = mkdtempSync(join(tmpdir(), "foreman-profile-lane-cli-"));
  roots.add(root);
  const stateRoot = join(root, "state");
  const worktreeRoot = join(root, "worktree");
  mkdirSync(stateRoot, { recursive: true });
  mkdirSync(worktreeRoot, { recursive: true });
  return {
    root,
    input: {
      stateRoot,
      worktreeRoot,
      profileId: "lane-a",
      vendor: "grok",
    },
  };
}

describe("parseCredentialProfileLaneArgv", () => {
  it("accepts only the exact ordered admit command", () => {
    const { input } = makeInput();
    assert.deepEqual(parseCredentialProfileLaneArgv(argv(input)), {
      _tag: "Ok",
      input,
    });
  });

  for (const bad of [
    [],
    ["resolve"],
    ["admit"],
    [
      "admit",
      "--worktree",
      "/worktree",
      "--state-root",
      "/state",
      "--profile",
      "p",
      "--vendor",
      "grok",
    ],
    [
      "admit",
      "--state-root",
      "/state",
      "--state-root",
      "/other",
      "--profile",
      "p",
      "--vendor",
      "grok",
    ],
    [
      "admit",
      "--state-root",
      "relative",
      "--worktree",
      "/worktree",
      "--profile",
      "p",
      "--vendor",
      "grok",
    ],
    [
      "admit",
      "--state-root",
      "/state",
      "--worktree",
      "/worktree",
      "--profile",
      ".bad",
      "--vendor",
      "grok",
    ],
    [
      "admit",
      "--state-root",
      "/state",
      "--worktree",
      "/worktree",
      "--profile",
      "p",
      "--vendor",
      "claude",
    ],
    [
      "admit",
      "--state-root",
      "/state\nsecret",
      "--worktree",
      "/worktree",
      "--profile",
      "p",
      "--vendor",
      "grok",
    ],
    [
      "admit",
      "--state-root",
      "/state\rsecret",
      "--worktree",
      "/worktree",
      "--profile",
      "p",
      "--vendor",
      "grok",
    ],
    [
      "admit",
      "--state-root",
      "/state\0secret",
      "--worktree",
      "/worktree",
      "--profile",
      "p",
      "--vendor",
      "grok",
    ],
  ] as const) {
    it(`rejects invalid argv ${JSON.stringify(bad)}`, () => {
      assert.deepEqual(parseCredentialProfileLaneArgv(bad), {
        _tag: "Invalid",
      });
    });
  }
});

describe("runCredentialProfileLaneCli", () => {
  it("emits only the verified config root and one LF on success", () => {
    const { input } = makeInput();
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
    const store = Layer.succeed(CredentialProfilePreflightStore, {
      read: () => Effect.succeed(wrapper),
      write: () => Effect.void,
    });
    const cap = captureIo();

    const code = Effect.runSync(
      runCredentialProfileLaneCli(argv(input), cap.io).pipe(
        Effect.provide(Layer.merge(liveCredentialProfile, store)),
      ),
    );

    assert.equal(code, CREDENTIAL_PROFILE_LANE_EXIT_OK);
    assert.equal(cap.stdout(), initialized.configRoot + "\n");
    assert.equal(cap.stderr(), "");
  });

  it("emits one closed refusal and does not leak invalid input", () => {
    const cap = captureIo();
    const secret = "/secret/path\ncredential-bytes";
    const code = Effect.runSync(
      runCredentialProfileLaneCli(
        [
          "admit",
          "--state-root",
          secret,
          "--worktree",
          "/worktree",
          "--profile",
          "p",
          "--vendor",
          "grok",
        ],
        cap.io,
      ).pipe(
        Effect.provide(
          Layer.merge(
            liveCredentialProfile,
            Layer.succeed(CredentialProfilePreflightStore, {
              read: () =>
                Effect.fail(new Error("must_not_read")) as never,
              write: () => Effect.void,
            }),
          ),
        ),
      ),
    );

    assert.equal(code, CREDENTIAL_PROFILE_LANE_EXIT_REFUSED);
    assert.equal(cap.stdout(), "");
    assert.equal(
      cap.stderr(),
      "Foreman credential profile lane refused: invalid_arguments\n",
    );
    assert.equal(cap.stderr().includes(secret), false);
    assert.equal(cap.stderr().includes("credential-bytes"), false);
  });
});
