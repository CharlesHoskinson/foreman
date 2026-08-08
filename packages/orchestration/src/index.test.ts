import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as pkg from "./index.js";

describe("packages/orchestration", () => {
  it("does not expose internal race hooks in public index", () => {
    assert.equal("setStateRootCreateRaceHook" in pkg, false, "setStateRootCreateRaceHook should not be exported");
    assert.equal("setSecretScanRaceHook" in pkg, false, "setSecretScanRaceHook should not be exported");
    assert.equal("setCredentialProfileRaceHook" in pkg, false, "setCredentialProfileRaceHook should not be exported");
    assert.equal("setProfilePreflightRaceHook" in pkg, false, "setProfilePreflightRaceHook should not be exported");
  });
});

