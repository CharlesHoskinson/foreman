import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  PROVIDER_PROFILES,
  SOURCE_MANIFEST_HASH,
  resolveProfile,
  validateProfileControls,
} from "./profiles.js";
import { defaultProviderControls, decodeProviderControls } from "./controls.js";

test("T-M3-001 six immutable exact profiles bind captured sources and dated facts", () => {
  assert.equal(PROVIDER_PROFILES.length, 6);
  assert.equal(
    SOURCE_MANIFEST_HASH,
    createHash("sha256")
      .update(
        readFileSync("docs/research/pel-release/sources/models/manifest.json"),
      )
      .digest("hex"),
  );
  for (const p of PROVIDER_PROFILES) {
    assert(Object.isFrozen(p));
    assert.equal(p.exactModel, p.id);
    assert.equal(p.transports.length, 2);
    for (const s of p.sources)
      assert.equal(
        createHash("sha256")
          .update(
            readFileSync(`docs/research/pel-release/sources/models/${s.file}`),
          )
          .digest("hex"),
        s.sha256,
      );
    assert.equal(p.pricing.effectiveDate, "2026-09-12");
  }
  assert.equal(resolveProfile("gpt-6").ok, false);
  assert.equal(
    PROVIDER_PROFILES.find((p) => p.id === "grok-4.6")?.limits.maxOutputTokens,
    undefined,
  );
});
test("T-M3-002 every disallowed effort and profile-specific combination fails before dispatch", () => {
  for (const p of PROVIDER_PROFILES)
    for (const effort of [
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ] as const) {
      const r = validateProfileControls(p.id, { ...p.defaults, effort });
      assert.equal(r.ok, p.efforts.includes(effort));
      if (!r.ok) {
        assert.equal(r.error.fieldPath, "effort");
        assert.match(r.error.message, /profile-validation/);
      }
    }
  const invalid = [
    [
      "claude-opus-5",
      {
        ...defaultProviderControls("claude-opus-5", "anthropic"),
        effort: "max",
        thinking: { mode: "disabled" },
      },
    ],
    [
      "claude-fable-5-1",
      {
        ...defaultProviderControls("claude-fable-5-1", "anthropic"),
        thinking: { mode: "adaptive", budgetTokens: 100 },
      },
    ],
    [
      "claude-fable-5-1",
      {
        ...defaultProviderControls("claude-fable-5-1", "anthropic"),
        sampling: { temperature: 1 },
      },
    ],
    [
      "claude-fable-5-1",
      {
        ...defaultProviderControls("claude-fable-5-1", "anthropic"),
        toolChoice: { name: "forced" },
      },
    ],
  ] as const;
  for (const [id, controls] of invalid)
    assert.equal(validateProfileControls(id, controls).ok, false);
  const minimal = decodeProviderControls({
    ...defaultProviderControls("gemini-3.8-flash", "google"),
    effort: "minimal",
  });
  assert(!minimal.ok);
  assert.match(minimal.error.message, /decode/);
});
