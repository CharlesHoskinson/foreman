import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDER_PROFILES, resolveControls } from "./profiles.js";
import { resolveTransport, validateToolPolicy } from "./registry.js";
test("T-M3-024/R-M3-024 exact explicit selection resolves every family without PATH or model aliases", () => {
  for (const profile of PROVIDER_PROFILES) {
    const absent = resolveTransport(profile.id, undefined, []);
    assert(!absent.ok);
    assert.equal(absent.error._tag, "ModelUnavailable");
    const ambiguous = resolveTransport(
      profile.id,
      undefined,
      profile.transports,
    );
    assert(!ambiguous.ok);
    assert.equal(ambiguous.error._tag, "UnsupportedCapability");
    for (const transport of profile.transports) {
      assert.deepEqual(
        resolveTransport(profile.id, transport, profile.transports),
        { ok: true, value: transport },
      );
      assert.deepEqual(
        resolveTransport(profile.id, undefined, [transport, transport]),
        { ok: true, value: transport },
      );
    }
    assert.equal(
      resolveTransport(
        profile.id + "-latest",
        profile.transports[0],
        profile.transports,
      ).ok,
      false,
    );
  }
  assert.equal(
    resolveTransport("gpt-6-astra", "xai-responses", [
      "openai-responses",
      "xai-responses",
    ]).ok,
    false,
  );
});
test("T-M3-024/R-M3-024 native coding and read-only review preserve separate tool boundaries", () => {
  const coding = {
    mode: "native-coding",
    workspaceGrantId: "workspace",
    permissionGrantIds: ["grant"],
    hostPermissionPortRef: "host",
  } as const;
  for (const profile of PROVIDER_PROFILES) {
    const api = profile.transports[0]!;
    const native = profile.transports[1]!;
    assert.equal(validateToolPolicy(api, coding, "codingTask").ok, false);
    assert.equal(
      validateToolPolicy(native, { mode: "none" }, "codingTask").ok,
      false,
    );
    assert.equal(validateToolPolicy(native, coding, "codingTask").ok, true);
    assert.equal(validateToolPolicy(native, coding, "review").ok, false);
    assert.equal(
      validateToolPolicy(native, { mode: "none" }, "review").ok,
      true,
    );
  }
});
test("T-M3-021/R-M3-021 unsupported Messages execution controls cannot inherit Responses parameters", () => {
  const p = PROVIDER_PROFILES.find((p) => p.id === "claude-opus-5")!;
  for (const execution of [
    { mode: "background", store: "provider-default" },
    { mode: "foreground", store: true },
  ] as const) {
    const r = resolveControls(
      p.id,
      { ...p.defaults, execution },
      "anthropic-messages",
      ["background", "store"],
    );
    assert(!r.ok);
    assert.equal(r.error._tag, "UnsupportedCapability");
    assert.match(r.error.fieldPath ?? "", /^execution\./);
  }
});
