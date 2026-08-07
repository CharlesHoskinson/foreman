/**
 * Pure projection: VendorPreflightRecordV1 → tool-check row (Sprint 3 R4B).
 * TDD red-first — these tests define the adapter status contract.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VendorPreflightRecordV1 } from "./vendor-preflight-contract.js";
import {
  MAX_TOOL_CHECK_DETAIL_BYTES,
  formatToolCheckRowTsv,
  projectVendorPreflightToToolCheckRow,
  sanitizeToolCheckDetail,
  type ToolCheckRowV1,
} from "./vendor-preflight-tool-check.js";

const FIXED_TS = "2026-08-04T15:00:00.000Z";

function baseRecord(
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
  return {
    ...base,
    ...overrides,
    facts: overrides.facts ?? base.facts,
    probes: overrides.probes ?? base.probes,
    remediation: overrides.remediation ?? base.remediation,
  };
}

function assertNoLoginInstruction(detail: string): void {
  assert.ok(
    !/login/i.test(detail),
    `detail must not contain a login instruction: ${detail}`,
  );
}

describe("projectVendorPreflightToToolCheckRow", () => {
  it("authenticated and current -> ok", () => {
    const row = projectVendorPreflightToToolCheckRow(baseRecord());
    assert.equal(row.vendor, "grok");
    assert.equal(row.status, "ok");
    assert.ok(row.detail.length > 0);
    assert.ok(!row.detail.includes("\t"));
    assert.ok(!row.detail.includes("\n"));
  });

  it("authenticated and outdated -> outdated, not signed out", () => {
    const rec = baseRecord({
      reportedVersion: "0.2.100",
      facts: {
        discoverable: {
          value: "discoverable",
          evidenceClass: "probed",
          reason: "CLI resolved",
        },
        authenticated: {
          value: "authenticated",
          evidenceClass: "probed",
          reason: "signed in",
        },
        current: {
          value: "outdated",
          evidenceClass: "probed",
          reason: "reported 0.2.100 is below floor 0.2.118",
        },
      },
      remediation: {
        kind: "update",
        instruction: "npm install -g @xai-official/grok@latest",
      },
    });
    const row = projectVendorPreflightToToolCheckRow(rec);
    assert.equal(row.status, "outdated");
    assert.notEqual(row.status, "not_authenticated");
    assertNoLoginInstruction(row.detail);
    assert.match(row.detail, /npm install -g @xai-official\/grok@latest|0\.2\.100|outdated/i);
  });

  it("positive signed-out evidence -> not_authenticated plus login detail", () => {
    const rec = baseRecord({
      facts: {
        discoverable: {
          value: "discoverable",
          evidenceClass: "probed",
          reason: "CLI resolved",
        },
        authenticated: {
          value: "not-authenticated",
          evidenceClass: "probed",
          reason: "grok models matched a recognized signed-out marker",
        },
        current: {
          value: "current",
          evidenceClass: "probed",
          reason: "meets floor",
        },
      },
      remediation: {
        kind: "login",
        instruction: "grok login --device-code",
      },
    });
    const row = projectVendorPreflightToToolCheckRow(rec);
    assert.equal(row.status, "not_authenticated");
    assert.match(row.detail, /grok login --device-code/);
  });

  it("auth timeout -> degraded, diagnose detail, no login instruction", () => {
    const rec = baseRecord({
      reportedVersion: "0.2.118",
      facts: {
        discoverable: {
          value: "discoverable",
          evidenceClass: "probed",
          reason: "CLI resolved",
        },
        authenticated: {
          value: "unknown",
          evidenceClass: "probed",
          reason: "grok models probe outcome timeout",
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
          outcome: "timeout",
          exitCode: null,
        },
      ],
      remediation: {
        kind: "diagnose",
        instruction:
          "Re-run bounded grok models; inspect network, leader socket, and CLI health",
      },
    });
    const row = projectVendorPreflightToToolCheckRow(rec);
    assert.equal(row.status, "degraded");
    assertNoLoginInstruction(row.detail);
    assert.match(row.detail, /Re-run bounded grok models|timeout|diagnose|inspect/i);
  });

  it("unmatched or malformed auth output -> degraded, no login instruction", () => {
    const rec = baseRecord({
      facts: {
        discoverable: {
          value: "discoverable",
          evidenceClass: "probed",
          reason: "CLI resolved",
        },
        authenticated: {
          value: "unknown",
          evidenceClass: "probed",
          reason:
            "grok models output matched neither the positive logged-in marker nor a recognized signed-out marker",
        },
        current: {
          value: "current",
          evidenceClass: "probed",
          reason: "meets floor",
        },
      },
      remediation: {
        kind: "diagnose",
        instruction:
          "Re-run bounded grok models; inspect network, leader socket, and CLI health",
      },
    });
    const row = projectVendorPreflightToToolCheckRow(rec);
    assert.equal(row.status, "degraded");
    assertNoLoginInstruction(row.detail);
  });

  it("missing executable -> missing", () => {
    const rec: VendorPreflightRecordV1 = {
      schemaVersion: 1,
      vendor: "codex",
      timestamp: FIXED_TS,
      resolvedPath: null,
      reportedVersion: null,
      versionFloor: "0.146.0",
      facts: {
        discoverable: {
          value: "missing",
          evidenceClass: "declared",
          reason: "CLI codex not found on PATH",
        },
        authenticated: {
          value: "unknown",
          evidenceClass: "declared",
          reason: "no auth probe after missing CLI",
        },
        current: {
          value: "unknown",
          evidenceClass: "declared",
          reason: "no version probe after missing CLI",
        },
      },
      probes: [],
      remediation: {
        kind: "install",
        instruction: "npm install -g @openai/codex@latest",
      },
    };
    const row = projectVendorPreflightToToolCheckRow(rec);
    assert.equal(row.vendor, "codex");
    assert.equal(row.status, "missing");
    assert.match(row.detail, /npm install -g @openai\/codex@latest|not found/i);
    assertNoLoginInstruction(row.detail);
  });

  it("currency unknown -> degraded", () => {
    const rec = baseRecord({
      reportedVersion: null,
      facts: {
        discoverable: {
          value: "discoverable",
          evidenceClass: "probed",
          reason: "CLI resolved",
        },
        authenticated: {
          value: "authenticated",
          evidenceClass: "probed",
          reason: "signed in",
        },
        current: {
          value: "unknown",
          evidenceClass: "probed",
          reason: "version probe outcome timeout",
        },
      },
      probes: [
        {
          kind: "version",
          argv: ["grok", "--version"],
          outcome: "timeout",
          exitCode: null,
        },
        {
          kind: "auth",
          argv: ["grok", "models"],
          outcome: "completed",
          exitCode: 0,
        },
      ],
      remediation: {
        kind: "diagnose",
        instruction:
          "Re-run bounded grok models; inspect network, leader socket, and CLI health",
      },
    });
    const row = projectVendorPreflightToToolCheckRow(rec);
    assert.equal(row.status, "degraded");
    assertNoLoginInstruction(row.detail);
  });

  it("detail containing tabs or newlines is made into one safe bounded field", () => {
    const rec = baseRecord({
      facts: {
        discoverable: {
          value: "discoverable",
          evidenceClass: "probed",
          reason: "CLI resolved",
        },
        authenticated: {
          value: "unknown",
          evidenceClass: "probed",
          reason: "auth failed\nwith\ttabs\rand newlines",
        },
        current: {
          value: "unknown",
          evidenceClass: "probed",
          reason: "currency unknown",
        },
      },
      remediation: {
        kind: "diagnose",
        instruction: "line1\nline2\twith\ttab\rand\r\nCRLF",
      },
    });
    const row = projectVendorPreflightToToolCheckRow(rec);
    assert.equal(row.status, "degraded");
    assert.ok(!row.detail.includes("\t"));
    assert.ok(!row.detail.includes("\n"));
    assert.ok(!row.detail.includes("\r"));
    assert.ok(
      Buffer.byteLength(row.detail, "utf8") <= MAX_TOOL_CHECK_DETAIL_BYTES,
    );
  });
});

describe("sanitizeToolCheckDetail", () => {
  it("strips tab CR LF and bounds length", () => {
    const dirty = "a\tb\nc\rd" + "x".repeat(2000);
    const clean = sanitizeToolCheckDetail(dirty);
    assert.ok(!/[\t\r\n]/.test(clean));
    assert.ok(Buffer.byteLength(clean, "utf8") <= MAX_TOOL_CHECK_DETAIL_BYTES);
  });
});

describe("formatToolCheckRowTsv", () => {
  it("writes vendor status detail without trailing LF", () => {
    const row: ToolCheckRowV1 = {
      vendor: "grok",
      status: "ok",
      detail: "0.2.118",
    };
    const line = formatToolCheckRowTsv(row);
    assert.equal(line, "grok\tok\t0.2.118");
    assert.ok(!line.endsWith("\n"));
  });
});
