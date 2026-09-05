import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOST_PID_ENV,
  PIDNS_INNER_ENV,
  PIDNS_KIND_ENV,
  capabilityFromProbe,
  capabilityRecord,
  formatCapabilityDiagnostic,
  formatRefusalLine,
  isPidnsInner,
  isStrong,
  resolveLauncherPid,
  type PlatformCapability,
  type ProbeAttempt,
} from "./capability.js";

const usernsFlags = [
  "--user",
  "--map-current-user",
  "--pid",
  "--mount-proc",
  "--fork",
  "--kill-child",
] as const;

const okAttempt: ProbeAttempt = {
  flags: usernsFlags,
  status: 0,
  signal: null,
  stderr: "",
};

describe("capability closed vocabulary", () => {
  it("keeps the legacy capabilityFromProbe export working", () => {
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
      assert.deepEqual(cap.attempts, []);
    }
  });

  it("identifies Strong and AlreadyInner as strong", () => {
    const strong: PlatformCapability = {
      _tag: "Strong",
      kind: "posix_pidns_userns_strong",
      unsharePath: "/usr/bin/unshare",
      flags: usernsFlags,
      hostPid: 55,
      attempts: [okAttempt],
    };
    const inner: PlatformCapability = {
      _tag: "AlreadyInner",
      kind: "posix_pidns_strong",
      hostPid: 55,
    };
    const degraded: PlatformCapability = {
      _tag: "Degraded",
      kind: "posix_process_group_degraded",
      reason: "unshare_missing",
      detail: "missing",
      attempts: [],
    };
    assert.equal(isStrong(strong), true);
    assert.equal(isStrong(inner), true);
    assert.equal(isStrong(degraded), false);
  });

  it("already-inner reads the kind marker and host pid", () => {
    assert.equal(isPidnsInner({ [PIDNS_INNER_ENV]: "1" }), true);
    assert.equal(isPidnsInner({}), false);
    assert.equal(resolveLauncherPid({ [HOST_PID_ENV]: "1234" }, 1), 1234);
    assert.equal(resolveLauncherPid({}, 7), 7);
    const cap = capabilityFromProbe({
      platform: "linux",
      alreadyInner: true,
      hostPid: 1234,
      unsharePath: null,
      probeOk: true,
      probeDetail: "",
      kind: "posix_pidns_userns_strong",
    });
    assert.deepEqual(cap, {
      _tag: "AlreadyInner",
      kind: "posix_pidns_userns_strong",
      hostPid: 1234,
    });
    assert.equal(PIDNS_KIND_ENV, "FOREMAN_LAUNCH_PIDNS_KIND");
  });

  it("formats exact strong, inner, degraded, and refusal diagnostics", () => {
    const strong: PlatformCapability = {
      _tag: "Strong",
      kind: "posix_pidns_userns_strong",
      unsharePath: "/usr/bin/unshare",
      flags: usernsFlags,
      hostPid: 55,
      attempts: [okAttempt],
    };
    assert.equal(
      formatCapabilityDiagnostic(strong).message,
      `foreman-launch: capability=posix_pidns_userns_strong unshare=/usr/bin/unshare flags=${usernsFlags.join(" ")} host_pid=55`,
    );
    const inner: PlatformCapability = {
      _tag: "AlreadyInner",
      kind: "posix_pidns_userns_strong",
      hostPid: 55,
    };
    assert.equal(
      formatCapabilityDiagnostic(inner).message,
      "foreman-launch: capability=posix_pidns_userns_strong already_inner host_pid=55",
    );
    const degraded: PlatformCapability = {
      _tag: "Degraded",
      kind: "posix_process_group_degraded",
      reason: "userns_blocked",
      detail: "probe details",
      attempts: [],
    };
    assert.equal(
      formatCapabilityDiagnostic(degraded).message,
      "foreman-launch: DEGRADED capability=posix_process_group_degraded reason=userns_blocked probe details",
    );
    const refused = capabilityRecord(degraded, "strong", 77, true);
    assert.equal(
      formatRefusalLine(refused),
      "foreman-launch: REFUSED capability=posix_process_group_degraded reason=refused_by_policy required=strong -- no command was spawned",
    );
  });

  it("creates schema-stable strong and refused records with attempts", () => {
    const strong: PlatformCapability = {
      _tag: "Strong",
      kind: "posix_pidns_userns_strong",
      unsharePath: "/usr/bin/unshare",
      flags: usernsFlags,
      hostPid: 55,
      attempts: [okAttempt],
    };
    const record = capabilityRecord(strong, "any", 55, false);
    assert.equal(record.schema, "foreman-launch-capability/1");
    assert.equal(record.tag, "Strong");
    assert.equal(record.kind, "posix_pidns_userns_strong");
    assert.equal(record.reason, "probe_ok");
    assert.equal(record.required, "any");
    assert.deepEqual(record.flags, usernsFlags);
    assert.deepEqual(record.attempts, [okAttempt]);
    assert.equal(record.launcher_pid, 55);
    assert.match(record.launcher_version, /^\d+\.\d+\.\d+$/);
    assert.equal(record.platform, process.platform);

    const refused = capabilityRecord(strong, "strong", 55, true);
    assert.equal(refused.tag, "Refused");
    assert.equal(refused.reason, "refused_by_policy");
  });
});
