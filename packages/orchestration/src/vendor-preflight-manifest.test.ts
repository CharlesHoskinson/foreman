/**
 * Capability table TOML parser and JSON decoders.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  argvContainsMutatingUpdate,
  capabilityTableDigest,
  capabilityTableToCanonicalJson,
  decodeVendorCapabilityTableV1,
  findCapability,
  parseVendorCapabilitiesFromToml,
} from "./vendor-preflight-manifest.js";
import { isVendorPreflightContractFailure } from "./vendor-preflight-contract.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const SAMPLE = `
[[vendor_capabilities]]
vendor = "claude"
cli_name = "claude"
evidence_class = "declared"
auth_argv = ["auth", "status"]
version_argv = ["--version"]
version_floor = "2.1.220"
auth_positive_markers = []
auth_negative_markers = []
update_mutates = true
login_instruction = "claude auth login"
install_instruction = "Install Claude Code"
update_instruction = "claude update"
diagnose_instruction = "Re-run claude auth status"

[[vendor_capabilities]]
vendor = "codex"
cli_name = "codex"
evidence_class = "declared"
auth_argv = ["login", "status"]
version_argv = ["--version"]
version_floor = "0.146.0"
auth_positive_markers = []
auth_negative_markers = ["Not logged in"]
update_mutates = true
login_instruction = "codex login"
install_instruction = "npm install -g @openai/codex@latest"
update_instruction = "npm install -g @openai/codex@latest"
diagnose_instruction = "Re-run codex login status"

[[vendor_capabilities]]
vendor = "grok"
cli_name = "grok"
evidence_class = "probed"
auth_argv = ["models"]
version_argv = ["--version"]
version_floor = "0.2.118"
auth_positive_markers = ["You are logged in with grok.com."]
auth_negative_markers = ["not authenticated", "sign in", "log in"]
update_mutates = true
update_check_argv = ["update", "--check", "--json"]
login_instruction = "grok login --device-code"
install_instruction = "npm install -g @xai-official/grok@latest"
update_instruction = "npm install -g @xai-official/grok@latest"
diagnose_instruction = "Re-run bounded grok models and inspect network"
`;

describe("parseVendorCapabilitiesFromToml", () => {
  it("parses three vendor capabilities with pinned floors", () => {
    const table = parseVendorCapabilitiesFromToml(SAMPLE);
    assert.ok(!isVendorPreflightContractFailure(table));
    assert.equal(table.capabilities.length, 3);
    const claude = findCapability(table, "claude");
    const codex = findCapability(table, "codex");
    const grok = findCapability(table, "grok");
    assert.ok(claude);
    assert.ok(codex);
    assert.ok(grok);
    assert.equal(claude!.versionFloor, "2.1.220");
    assert.equal(codex!.versionFloor, "0.146.0");
    assert.equal(grok!.versionFloor, "0.2.118");
    assert.equal(claude!.evidenceClass, "declared");
    assert.equal(grok!.evidenceClass, "probed");
    assert.deepEqual(grok!.authArgv, ["models"]);
    assert.deepEqual(grok!.updateCheckArgv, ["update", "--check", "--json"]);
    assert.equal(findCapability(table, "agy"), null);
  });

  it("rejects unknown keys and duplicate vendors", () => {
    const unknown = SAMPLE + `
[[vendor_capabilities]]
vendor = "claude"
cli_name = "x"
evidence_class = "declared"
auth_argv = ["a"]
version_argv = ["b"]
version_floor = "1.0.0"
auth_positive_markers = []
auth_negative_markers = []
update_mutates = true
login_instruction = "l"
install_instruction = "i"
update_instruction = "u"
diagnose_instruction = "d"
extra_field = "no"
`;
    // The second claude table will fail either on unknown or on duplicate.
    // Craft a cleaner unknown-only table:
    const onlyUnknown = `
[[vendor_capabilities]]
vendor = "claude"
cli_name = "claude"
evidence_class = "declared"
auth_argv = ["auth", "status"]
version_argv = ["--version"]
version_floor = "2.1.220"
auth_positive_markers = []
auth_negative_markers = []
update_mutates = true
login_instruction = "claude auth login"
install_instruction = "Install Claude Code"
update_instruction = "claude update"
diagnose_instruction = "Re-run claude auth status"
invented = true
`;
    const u = parseVendorCapabilitiesFromToml(onlyUnknown);
    assert.ok(isVendorPreflightContractFailure(u));
    assert.equal(u.reason, "unknown_field");

    const dup = SAMPLE + `
[[vendor_capabilities]]
vendor = "grok"
cli_name = "grok"
evidence_class = "probed"
auth_argv = ["models"]
version_argv = ["--version"]
version_floor = "0.2.118"
auth_positive_markers = ["You are logged in with grok.com."]
auth_negative_markers = ["not authenticated"]
update_mutates = true
login_instruction = "grok login --device-code"
install_instruction = "npm install -g @xai-official/grok@latest"
update_instruction = "npm install -g @xai-official/grok@latest"
diagnose_instruction = "diagnose"
`;
    const d = parseVendorCapabilitiesFromToml(dup);
    assert.ok(isVendorPreflightContractFailure(d));
    assert.equal(d.reason, "inconsistent_state");
    void unknown;
  });

  it("canonical JSON is stable and digest is lowercase sha256", () => {
    const table = parseVendorCapabilitiesFromToml(SAMPLE);
    assert.ok(!isVendorPreflightContractFailure(table));
    const a = capabilityTableToCanonicalJson(table);
    const b = capabilityTableToCanonicalJson(table);
    assert.equal(a, b);
    const digest = capabilityTableDigest(table);
    assert.match(digest, /^[0-9a-f]{64}$/);
    const decoded = decodeVendorCapabilityTableV1(JSON.parse(a));
    assert.ok(!isVendorPreflightContractFailure(decoded));
  });

  it("parses the authored env/reference-manifest.toml capability table", () => {
    const path = join(root, "env/reference-manifest.toml");
    const text = readFileSync(path, "utf8");
    const table = parseVendorCapabilitiesFromToml(text);
    assert.ok(
      !isVendorPreflightContractFailure(table),
      isVendorPreflightContractFailure(table)
        ? table.reason
        : "ok",
    );
    assert.equal(table.capabilities.length, 3);
    assert.equal(findCapability(table, "claude")?.versionFloor, "2.1.220");
    assert.equal(findCapability(table, "codex")?.versionFloor, "0.146.0");
    assert.equal(findCapability(table, "grok")?.versionFloor, "0.2.118");
  });
});

describe("argvContainsMutatingUpdate", () => {
  it("flags bare update for every vendor binding", () => {
    assert.equal(argvContainsMutatingUpdate(["claude", "update"], "claude"), true);
    assert.equal(argvContainsMutatingUpdate(["codex", "update"], "codex"), true);
    assert.equal(argvContainsMutatingUpdate(["grok", "update"], "grok"), true);
    assert.equal(argvContainsMutatingUpdate(["agy", "update"], "agy"), true);
    assert.equal(argvContainsMutatingUpdate(["claude", "update"], null), true);
  });

  it("allows update --check --json only when vendor binding is grok", () => {
    const checkTail = ["update", "--check", "--json"] as const;
    assert.equal(
      argvContainsMutatingUpdate(["grok", ...checkTail], "grok"),
      false,
    );
    // Executable/CLI name alone must not authorize the exception.
    assert.equal(
      argvContainsMutatingUpdate(["grok", ...checkTail], "claude"),
      true,
    );
    assert.equal(
      argvContainsMutatingUpdate(["claude", ...checkTail], "claude"),
      true,
    );
    assert.equal(
      argvContainsMutatingUpdate(["codex", ...checkTail], "codex"),
      true,
    );
    assert.equal(
      argvContainsMutatingUpdate(["agy", ...checkTail], "agy"),
      true,
    );
    assert.equal(
      argvContainsMutatingUpdate(["grok", ...checkTail], null),
      true,
    );
    assert.equal(
      argvContainsMutatingUpdate(["any-name", ...checkTail], null),
      true,
    );
  });

  it("does not flag non-update probe vectors", () => {
    assert.equal(argvContainsMutatingUpdate(["grok", "models"], "grok"), false);
    assert.equal(
      argvContainsMutatingUpdate(["claude", "auth", "status"], "claude"),
      false,
    );
  });
});
