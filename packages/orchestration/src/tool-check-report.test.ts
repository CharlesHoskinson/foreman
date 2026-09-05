/**
 * Report rendering, inventory schema, profile membership, lane readiness.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInventoryJson,
  laneReadyFromTools,
  profileToolIds,
  renderInventoryJson,
  renderReportText,
  type ReportModel,
  type ToolRow,
} from "./tool-check-report.js";

const baseTools: ToolRow[] = [
  { id: "git", status: "ok", detail: "git version 2.43" },
  { id: "grok", status: "not_authenticated", detail: "run: grok login --device-code" },
  { id: "codex", status: "ok", detail: "0.146.0" },
  { id: "strace", status: "missing", detail: "lock atomicity cannot be licensed" },
];

function model(overrides: Partial<ReportModel> = {}): ReportModel {
  return {
    profile: "soft",
    host: "testhost",
    os: "Linux",
    wsl: false,
    time: "2026-08-04T12:00:00Z",
    repo: "/repo",
    tools: baseTools,
    skills: [{ id: "foreman", status: "ok", detail: "linked" }],
    lockAtomicity: [
      {
        mechanism: "mkdir",
        path: "/bin/mkdir",
        version: "mkdir (GNU coreutils) 9.7",
        sha256: "abc",
        verdict: "unknown",
        evidence_class: "syscall",
        filesystem_classes: ["local"],
        timestamp: "2026-08-04T12:00:00Z",
        notes: "tracer did not run (strace exit=125; no trace output)",
      },
    ],
    lockAtomicityInfo: ["NOT-READY risk: no lock mechanism earned a trusted atomic verdict on this host"],
    ready: false,
    mustFail: ["grok:not_authenticated", "strace:missing"],
    lane: "grok",
    ...overrides,
  };
}

describe("laneReadyFromTools", () => {
  it("returns null without lane", () => {
    assert.equal(laneReadyFromTools(baseTools, null), null);
  });
  it("yes only when lane status is ok", () => {
    assert.equal(laneReadyFromTools(baseTools, "grok"), false);
    assert.equal(laneReadyFromTools(baseTools, "codex"), true);
  });
});

describe("buildInventoryJson", () => {
  it("emits foreman.tool-check.v1 with status arrays and lane", () => {
    const inv = buildInventoryJson(model());
    assert.equal(inv.schema, "foreman.tool-check.v1");
    assert.equal(inv.ready, false);
    assert.deepEqual(inv.not_authenticated, ["grok"]);
    assert.deepEqual(inv.missing, ["strace"]);
    assert.equal(inv.lane, "grok");
    assert.equal(inv.lane_ready, false);
    assert.equal(inv.lock_atomicity.length, 1);
    assert.equal(inv.lock_atomicity[0]!.evidence_class, "syscall");
  });

  it("omits lane fields when no lane", () => {
    const inv = buildInventoryJson(model({ lane: null }));
    assert.equal("lane" in inv, false);
    assert.equal("lane_ready" in inv, false);
  });

  it("pretty JSON is parseable", () => {
    const text = renderInventoryJson(model());
    const parsed = JSON.parse(text) as { schema: string };
    assert.equal(parsed.schema, "foreman.tool-check.v1");
  });
});

describe("renderReportText", () => {
  it("includes READY, NOT_AUTHENTICATED, LANE_READY, NEXT", () => {
    const text = renderReportText(model());
    assert.match(text, /FOREMAN TOOL CHECK/);
    assert.match(text, /READY: no/);
    assert.match(text, /NOT_AUTHENTICATED: grok/);
    assert.match(text, /MISSING: strace/);
    assert.match(text, /LANE_READY: grok=no/);
    assert.match(text, /LOCK_ATOMICITY/);
    assert.match(text, /SKILLS/);
    assert.match(text, /NEXT:/);
    assert.match(text, /bootstrap-wsl/);
  });

  it("READY yes path omits MUST_FAIL and uses proceed guidance", () => {
    const text = renderReportText(
      model({
        ready: true,
        mustFail: [],
        tools: [
          { id: "git", status: "ok", detail: "ok" },
          { id: "grok", status: "ok", detail: "ok" },
        ],
        lane: null,
      }),
    );
    assert.match(text, /READY: yes/);
    assert.doesNotMatch(text, /MUST_FAIL:/);
    assert.doesNotMatch(text, /LANE_READY:/);
    assert.match(text, /proceed with \/foreman/);
  });

  it("shows LANE_READY yes when lane ok", () => {
    const text = renderReportText(
      model({
        tools: [{ id: "grok", status: "ok", detail: "ready" }],
        lane: "grok",
        ready: true,
        mustFail: [],
      }),
    );
    assert.match(text, /LANE_READY: grok=yes/);
  });
});

describe("profileToolIds", () => {
  it("soft must includes grok codex strace; should includes node", () => {
    const { must, should } = profileToolIds("soft", false);
    assert.ok(must.includes("grok") && must.includes("codex") && must.includes("strace"));
    assert.ok(should.includes("node"));
    assert.ok(!should.includes("foreman-launch"));
  });

  it("WSL adds foreman-launch and containment to should", () => {
    const { must, should } = profileToolIds("soft", true);
    assert.ok(should.includes("foreman-launch"));
    assert.ok(should.includes("containment"));
    assert.ok(!must.includes("containment"));
  });

  it("durable must excludes vendors", () => {
    const { must } = profileToolIds("durable", false);
    assert.ok(!must.includes("grok"));
    assert.ok(must.includes("flock"));
  });
});
