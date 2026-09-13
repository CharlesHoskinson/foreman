import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultProviderControls, decodeProviderControls } from "./controls.js";
test("T-M3-021 closed nested controls reject zero thinking budgets and unknown keys", () => {
  const d = defaultProviderControls("gpt-5.6-sol", "openai");
  assert.equal(d.effort, "medium");
  for (const controls of [
    { ...d, thinking: { mode: "enabled", budgetTokens: 0 } },
    { ...d, thinking: { mode: "adaptive", unknown: true } },
    { ...d, sampling: { bad: 1 } },
    { ...d, toolChoice: { name: "x", bad: 1 } },
    { ...d, execution: { mode: "foreground", store: false, bad: 1 } },
  ])
    assert.equal(decodeProviderControls(controls).ok, false);
});
