/**
 * Closed vendor-preflight contract: enums, record shape, consistency, decode.
 * Sprint 3 R4A — TDD red-first.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalize } from "@foreman/core";
import {
  AUTH_VALUES,
  CURRENCY_VALUES,
  DISCOVERABLE_VALUES,
  PROBE_KINDS,
  PROBE_OUTCOMES,
  REMEDIATION_KINDS,
  VENDOR_EVIDENCE_CLASSES,
  VENDOR_IDS,
  decodeVendorPreflightRecordV1,
  isVendorPreflightContractFailure,
  type VendorPreflightRecordV1,
} from "./vendor-preflight-contract.js";

const FIXED_TS = "2026-08-04T12:00:00.000Z";

function validDiscoverableRecord(
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
    remediation: {
      kind: "none",
      instruction: null,
    },
  };
  return { ...base, ...overrides };
}

describe("closed enum sets", () => {
  it("exports exact closed vendor and fact value domains", () => {
    assert.deepEqual([...VENDOR_IDS], ["claude", "codex", "grok", "agy"]);
    assert.deepEqual([...VENDOR_EVIDENCE_CLASSES], ["declared", "probed"]);
    assert.deepEqual(
      [...DISCOVERABLE_VALUES],
      ["discoverable", "missing", "unknown"],
    );
    assert.deepEqual(
      [...AUTH_VALUES],
      ["authenticated", "not-authenticated", "unknown"],
    );
    assert.deepEqual(
      [...CURRENCY_VALUES],
      ["current", "outdated", "unknown"],
    );
    assert.deepEqual([...PROBE_KINDS], ["version", "auth"]);
    assert.deepEqual(
      [...PROBE_OUTCOMES],
      [
        "completed",
        "timeout",
        "output_bound",
        "spawn_failed",
        "cancelled",
        "empty_output",
        "malformed_output",
        "unmatched_output",
      ],
    );
    assert.deepEqual(
      [...REMEDIATION_KINDS],
      ["none", "install", "login", "update", "diagnose"],
    );
  });
});

describe("decodeVendorPreflightRecordV1", () => {
  it("accepts a consistent discoverable authenticated current record", () => {
    const rec = validDiscoverableRecord();
    const decoded = decodeVendorPreflightRecordV1(rec);
    assert.ok(!isVendorPreflightContractFailure(decoded));
    assert.deepEqual(decoded, rec);
    const line = canonicalize(rec as unknown);
    assert.ok(line.length > 0);
  });

  it("rejects unknown keys on the record root", () => {
    const bad = { ...validDiscoverableRecord(), extra: true };
    const decoded = decodeVendorPreflightRecordV1(bad);
    assert.ok(isVendorPreflightContractFailure(decoded));
    assert.equal(decoded.reason, "unknown_field");
  });

  it("rejects blank reason strings", () => {
    const rec = validDiscoverableRecord();
    const bad = {
      ...rec,
      facts: {
        ...rec.facts,
        discoverable: {
          value: "discoverable",
          evidenceClass: "probed",
          reason: "   ",
        },
      },
    };
    const decoded = decodeVendorPreflightRecordV1(bad);
    assert.ok(isVendorPreflightContractFailure(decoded));
    assert.equal(decoded.reason, "blank_string");
  });

  it("rejects relative resolvedPath", () => {
    const bad = validDiscoverableRecord({ resolvedPath: "bin/grok" });
    const decoded = decodeVendorPreflightRecordV1(bad);
    assert.ok(isVendorPreflightContractFailure(decoded));
    assert.equal(decoded.reason, "relative_path");
  });

  it("rejects invalid timestamps", () => {
    const bad = validDiscoverableRecord({ timestamp: "2026-08-04 12:00:00" });
    const decoded = decodeVendorPreflightRecordV1(bad);
    assert.ok(isVendorPreflightContractFailure(decoded));
    assert.equal(decoded.reason, "invalid_timestamp");
  });

  it("rejects unsafe argv sizes", () => {
    const huge = "x".repeat(70_000);
    const rec = validDiscoverableRecord({
      probes: [
        {
          kind: "auth",
          argv: ["grok", huge],
          outcome: "completed",
          exitCode: 0,
        },
      ],
    });
    const decoded = decodeVendorPreflightRecordV1(rec);
    assert.ok(isVendorPreflightContractFailure(decoded));
    assert.equal(decoded.reason, "bound_exceeded");
  });

  it("rejects missing discovery with probes or absolute path", () => {
    const withPath = validDiscoverableRecord({
      resolvedPath: "/usr/bin/grok",
      facts: {
        discoverable: {
          value: "missing",
          evidenceClass: "probed",
          reason: "CLI not on PATH",
        },
        authenticated: {
          value: "unknown",
          evidenceClass: "probed",
          reason: "no auth probe after missing CLI",
        },
        current: {
          value: "unknown",
          evidenceClass: "probed",
          reason: "no version probe after missing CLI",
        },
      },
      probes: [],
      remediation: {
        kind: "install",
        instruction: "npm install -g @xai-official/grok@latest",
      },
    });
    const d1 = decodeVendorPreflightRecordV1(withPath);
    assert.ok(isVendorPreflightContractFailure(d1));
    assert.equal(d1.reason, "inconsistent_state");

    const withProbes = validDiscoverableRecord({
      resolvedPath: null,
      reportedVersion: null,
      facts: {
        discoverable: {
          value: "missing",
          evidenceClass: "probed",
          reason: "CLI not on PATH",
        },
        authenticated: {
          value: "unknown",
          evidenceClass: "probed",
          reason: "no auth probe after missing CLI",
        },
        current: {
          value: "unknown",
          evidenceClass: "probed",
          reason: "no version probe after missing CLI",
        },
      },
      probes: [
        {
          kind: "auth",
          argv: ["grok", "models"],
          outcome: "completed",
          exitCode: 0,
        },
      ],
      remediation: {
        kind: "install",
        instruction: "npm install -g @xai-official/grok@latest",
      },
    });
    const d2 = decodeVendorPreflightRecordV1(withProbes);
    assert.ok(isVendorPreflightContractFailure(d2));
    assert.equal(d2.reason, "inconsistent_state");
  });

  it("accepts a consistent missing record", () => {
    const rec: VendorPreflightRecordV1 = {
      schemaVersion: 1,
      vendor: "grok",
      timestamp: FIXED_TS,
      resolvedPath: null,
      reportedVersion: null,
      versionFloor: "0.2.118",
      facts: {
        discoverable: {
          value: "missing",
          evidenceClass: "probed",
          reason: "CLI not on PATH",
        },
        authenticated: {
          value: "unknown",
          evidenceClass: "probed",
          reason: "no auth probe after missing CLI",
        },
        current: {
          value: "unknown",
          evidenceClass: "probed",
          reason: "no version probe after missing CLI",
        },
      },
      probes: [],
      remediation: {
        kind: "install",
        instruction: "npm install -g @xai-official/grok@latest",
      },
    };
    const decoded = decodeVendorPreflightRecordV1(rec);
    assert.ok(!isVendorPreflightContractFailure(decoded));
  });

  it("rejects not-authenticated with login remediation inverted or unknown auth with login", () => {
    const rec = validDiscoverableRecord({
      facts: {
        discoverable: {
          value: "discoverable",
          evidenceClass: "probed",
          reason: "CLI resolved on PATH",
        },
        authenticated: {
          value: "unknown",
          evidenceClass: "probed",
          reason: "auth probe timed out",
        },
        current: {
          value: "unknown",
          evidenceClass: "probed",
          reason: "version not evaluated",
        },
      },
      probes: [
        {
          kind: "auth",
          argv: ["grok", "models"],
          outcome: "timeout",
          exitCode: null,
        },
      ],
      remediation: {
        kind: "login",
        instruction: "grok login --device-code",
      },
    });
    const decoded = decodeVendorPreflightRecordV1(rec);
    assert.ok(isVendorPreflightContractFailure(decoded));
    assert.equal(decoded.reason, "inconsistent_state");
  });

  it("rejects every non-none remediation whose instruction is null", () => {
    for (const kind of ["install", "login", "update", "diagnose"] as const) {
      const rec = validDiscoverableRecord({
        facts: {
          discoverable: {
            value: "discoverable",
            evidenceClass: "probed",
            reason: "CLI resolved on PATH",
          },
          authenticated: {
            value: kind === "login" ? "not-authenticated" : "authenticated",
            evidenceClass: "probed",
            reason:
              kind === "login"
                ? "signed out"
                : "auth probe matched positive marker",
          },
          current: {
            value: kind === "update" ? "outdated" : "current",
            evidenceClass: "probed",
            reason:
              kind === "update"
                ? "below floor"
                : "reported version meets floor",
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
        remediation: { kind, instruction: null },
      });
      const decoded = decodeVendorPreflightRecordV1(rec);
      assert.ok(
        isVendorPreflightContractFailure(decoded),
        `expected reject for remediation kind ${kind} with null instruction`,
      );
      assert.equal(decoded.reason, "inconsistent_state");
    }
  });

  it("rejects a none remediation whose instruction is non-null", () => {
    const rec = validDiscoverableRecord({
      remediation: {
        kind: "none",
        instruction: "should not be present",
      },
    });
    const decoded = decodeVendorPreflightRecordV1(rec);
    assert.ok(isVendorPreflightContractFailure(decoded));
    assert.equal(decoded.reason, "inconsistent_state");
  });

  it("rejects not-authenticated paired with any remediation other than login", () => {
    for (const kind of ["none", "install", "update", "diagnose"] as const) {
      const rec = validDiscoverableRecord({
        facts: {
          discoverable: {
            value: "discoverable",
            evidenceClass: "probed",
            reason: "CLI resolved on PATH",
          },
          authenticated: {
            value: "not-authenticated",
            evidenceClass: "probed",
            reason: "signed out",
          },
          current: {
            value: "unknown",
            evidenceClass: "probed",
            reason: "currency not evaluated after signed-out",
          },
        },
        reportedVersion: null,
        probes: [
          {
            kind: "auth",
            argv: ["grok", "models"],
            outcome: "completed",
            exitCode: 0,
          },
        ],
        remediation: {
          kind,
          instruction: kind === "none" ? null : "some instruction",
        },
      });
      const decoded = decodeVendorPreflightRecordV1(rec);
      assert.ok(
        isVendorPreflightContractFailure(decoded),
        `expected reject for not-authenticated with remediation ${kind}`,
      );
      assert.equal(decoded.reason, "inconsistent_state");
    }
  });

  it("rejects login remediation paired with authentication other than not-authenticated", () => {
    for (const auth of ["authenticated", "unknown"] as const) {
      const rec = validDiscoverableRecord({
        facts: {
          discoverable: {
            value: "discoverable",
            evidenceClass: "probed",
            reason: "CLI resolved on PATH",
          },
          authenticated: {
            value: auth,
            evidenceClass: "probed",
            reason: auth === "unknown" ? "timeout" : "logged in",
          },
          current: {
            value: "unknown",
            evidenceClass: "probed",
            reason: "version not evaluated",
          },
        },
        reportedVersion: null,
        probes: [
          {
            kind: "auth",
            argv: ["grok", "models"],
            outcome: auth === "unknown" ? "timeout" : "completed",
            exitCode: auth === "unknown" ? null : 0,
          },
        ],
        remediation: {
          kind: "login",
          instruction: "grok login --device-code",
        },
      });
      const decoded = decodeVendorPreflightRecordV1(rec);
      assert.ok(
        isVendorPreflightContractFailure(decoded),
        `expected reject for login remediation with auth ${auth}`,
      );
      assert.equal(decoded.reason, "inconsistent_state");
    }
  });

  it("accepts not-authenticated with login remediation and completed auth probe", () => {
    const rec = validDiscoverableRecord({
      facts: {
        discoverable: {
          value: "discoverable",
          evidenceClass: "probed",
          reason: "CLI resolved on PATH",
        },
        authenticated: {
          value: "not-authenticated",
          evidenceClass: "probed",
          reason: "signed out",
        },
        current: {
          value: "current",
          evidenceClass: "probed",
          reason: "meets floor",
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
      remediation: {
        kind: "login",
        instruction: "grok login --device-code",
      },
    });
    const decoded = decodeVendorPreflightRecordV1(rec);
    assert.ok(!isVendorPreflightContractFailure(decoded));
  });

  it("rejects invalid enum values", () => {
    const rec = validDiscoverableRecord();
    const bad = {
      ...rec,
      vendor: "gemini",
    };
    const decoded = decodeVendorPreflightRecordV1(bad);
    assert.ok(isVendorPreflightContractFailure(decoded));
    assert.equal(decoded.reason, "invalid_enum");
  });
});
