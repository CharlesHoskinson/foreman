import type {
  AuthoringProviderControlsV1,
  AuthoringProviderProfileV1,
} from "./authoring-types.js";

interface ProfileCeiling {
  readonly transports: readonly string[];
  readonly efforts: readonly AuthoringProviderControlsV1["effort"][];
}
/** Pinned authoring ceilings from foredi-03-model-adapters/design.md, Exact profiles.
 * These are admission limits, not evidence that an installed adapter is qualified.
 */
const ceilings: Readonly<Record<string, ProfileCeiling>> = {
  "grok-4.6": {
    transports: ["xai-responses", "grok-acp"],
    efforts: ["low", "medium", "high", "xhigh"],
  },
  "claude-opus-5": {
    transports: ["anthropic-messages", "claude-code"],
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  "claude-fable-5-1": {
    transports: ["anthropic-messages", "claude-code"],
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  "gpt-6-astra": {
    transports: ["openai-responses", "codex-app-server"],
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  "gpt-5.6-sol": {
    transports: ["openai-responses", "codex-app-server"],
    efforts: ["none", "low", "medium", "high", "xhigh", "max"],
  },
  "gemini-3.8-flash": {
    transports: ["google-interactions", "gemini-cli"],
    efforts: ["low", "medium", "high"],
  },
};
export function authoringProfileCeilingIssue(
  profile: AuthoringProviderProfileV1,
): string | undefined {
  if (
    profile.grammarSupport === "qualified" &&
    profile.evidenceKind !== "qualified"
  )
    return "Qualified grammar requires qualified profile evidence";
  const ceiling = Object.hasOwn(ceilings, profile.profileId)
    ? ceilings[profile.profileId]
    : undefined;
  if (!ceiling)
    return profile.evidenceKind === "fixture"
      ? undefined
      : `Unknown profile ${profile.profileId} requires explicit fixture evidence`;
  if (!ceiling.transports.includes(profile.transportId))
    return `Transport ${profile.transportId} is unsupported for ${profile.profileId}`;
  const controls = profile.supportedControls;
  if (controls.efforts.some((effort) => !ceiling.efforts.includes(effort)))
    return `Effort metadata exceeds the pinned ceiling for ${profile.profileId}`;
  if (
    profile.profileId === "claude-fable-5-1" &&
    (controls.thinkingModes.some((mode) => mode !== "adaptive") ||
      controls.budgetTokens ||
      controls.sampling.length > 0 ||
      controls.toolChoices.some(
        (choice) => choice !== "auto" && choice !== "none",
      ))
  )
    return "Fable requires adaptive thinking, no manual budget, default sampling, and auto or none tool choice";
  return undefined;
}

/** A resource ID names one finite host scope. Paths stay relative to that scope. */
export function isNormalizedAuthoringResourceId(value: string): boolean {
  const separator = value.indexOf(":");
  if (separator < 1 || !/^[a-z][a-z0-9.-]*$/.test(value.slice(0, separator)))
    return false;
  const path = value.slice(separator + 1);
  return (
    path.length > 0 &&
    path
      .split("/")
      .every(
        (segment) =>
          segment !== "." &&
          segment !== ".." &&
          /^[A-Za-z0-9._-]+$/.test(segment),
      )
  );
}
