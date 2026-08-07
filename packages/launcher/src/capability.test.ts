import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOST_PID_ENV,
  capabilityFromProbe,
  formatCapabilityDiagnostic,
  isPidnsInner,
  resolveLauncherPid,
  PIDNS_INNER_ENV,
} from "./capability.js";

describe("capability closed vocabulary", () => {
  it("windows is always typed degraded job-object unavailable", () => {
    const cap = capabilityFromProbe({
      platform: "win32",
      alreadyInner: false,
      hostPid: 1,
      unsharePath: null,
      probeOk: false,
      probeDetail: "n/a",
    });
    assert.equal(cap._tag, "Degraded");
    if (cap._tag === "Degraded") {
      assert.equal(cap.kind, "windows_job_object_unavailable");
      assert.equal(cap.reason, "windows_no_job_object");
    }
    const d = formatCapabilityDiagnostic(cap);
    assert.match(d.message, /DEGRADED/);
    assert.match(d.message, /windows_job_object_unavailable/);
  });

  it("failed unshare probe degrades to process group", () => {
    const cap = capabilityFromProbe({
      platform: "linux",
      alreadyInner: false,
      hostPid: 9,
      unsharePath: "/usr/bin/unshare",
      probeOk: false,
      probeDetail: "Operation not permitted",
    });
    assert.equal(cap._tag, "Degraded");
    if (cap._tag === "Degraded") {
      assert.equal(cap.kind, "posix_process_group_degraded");
      assert.equal(cap.reason, "unshare_probe_failed");
      assert.match(cap.detail, /Operation not permitted/);
    }
  });

  it("missing unshare degrades", () => {
    const cap = capabilityFromProbe({
      platform: "linux",
      alreadyInner: false,
      hostPid: 1,
      unsharePath: null,
      probeOk: false,
      probeDetail: "missing",
    });
    assert.equal(cap._tag, "Degraded");
    if (cap._tag === "Degraded") {
      assert.equal(cap.reason, "unshare_missing");
    }
  });

  it("successful probe yields strong capability", () => {
    const cap = capabilityFromProbe({
      platform: "linux",
      alreadyInner: false,
      hostPid: 55,
      unsharePath: "/usr/bin/unshare",
      probeOk: true,
      probeDetail: "ok",
    });
    assert.equal(cap._tag, "Strong");
    if (cap._tag === "Strong") {
      assert.equal(cap.unsharePath, "/usr/bin/unshare");
      assert.equal(cap.hostPid, 55);
    }
  });

  it("already-inner uses host pid env", () => {
    assert.equal(isPidnsInner({ [PIDNS_INNER_ENV]: "1" }), true);
    assert.equal(isPidnsInner({}), false);
    assert.equal(
      resolveLauncherPid({ [HOST_PID_ENV]: "1234" }, 1),
      1234,
    );
    assert.equal(resolveLauncherPid({}, 7), 7);
    const cap = capabilityFromProbe({
      platform: "linux",
      alreadyInner: true,
      hostPid: 1234,
      unsharePath: null,
      probeOk: true,
      probeDetail: "",
    });
    assert.equal(cap._tag, "AlreadyInner");
  });

  it("diagnostic is bounded and does not claim cascade on degraded", () => {
    const cap = capabilityFromProbe({
      platform: "linux",
      alreadyInner: false,
      hostPid: 1,
      unsharePath: "/usr/bin/unshare",
      probeOk: false,
      probeDetail: "Operation not permitted",
    });
    const d = formatCapabilityDiagnostic(cap);
    assert.equal(d.message.length < 500, true);
    assert.equal(d.message.includes("cascade guarantee"), false);
    assert.match(d.message, /DEGRADED/);
  });
});
