import type { UnsupportedCapability } from "./errors.js";

export interface ProviderControlsV1 {
  readonly effort: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  readonly thinking: {
    readonly mode: "provider-default" | "adaptive" | "enabled" | "disabled";
    readonly budgetTokens?: number;
  };
  readonly sampling: {
    readonly temperature?: number;
    readonly topP?: number;
    readonly topK?: number;
  };
  readonly toolChoice: "auto" | "none" | "required" | { readonly name: string };
  readonly execution: {
    readonly mode: "foreground" | "background";
    readonly store: "provider-default" | boolean;
  };
}

export function defaultProviderControls(
  profileId: string,
  provider: string,
): ProviderControlsV1 {
  return {
    effort: profileId === "gpt-5.6-sol" ? "medium" : "high",
    thinking: {
      mode: provider === "anthropic" ? "adaptive" : "provider-default",
    },
    sampling: {},
    toolChoice: "auto",
    execution: { mode: "foreground", store: "provider-default" },
  };
}

type DecodeResult =
  | { readonly ok: true; readonly value: ProviderControlsV1 }
  | { readonly ok: false; readonly error: UnsupportedCapability };
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export function decodeProviderControls(value: unknown): DecodeResult {
  const fail = (fieldPath: string): DecodeResult => ({
    ok: false,
    error: {
      _tag: "UnsupportedCapability",
      retryClass: "never",
      message: `decode: invalid provider controls at ${fieldPath}`,
      fieldPath,
    },
  });
  const unknownKey = (
    input: Record<string, unknown>,
    keys: readonly string[],
  ) => Object.keys(input).find((key) => !keys.includes(key));
  if (!record(value)) return fail("controls");
  const key = unknownKey(value, [
    "effort",
    "thinking",
    "sampling",
    "toolChoice",
    "execution",
  ]);
  if (key) return fail(key);
  if (
    typeof value.effort !== "string" ||
    !["none", "low", "medium", "high", "xhigh", "max"].includes(
      String(value.effort),
    )
  )
    return fail("effort");
  if (!record(value.thinking)) return fail("thinking");
  const thinkingKey = unknownKey(value.thinking, ["mode", "budgetTokens"]);
  if (thinkingKey) return fail(`thinking.${thinkingKey}`);
  if (
    typeof value.thinking.mode !== "string" ||
    !["provider-default", "adaptive", "enabled", "disabled"].includes(
      String(value.thinking.mode),
    )
  )
    return fail("thinking.mode");
  if (
    "budgetTokens" in value.thinking &&
    (!Number.isSafeInteger(value.thinking.budgetTokens) ||
      Number(value.thinking.budgetTokens) < 0)
  )
    return fail("thinking.budgetTokens");
  if (!record(value.sampling)) return fail("sampling");
  const samplingKey = unknownKey(value.sampling, [
    "temperature",
    "topP",
    "topK",
  ]);
  if (samplingKey) return fail(`sampling.${samplingKey}`);
  for (const [name, number] of Object.entries(value.sampling)) {
    if (
      typeof number !== "number" ||
      !Number.isFinite(number) ||
      number < 0 ||
      (name === "topP" && number > 1) ||
      (name === "topK" && !Number.isSafeInteger(number))
    )
      return fail(`sampling.${name}`);
  }
  if (record(value.toolChoice)) {
    const toolKey = unknownKey(value.toolChoice, ["name"]);
    if (toolKey) return fail(`toolChoice.${toolKey}`);
    if (
      typeof value.toolChoice.name !== "string" ||
      !value.toolChoice.name.length ||
      value.toolChoice.name.length > 256
    )
      return fail("toolChoice.name");
  } else if (
    typeof value.toolChoice !== "string" ||
    !["auto", "none", "required"].includes(value.toolChoice)
  )
    return fail("toolChoice");
  if (!record(value.execution)) return fail("execution");
  const executionKey = unknownKey(value.execution, ["mode", "store"]);
  if (executionKey) return fail(`execution.${executionKey}`);
  if (
    typeof value.execution.mode !== "string" ||
    !["foreground", "background"].includes(value.execution.mode)
  )
    return fail("execution.mode");
  if (
    value.execution.store !== "provider-default" &&
    typeof value.execution.store !== "boolean"
  )
    return fail("execution.store");
  return { ok: true, value: value as unknown as ProviderControlsV1 };
}
