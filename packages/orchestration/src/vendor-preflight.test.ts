/**
 * Pure classification: semver, auth adapters, remediation priority.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VendorCapabilityV1 } from "./vendor-preflight-manifest.js";
import {
  classifyAuthForVendor,
  classifyClaudeAuth,
  classifyCodexAuth,
  classifyCurrency,
  classifyGrokAuth,
  compareSemVer,
  decideRemediation,
  parseFirstSemVer,
} from "./vendor-preflight.js";

const grokCap: VendorCapabilityV1 = {
  vendor: "grok",
  cliName: "grok",
  evidenceClass: "probed",
  authArgv: ["models"],
  versionArgv: ["--version"],
  versionFloor: "0.2.118",
  authPositiveMarkers: ["You are logged in with grok.com."],
  authNegativeMarkers: ["not authenticated", "sign in", "log in"],
  updateMutates: true,
  updateCheckArgv: ["update", "--check", "--json"],
  loginInstruction: "grok login --device-code",
  installInstruction: "npm install -g @xai-official/grok@latest",
  updateInstruction: "npm install -g @xai-official/grok@latest",
  diagnoseInstruction: "Re-run bounded grok models",
};

const codexCap: VendorCapabilityV1 = {
  vendor: "codex",
  cliName: "codex",
  evidenceClass: "declared",
  authArgv: ["login", "status"],
  versionArgv: ["--version"],
  versionFloor: "0.146.0",
  authPositiveMarkers: [],
  authNegativeMarkers: ["Not logged in"],
  updateMutates: true,
  updateCheckArgv: null,
  loginInstruction: "codex login",
  installInstruction: "npm install -g @openai/codex@latest",
  updateInstruction: "npm install -g @openai/codex@latest",
  diagnoseInstruction: "Re-run codex login status",
};

const claudeCap: VendorCapabilityV1 = {
  vendor: "claude",
  cliName: "claude",
  evidenceClass: "declared",
  authArgv: ["auth", "status"],
  versionArgv: ["--version"],
  versionFloor: "2.1.220",
  authPositiveMarkers: [],
  authNegativeMarkers: [],
  updateMutates: true,
  updateCheckArgv: null,
  loginInstruction: "claude auth login",
  installInstruction: "Install Claude Code",
  updateInstruction: "claude update",
  diagnoseInstruction: "Re-run claude auth status",
};

describe("parseFirstSemVer / compareSemVer", () => {
  it("parses first standalone token with optional v prefix", () => {
    assert.deepEqual(parseFirstSemVer("claude 2.1.220 (Claude Code)"), {
      major: 2,
      minor: 1,
      patch: 220,
      prerelease: [],
    });
    assert.deepEqual(parseFirstSemVer("v0.2.118"), {
      major: 0,
      minor: 2,
      patch: 118,
      prerelease: [],
    });
    assert.deepEqual(parseFirstSemVer("1.2.3-beta.1+build"), {
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ["beta", 1],
    });
    assert.equal(parseFirstSemVer("no version here"), null);
    assert.equal(parseFirstSemVer(""), null);
    assert.equal(parseFirstSemVer(null), null);
  });

  it("compares prerelease by SemVer precedence; final after prerelease", () => {
    const a = parseFirstSemVer("1.0.0-alpha")!;
    const b = parseFirstSemVer("1.0.0-alpha.1")!;
    const c = parseFirstSemVer("1.0.0-beta")!;
    const d = parseFirstSemVer("1.0.0")!;
    assert.ok(compareSemVer(a, b) < 0);
    assert.ok(compareSemVer(b, c) < 0);
    assert.ok(compareSemVer(c, d) < 0);
    assert.ok(compareSemVer(d, c) > 0);
    assert.equal(compareSemVer(d, parseFirstSemVer("1.0.0")!), 0);
    // Never lexical: 1.0.0-beta vs 1.0.0-alpha numerically by identifier rules
    assert.ok(compareSemVer(c, a) > 0);
  });

  it("rejects extra numeric components, leading-zero numeric prerelease, and unsafe numeric ids", () => {
    // Must not extract 1.2.3 from a four-component token.
    assert.equal(parseFirstSemVer("1.2.3.4"), null);
    assert.equal(parseFirstSemVer("version 1.2.3.4 released"), null);
    // Numeric prerelease identifiers with leading zeroes are invalid.
    assert.equal(parseFirstSemVer("1.2.3-01"), null);
    assert.equal(parseFirstSemVer("1.2.3-1.01"), null);
    // Oversized numeric core / prerelease that cannot be a safe integer.
    assert.equal(parseFirstSemVer("1.2.3-" + "9".repeat(20)), null);
    assert.equal(
      parseFirstSemVer("9007199254740993.0.0"),
      null,
    );
    // Still accepts valid optional v, build metadata, and first standalone token.
    assert.deepEqual(parseFirstSemVer("tool v1.2.3+build.7 next"), {
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
    assert.deepEqual(parseFirstSemVer("1.2.3-beta.0"), {
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ["beta", 0],
    });
  });

  it("accepts only valid SemVer build metadata identifiers", () => {
    // Leading, trailing, and doubled dots are invalid when + is present.
    assert.equal(parseFirstSemVer("1.2.3+foo..bar"), null);
    assert.equal(parseFirstSemVer("1.2.3+foo."), null);
    assert.equal(parseFirstSemVer("1.2.3+."), null);
    assert.equal(parseFirstSemVer("1.2.3+"), null);
    assert.equal(parseFirstSemVer("1.2.3+.bar"), null);
    // Empty build after + is invalid; bare + must not yield a core match.
    assert.equal(parseFirstSemVer("tool 1.2.3+ end"), null);
    // Valid build: nonempty dot-separated alnum/hyphen ids; leading zeroes OK.
    assert.deepEqual(parseFirstSemVer("1.2.3+build.007"), {
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
    assert.deepEqual(parseFirstSemVer("1.2.3-beta.1+exp.sha.5114f85"), {
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ["beta", 1],
    });
    // Build metadata is precedence-neutral (ignored in compare).
    const a = parseFirstSemVer("1.0.0+aaa")!;
    const b = parseFirstSemVer("1.0.0+zzz")!;
    assert.equal(compareSemVer(a, b), 0);
  });
});

describe("classifyCurrency", () => {
  it("marks outdated without changing auth responsibility", () => {
    const r = classifyCurrency("0.2.100", "0.2.118", "completed");
    assert.equal(r.value, "outdated");
    assert.match(r.reason, /0\.2\.100/);
    assert.equal(r.reportedVersion, "0.2.100");
  });

  it("marks current when equal or above floor", () => {
    assert.equal(
      classifyCurrency("0.2.118", "0.2.118", "completed").value,
      "current",
    );
    assert.equal(
      classifyCurrency("v0.3.0", "0.2.118", "completed").value,
      "current",
    );
  });

  it("yields unknown on unparsable or failed probe", () => {
    assert.equal(
      classifyCurrency("not-a-version", "0.2.118", "completed").value,
      "unknown",
    );
    assert.equal(
      classifyCurrency("0.2.118", "0.2.118", "timeout").value,
      "unknown",
    );
    assert.equal(classifyCurrency(null, "0.2.118", null).value, "unknown");
  });
});

describe("auth classifiers", () => {
  it("Grok timeout path is represented as unknown with timeout reason (via outcome)", () => {
    const r = classifyGrokAuth(
      "",
      "",
      null,
      "timeout",
      grokCap.authPositiveMarkers,
      grokCap.authNegativeMarkers,
    );
    assert.equal(r.value, "unknown");
    assert.match(r.reason, /timeout/);
  });

  it("Grok recognized signed-out signal is not-authenticated", () => {
    const r = classifyGrokAuth(
      "",
      "You are not authenticated.\n",
      1,
      "completed",
      grokCap.authPositiveMarkers,
      grokCap.authNegativeMarkers,
    );
    assert.equal(r.value, "not-authenticated");
  });

  it("Grok unmatched zero-exit banner is unknown", () => {
    const r = classifyGrokAuth(
      "ERROR: something went wrong, please retry\n",
      "",
      0,
      "completed",
      grokCap.authPositiveMarkers,
      grokCap.authNegativeMarkers,
    );
    assert.equal(r.value, "unknown");
    assert.match(r.reason, /did not match/);
  });

  it("Grok positive marker authenticates", () => {
    const r = classifyGrokAuth(
      "FOREMAN_GROK_READY_V1\n",
      "",
      0,
      "completed",
      ["FOREMAN_GROK_READY_V1"],
      grokCap.authNegativeMarkers,
    );
    assert.equal(r.value, "authenticated");
  });

  it("Grok success token must be the complete trimmed stdout, not a substring", () => {
    const r = classifyGrokAuth(
      "prefix FOREMAN_GROK_READY_V1 suffix\n",
      "",
      0,
      "completed",
      ["FOREMAN_GROK_READY_V1"],
      grokCap.authNegativeMarkers,
    );
    assert.equal(r.value, "unknown");
  });

  it("Grok success token with a nonzero exit is not authenticated", () => {
    const r = classifyGrokAuth(
      "FOREMAN_GROK_READY_V1\n",
      "",
      1,
      "completed",
      ["FOREMAN_GROK_READY_V1"],
      grokCap.authNegativeMarkers,
    );
    assert.equal(r.value, "unknown");
  });

  it("Grok success token with stderr noise is not authenticated", () => {
    const r = classifyGrokAuth(
      "FOREMAN_GROK_READY_V1\n",
      "provider warning\n",
      0,
      "completed",
      ["FOREMAN_GROK_READY_V1"],
      grokCap.authNegativeMarkers,
    );
    assert.equal(r.value, "unknown");
    assert.match(r.reason, /unexpected stderr/);
  });

  it("model-generated sign-out words on successful stdout stay unknown", () => {
    const r = classifyGrokAuth(
      "Please sign in before continuing.\n",
      "",
      0,
      "completed",
      ["FOREMAN_GROK_READY_V1"],
      grokCap.authNegativeMarkers,
    );
    assert.equal(r.value, "unknown");
  });

  it("negative markers win over positive substrings", () => {
    const r = classifyGrokAuth(
      "FOREMAN_GROK_READY_V1\n",
      "You are not authenticated.\n",
      1,
      "completed",
      ["FOREMAN_GROK_READY_V1"],
      grokCap.authNegativeMarkers,
    );
    assert.equal(r.value, "not-authenticated");
  });

  it("Claude valid loggedIn JSON and malformed JSON", () => {
    const ok = classifyClaudeAuth(
      JSON.stringify({ loggedIn: true }),
      "",
      0,
      "completed",
    );
    assert.equal(ok.value, "authenticated");
    const signedOut = classifyClaudeAuth(
      JSON.stringify({ loggedIn: false }),
      "",
      0,
      "completed",
    );
    assert.equal(signedOut.value, "not-authenticated");
    const bad = classifyClaudeAuth("not-json", "", 0, "completed");
    assert.equal(bad.value, "unknown");
    assert.match(bad.reason, /malformed JSON/);
  });

  it("Codex recognized signed-out nonzero vs unrecognized nonzero", () => {
    const signedOut = classifyCodexAuth(
      "Not logged in\n",
      "",
      1,
      "completed",
      codexCap.authNegativeMarkers,
    );
    assert.equal(signedOut.value, "not-authenticated");
    const unknown = classifyCodexAuth(
      "daemon exploded\n",
      "",
      1,
      "completed",
      codexCap.authNegativeMarkers,
    );
    assert.equal(unknown.value, "unknown");
    const authed = classifyCodexAuth(
      "Logged in using ChatGPT\n",
      "",
      0,
      "completed",
      codexCap.authNegativeMarkers,
    );
    assert.equal(authed.value, "authenticated");
  });

  it("classifyAuthForVendor dispatches by vendor", () => {
    const r = classifyAuthForVendor(
      "claude",
      '{"loggedIn":true}',
      "",
      0,
      "completed",
      claudeCap,
    );
    assert.equal(r.value, "authenticated");
  });
});

describe("decideRemediation priority", () => {
  it("orders install > login > diagnose(auth) > update > diagnose(currency) > none", () => {
    assert.equal(
      decideRemediation("missing", "unknown", "unknown", grokCap).kind,
      "install",
    );
    assert.equal(
      decideRemediation("discoverable", "not-authenticated", "unknown", grokCap)
        .kind,
      "login",
    );
    assert.equal(
      decideRemediation("discoverable", "not-authenticated", "unknown", grokCap)
        .instruction,
      "grok login --device-code",
    );
    const timeoutRem = decideRemediation(
      "discoverable",
      "unknown",
      "unknown",
      grokCap,
    );
    assert.equal(timeoutRem.kind, "diagnose");
    assert.notEqual(timeoutRem.instruction, "grok login --device-code");
    assert.equal(
      decideRemediation("discoverable", "authenticated", "outdated", grokCap)
        .kind,
      "update",
    );
    assert.equal(
      decideRemediation("discoverable", "authenticated", "unknown", grokCap)
        .kind,
      "diagnose",
    );
    assert.equal(
      decideRemediation("discoverable", "authenticated", "current", grokCap)
        .kind,
      "none",
    );
  });

  it("outdated never forces login remediation", () => {
    const r = decideRemediation(
      "discoverable",
      "authenticated",
      "outdated",
      claudeCap,
    );
    assert.equal(r.kind, "update");
    assert.notEqual(r.kind, "login");
  });
});
