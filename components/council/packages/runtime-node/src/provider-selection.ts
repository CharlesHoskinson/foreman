import { ClaudeProviderCanaryAdapterLive } from "@council/adapter-claude";
import { GrokProviderCanaryAdapterLive } from "@council/adapter-grok";
import { CodexProviderCanaryAdapterLive } from "@council/adapter-codex";
import type { ProviderFamilyV1 } from "@council/schema";

export type ProviderSelection =
  | {
      readonly _tag: "available";
      readonly family: "anthropic";
      readonly layer: typeof ClaudeProviderCanaryAdapterLive;
    }
  | {
      readonly _tag: "available";
      readonly family: "xai";
      readonly layer: typeof GrokProviderCanaryAdapterLive;
    }
  | {
      readonly _tag: "available";
      readonly family: "openai";
      readonly layer: typeof CodexProviderCanaryAdapterLive;
    }
  | {
      readonly _tag: "unavailable";
      readonly family: "google";
      readonly reason: "Gemini provider canary adapter is not implemented";
    };

export const selectProvider = (family: ProviderFamilyV1): ProviderSelection => {
  switch (family) {
    case "anthropic":
      return {
        _tag: "available",
        family: "anthropic",
        layer: ClaudeProviderCanaryAdapterLive,
      };
    case "xai":
      return {
        _tag: "available",
        family: "xai",
        layer: GrokProviderCanaryAdapterLive,
      };
    case "openai":
      return {
        _tag: "available",
        family: "openai",
        layer: CodexProviderCanaryAdapterLive,
      };
    case "google":
      return {
        _tag: "unavailable",
        family: "google",
        reason: "Gemini provider canary adapter is not implemented",
      };
  }
};
