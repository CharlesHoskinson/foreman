// Task 1 (posix-cascade-parity plan): subreaper safety net. Written FIRST
// against the not-yet-existing exports (TDD red) -- setChildSubreaper()
// must call prctl(PR_SET_CHILD_SUBREAPER, 1) on its process, and a readback
// probe (PR_GET_CHILD_SUBREAPER, via a separate small FFI call) must then
// observe 1. POSIX-only (mirrors wrapWithSetsid/terminateProcessGroup's own
// win32-only UnsupportedPlatformError check in this same module) -- prctl
// is a Linux syscall; the project's POSIX build target is Linux/WSL
// specifically (see launcher/README.md), so "not win32" is treated as
// Linux here exactly as elsewhere in posix.ts.
//
// The actual prctl calls run in a throwaway CHILD process (tests/fixtures/
// subreaper-probe.ts), not in this test file's own process -- see that
// fixture's header for why: PR_SET_CHILD_SUBREAPER mutates the calling
// process's kernel state for its whole remaining lifetime, and doing that
// to `bun test`'s own runner process was confirmed to leak into (and flake)
// tests/supervise.test.ts's process-group kill check when both files ran
// in the same invocation.
import { describe, test, expect } from "bun:test";
import { setChildSubreaper, UnsupportedPlatformError } from "../src/posix";

const windows = process.platform === "win32";

describe.if(!windows)("setChildSubreaper", () => {
  test("prctl(PR_SET_CHILD_SUBREAPER,1) takes effect: PR_GET_CHILD_SUBREAPER reads back 1 (out-of-process)", () => {
    const result = Bun.spawnSync([process.execPath, `${import.meta.dir}/fixtures/subreaper-probe.ts`]);
    expect(result.exitCode).toBe(0);
    const { ok, flag } = JSON.parse(result.stdout.toString());
    expect(ok).toBe(true);
    expect(flag).toBe(1);
  });
});

describe.if(windows)("setChildSubreaper (win32)", () => {
  test("throws UnsupportedPlatformError -- never silently no-ops on the frozen Windows build", () => {
    expect(() => setChildSubreaper()).toThrow(UnsupportedPlatformError);
  });
});
