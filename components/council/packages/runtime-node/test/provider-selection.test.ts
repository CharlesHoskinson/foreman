import { describe, expect, it } from "vitest";
import { ClaudeProviderCanaryAdapterLive } from "@council/adapter-claude";
import { GrokProviderCanaryAdapterLive } from "@council/adapter-grok";
import { CodexProviderCanaryAdapterLive } from "@council/adapter-codex";
import type { ProviderFamilyV1 } from "@council/schema";
import {
  selectProvider,
  type ProviderSelection,
} from "../src/provider-selection.js";

const closedFamilies: readonly ProviderFamilyV1[] = [
  "anthropic",
  "xai",
  "openai",
  "google",
] as const;

describe("selectProvider", () => {
  it("maps anthropic only to ClaudeProviderCanaryAdapterLive", () => {
    const result = selectProvider("anthropic");
    expect(result).toEqual({
      _tag: "available",
      family: "anthropic",
      layer: ClaudeProviderCanaryAdapterLive,
    });
    expect(result._tag).toBe("available");
    if (result._tag === "available") {
      expect(result.layer).toBe(ClaudeProviderCanaryAdapterLive);
    }
  });

  it("maps xai only to GrokProviderCanaryAdapterLive", () => {
    const result = selectProvider("xai");
    expect(result).toEqual({
      _tag: "available",
      family: "xai",
      layer: GrokProviderCanaryAdapterLive,
    });
    expect(result._tag).toBe("available");
    if (result._tag === "available") {
      expect(result.layer).toBe(GrokProviderCanaryAdapterLive);
    }
  });

  it("maps openai only to CodexProviderCanaryAdapterLive", () => {
    const result = selectProvider("openai");
    expect(result).toEqual({
      _tag: "available",
      family: "openai",
      layer: CodexProviderCanaryAdapterLive,
    });
    expect(result._tag).toBe("available");
    if (result._tag === "available") {
      expect(result.layer).toBe(CodexProviderCanaryAdapterLive);
    }
  });

  it("returns exact unavailable result for google with no layer key", () => {
    const result = selectProvider("google");
    expect(result).toEqual({
      _tag: "unavailable",
      family: "google",
      reason: "Gemini provider canary adapter is not implemented",
    });
    expect(result).not.toHaveProperty("layer");
    expect("layer" in result).toBe(false);
  });

  it("covers all four closed ProviderFamilyV1 values", () => {
    const selections: ProviderSelection[] = closedFamilies.map(selectProvider);
    expect(selections).toHaveLength(4);

    const families = selections.map((s) => s.family);
    expect(new Set(families)).toEqual(
      new Set(["anthropic", "xai", "openai", "google"]),
    );

    const tags = selections.map((s) => s._tag);
    expect(tags.filter((t) => t === "available")).toHaveLength(3);
    expect(tags.filter((t) => t === "unavailable")).toHaveLength(1);
  });
});
