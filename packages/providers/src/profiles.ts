import { createHash } from "node:crypto";
import type { Result } from "@foreman/pel";
import type {
  ProfileId,
  ProviderFamily,
  TransportId,
  Capability,
  EvidenceState,
} from "./contract.js";
import {
  defaultProviderControls,
  decodeProviderControls,
  type ProviderControlsV1,
} from "./controls.js";
import type { ProviderFailure } from "./errors.js";
export const SOURCE_MANIFEST_HASH =
  "113b2d6e61761cf7db0e2e2d9de0e5acff16679c80c63adf20188761390ba0a4";
export interface ProviderProfileV1 {
  readonly id: ProfileId;
  readonly exactModel: ProfileId;
  readonly provider: ProviderFamily;
  readonly transports: readonly TransportId[];
  readonly efforts: readonly ProviderControlsV1["effort"][];
  readonly defaults: ProviderControlsV1;
  readonly profileHash: string;
  readonly sourceManifestHash: string;
  readonly limits: {
    readonly contextTokens?: number;
    readonly maxInputTokens?: number;
    readonly maxOutputTokens?: number;
  };
  readonly pricing: {
    readonly effectiveDate: string;
    readonly tier: string;
    readonly currency: string;
    readonly unit: string;
    readonly input: number;
    readonly cachedRead?: number;
    readonly output: number;
    readonly cacheWrite?: number;
    readonly cacheWrites?: readonly {
      readonly retentionSeconds: number;
      readonly price: number;
    }[];
    readonly promotionThrough?: string;
    readonly longContext?: {
      readonly thresholdInputTokens: number;
      readonly inputMultiplier: number;
      readonly cacheMultiplier?: number;
      readonly outputMultiplier: number;
    };
    readonly nextSchedule?: {
      readonly effectiveDate: string;
      readonly input: number;
      readonly cachedRead: number;
      readonly output: number;
    };
  };
  readonly sources: readonly {
    readonly id: string;
    readonly url: string;
    readonly file: string;
    readonly sha256: string;
    readonly rawSha256: string;
    readonly capturedAt: string;
  }[];
}
const facts = [
  {
    id: "grok-4.6",
    exactModel: "grok-4.6",
    provider: "xai",
    transports: ["xai-responses", "grok-acp"],
    efforts: ["low", "medium", "high", "xhigh"],
    limits: {
      contextTokens: 500000,
    },
    pricing: {
      effectiveDate: "2026-09-12",
      tier: "standard",
      currency: "USD",
      unit: "million-tokens",
      input: 2,
      output: 6,
    },
    sources: [
      {
        id: "grok-model",
        url: "https://docs.x.ai/developers/grok-4-6",
        file: "grok-model.md",
        sha256:
          "809aa581bbee88796089c2df06d495540ca8b2b5bee1dc99a3a3429b51e1d347",
        rawSha256:
          "7cd9efb154e413fe33c6d7139ed679d3f0f96d50a64b2bbb146b82a99251e18a",
        capturedAt: "2026-09-13T03:01:23.869451+00:00",
      },
      {
        id: "grok-pricing",
        url: "https://docs.x.ai/developers/models",
        file: "grok-pricing.md",
        sha256:
          "39392e712c6bf3451010c95797cea755563376eac7cb598f8164b701f06c7661",
        rawSha256:
          "a657afde242ef1424ade199433e578083ee1836d76d2f69fd5fa157216f8e967",
        capturedAt: "2026-09-13T03:01:24.456307+00:00",
      },
      {
        id: "grok-reasoning",
        url: "https://docs.x.ai/developers/model-capabilities/text/reasoning",
        file: "grok-reasoning.md",
        sha256:
          "30a2f3e25046a3dd2841c2651fa21e7637d79d7c2627a0db97e5a6ab9c91d994",
        rawSha256:
          "e9848d08f6b7dc45fdfdecc522fc1744ff5891fbb74ae856c1a6b43ee92860fa",
        capturedAt: "2026-09-13T03:01:25.121725+00:00",
      },
      {
        id: "grok-responses",
        url: "https://docs.x.ai/developers/rest-api-reference/inference/responses",
        file: "grok-responses.md",
        sha256:
          "c8bab6a237a273e9edb7282f30c83eb9762118e2ee737678f228747a53d5d62e",
        rawSha256:
          "2817ac11f3a3c7ce4f8f3ad03080248109ed254df9551fcb9c64af362d9d409d",
        capturedAt: "2026-09-13T03:01:27.255975+00:00",
      },
      {
        id: "grok-headless",
        url: "https://docs.x.ai/build/cli/headless-scripting",
        file: "grok-headless.md",
        sha256:
          "237c5652ddb76ba33a6383496311c6a53ff36d35be979226aea612b9ce550fde",
        rawSha256:
          "91dfd9859a24264d1623e7b6093d4ad3f2d95e202fc31dfff8b520411ec30901",
        capturedAt: "2026-09-13T03:03:04.841975+00:00",
      },
      {
        id: "grok-cli",
        url: "https://docs.x.ai/build/cli/reference",
        file: "grok-cli.md",
        sha256:
          "b5f06e453818a1b949adc8921e6c353fe96599059b37de38c7bf56851bfbc592",
        rawSha256:
          "2c16b4f9955d2875432ced23307416e4bc8fd0a9af35a2cc782f79479a2879b9",
        capturedAt: "2026-09-13T03:03:11.626128+00:00",
      },
    ],
  },
  {
    id: "claude-opus-5",
    exactModel: "claude-opus-5",
    provider: "anthropic",
    transports: ["anthropic-messages", "claude-code"],
    efforts: ["low", "medium", "high", "xhigh", "max"],
    limits: {
      contextTokens: 1000000,
      maxOutputTokens: 128000,
    },
    pricing: {
      effectiveDate: "2026-09-12",
      tier: "standard",
      currency: "USD",
      unit: "million-tokens",
      input: 5,
      cachedRead: 0.5,
      cacheWrites: [
        { retentionSeconds: 300, price: 6.25 },
        { retentionSeconds: 3600, price: 10 },
      ],
      output: 25,
    },
    sources: [
      {
        id: "claude-opus",
        url: "https://platform.claude.com/docs/en/models/opus-5/overview",
        file: "claude-opus.md",
        sha256:
          "78764802454a8b786e3e7c0095a7e4f4e10ee18bc55f3da13cb8fc44a79fa234",
        rawSha256:
          "3319e2af4ab69a14850a131867361564ea303cc50485a9623be83e23727a369b",
        capturedAt: "2026-09-13T03:01:13.985875+00:00",
      },
      {
        id: "claude-effort",
        url: "https://platform.claude.com/docs/en/build-with-claude/effort",
        file: "claude-effort.md",
        sha256:
          "797f5c5afaf12f0619867fece3b8140b1dfb0a6d0122ae2791fbbfe47e5362a2",
        rawSha256:
          "a261dcec954db011d1cde90e2632ef41c6a85338fb32bd2b8550712f514b64d2",
        capturedAt: "2026-09-13T03:01:17.752866+00:00",
      },
      {
        id: "claude-headless",
        url: "https://code.claude.com/docs/en/headless",
        file: "claude-headless.md",
        sha256:
          "0b2189a1c1c759fdc1deea7ab4ad4b56f030d77d75ec614655b0c68d41ff0d2c",
        rawSha256:
          "2d59bf1524fc4fd7d5cbdc92de466119dec436e883b17c86c77cf169966d0529",
        capturedAt: "2026-09-13T03:01:21.059370+00:00",
      },
      {
        id: "claude-cache",
        url: "https://platform.claude.com/docs/en/build-with-claude/prompt-caching",
        file: "claude-cache.md",
        sha256:
          "e55f77736efc697780ea67b2608ca008bc124b3820b86a30c3745ded678a8b3d",
        rawSha256:
          "8c67441e4a1037e8b142b387e8a4a905d3ae63fcefc274aa309d8620e2118c7f",
        capturedAt: "2026-09-13T03:01:19.263278+00:00",
      },
    ],
  },
  {
    id: "claude-fable-5-1",
    exactModel: "claude-fable-5-1",
    provider: "anthropic",
    transports: ["anthropic-messages", "claude-code"],
    efforts: ["low", "medium", "high", "xhigh", "max"],
    limits: {
      contextTokens: 1000000,
      maxOutputTokens: 128000,
    },
    pricing: {
      effectiveDate: "2026-09-12",
      tier: "standard",
      currency: "USD",
      unit: "million-tokens",
      input: 10,
      cachedRead: 0.25,
      output: 50,
      cacheWrites: [
        {
          retentionSeconds: 300,
          price: 12.5,
        },
        {
          retentionSeconds: 3600,
          price: 20,
        },
      ],
    },
    sources: [
      {
        id: "claude-fable",
        url: "https://platform.claude.com/docs/en/models/fable-5-1/overview",
        file: "claude-fable.md",
        sha256:
          "f6c44d844d8bb26b7a610e6033a26bc1910522d293f9c588b0839ab6b1fc84cf",
        rawSha256:
          "6b222f897c04da0f41ea1a0bb6a863677eb7fd52e74f696c40e87b37f93bef21",
        capturedAt: "2026-09-13T03:01:14.622842+00:00",
      },
      {
        id: "claude-fable-changes",
        url: "https://platform.claude.com/docs/en/models/fable-5-1/whats-new-fable-5-1",
        file: "claude-fable-changes.md",
        sha256:
          "2f69b8c500dad3f8977d15820e4d0b49f45c5eb37c394c9cfbc788f632799ab8",
        rawSha256:
          "7671406cef235df211032b98172b687405da662e549cb5f41e02cd0deccc581d",
        capturedAt: "2026-09-13T03:03:02.245502+00:00",
      },
      {
        id: "claude-effort",
        url: "https://platform.claude.com/docs/en/build-with-claude/effort",
        file: "claude-effort.md",
        sha256:
          "797f5c5afaf12f0619867fece3b8140b1dfb0a6d0122ae2791fbbfe47e5362a2",
        rawSha256:
          "a261dcec954db011d1cde90e2632ef41c6a85338fb32bd2b8550712f514b64d2",
        capturedAt: "2026-09-13T03:01:17.752866+00:00",
      },
      {
        id: "claude-headless",
        url: "https://code.claude.com/docs/en/headless",
        file: "claude-headless.md",
        sha256:
          "0b2189a1c1c759fdc1deea7ab4ad4b56f030d77d75ec614655b0c68d41ff0d2c",
        rawSha256:
          "2d59bf1524fc4fd7d5cbdc92de466119dec436e883b17c86c77cf169966d0529",
        capturedAt: "2026-09-13T03:01:21.059370+00:00",
      },
    ],
  },
  {
    id: "gpt-6-astra",
    exactModel: "gpt-6-astra",
    provider: "openai",
    transports: ["openai-responses", "codex-app-server"],
    efforts: ["low", "medium", "high", "xhigh", "max"],
    limits: {
      contextTokens: 1050000,
      maxInputTokens: 922000,
      maxOutputTokens: 128000,
    },
    pricing: {
      effectiveDate: "2026-09-12",
      tier: "standard",
      currency: "USD",
      unit: "million-tokens",
      input: 10,
      cachedRead: 1,
      output: 50,
      cacheWrite: 12.5,
      longContext: {
        thresholdInputTokens: 272000,
        inputMultiplier: 2,
        cacheMultiplier: 2,
        outputMultiplier: 1.5,
      },
    },
    sources: [
      {
        id: "openai-astra",
        url: "https://developers.openai.com/api/docs/models/gpt-6-astra.md",
        file: "openai-astra.md",
        sha256:
          "1d09b307bd5e35d053259394d440f7070b3f010369920f02c414bda15ee0b0ab",
        rawSha256:
          "f45ae813c3f69708e2576328056de14cdf71fec174c875f4b81d236105545625",
        capturedAt: "2026-09-13T03:01:07.052848+00:00",
      },
      {
        id: "openai-background",
        url: "https://developers.openai.com/api/docs/guides/background.md",
        file: "openai-background.md",
        sha256:
          "59d7b4dc485502f1ba03e5391ed6451a4950cae7e4fc3aea6af506c7d558765c",
        rawSha256:
          "9aa2b715e56683ea0132db81e46cb8e9f654de2fb3d94635218762c10d68ba09",
        capturedAt: "2026-09-13T03:01:10.437386+00:00",
      },
      {
        id: "openai-reasoning",
        url: "https://developers.openai.com/api/docs/guides/reasoning.md",
        file: "openai-reasoning.md",
        sha256:
          "ce7ca8601f0d5f7e52eb9f65c934178d1c183a50814ba803fefb6f70a197c744",
        rawSha256:
          "91604df954335250d16e33f3b07ebbfa3e6e2b7f821f0722ad7a69b9d586719a",
        capturedAt: "2026-09-13T03:01:09.911773+00:00",
      },
      {
        id: "codex-app-server",
        url: "https://developers.openai.com/codex/app-server",
        file: "codex-app-server.md",
        sha256:
          "1317f4eeeb57245d8095a507d45a7530b235358fafe7d83506a732ba574b1b96",
        rawSha256:
          "bf2a08c96b07da95b22e3c690c9cbde0e53c067d35617466d27d7523a7dc8a73",
        capturedAt: "2026-09-13T03:01:13.198957+00:00",
      },
    ],
  },
  {
    id: "gpt-5.6-sol",
    exactModel: "gpt-5.6-sol",
    provider: "openai",
    transports: ["openai-responses", "codex-app-server"],
    efforts: ["none", "low", "medium", "high", "xhigh", "max"],
    limits: {
      contextTokens: 1050000,
      maxInputTokens: 922000,
      maxOutputTokens: 128000,
    },
    pricing: {
      effectiveDate: "2026-09-12",
      tier: "standard",
      currency: "USD",
      unit: "million-tokens",
      input: 4,
      cachedRead: 0.4,
      output: 20,
      cacheWrite: 5,
      promotionThrough: "2026-11-21",
      longContext: {
        thresholdInputTokens: 272000,
        inputMultiplier: 2,
        outputMultiplier: 1.5,
      },
    },
    sources: [
      {
        id: "openai-sol",
        url: "https://developers.openai.com/api/docs/models/gpt-5.6-sol.md",
        file: "openai-sol.md",
        sha256:
          "c173973d0f65522083fdf15a2234805b2729400764facbac82d14ce68a374804",
        rawSha256:
          "23f4ff2c236486d42145e21693f450bfcac272c37ee839a5ee6f9455cd1d8b7b",
        capturedAt: "2026-09-13T03:01:07.662901+00:00",
      },
      {
        id: "openai-background",
        url: "https://developers.openai.com/api/docs/guides/background.md",
        file: "openai-background.md",
        sha256:
          "59d7b4dc485502f1ba03e5391ed6451a4950cae7e4fc3aea6af506c7d558765c",
        rawSha256:
          "9aa2b715e56683ea0132db81e46cb8e9f654de2fb3d94635218762c10d68ba09",
        capturedAt: "2026-09-13T03:01:10.437386+00:00",
      },
      {
        id: "openai-reasoning",
        url: "https://developers.openai.com/api/docs/guides/reasoning.md",
        file: "openai-reasoning.md",
        sha256:
          "ce7ca8601f0d5f7e52eb9f65c934178d1c183a50814ba803fefb6f70a197c744",
        rawSha256:
          "91604df954335250d16e33f3b07ebbfa3e6e2b7f821f0722ad7a69b9d586719a",
        capturedAt: "2026-09-13T03:01:09.911773+00:00",
      },
      {
        id: "codex-app-server",
        url: "https://developers.openai.com/codex/app-server",
        file: "codex-app-server.md",
        sha256:
          "1317f4eeeb57245d8095a507d45a7530b235358fafe7d83506a732ba574b1b96",
        rawSha256:
          "bf2a08c96b07da95b22e3c690c9cbde0e53c067d35617466d27d7523a7dc8a73",
        capturedAt: "2026-09-13T03:01:13.198957+00:00",
      },
    ],
  },
  {
    id: "gemini-3.8-flash",
    exactModel: "gemini-3.8-flash",
    provider: "google",
    transports: ["google-interactions", "gemini-cli"],
    efforts: ["low", "medium", "high"],
    limits: {
      maxInputTokens: 1048576,
      maxOutputTokens: 65536,
    },
    pricing: {
      effectiveDate: "2026-09-12",
      tier: "standard",
      currency: "USD",
      unit: "million-tokens",
      input: 0.75,
      cachedRead: 0.075,
      output: 3.75,
      promotionThrough: "2026-12-31",
      nextSchedule: {
        effectiveDate: "2027-01-01",
        input: 1.5,
        cachedRead: 0.15,
        output: 7.5,
      },
    },
    sources: [
      {
        id: "gemini-model",
        url: "https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash",
        file: "gemini-model.md",
        sha256:
          "a9a8aec603ee09753c17d8916378f83073653f13a0be4644ead20bd273773175",
        rawSha256:
          "7cf926de01cde01eea9c080fc001dfcb0ac978bbb4f257677a72f8e9229c4dc4",
        capturedAt: "2026-09-13T03:01:32.467428+00:00",
      },
      {
        id: "gemini-pricing",
        url: "https://ai.google.dev/gemini-api/docs/pricing",
        file: "gemini-pricing.md",
        sha256:
          "ceb9594eeb19c6019ce4211c75b77ce2add6b2df305c606de5162dc70a05cc48",
        rawSha256:
          "de14934921d54c599e6fe0b5cd9fa14f72e5dd81be1da59467ad97d3b4891b16",
        capturedAt: "2026-09-13T03:01:43.576390+00:00",
      },
      {
        id: "gemini-thinking",
        url: "https://ai.google.dev/gemini-api/docs/thinking",
        file: "gemini-thinking.md",
        sha256:
          "3926c729b4e48744f6b1d2a44cdf71f4cf6dd4fa8c25cd581528ea210814bb6d",
        rawSha256:
          "d3c523594e7b58ba51a8209f832deda908b619f269a74cc65c8b0d664a3ecf00",
        capturedAt: "2026-09-13T03:01:35.276462+00:00",
      },
      {
        id: "gemini-background",
        url: "https://ai.google.dev/gemini-api/docs/background-execution",
        file: "gemini-background.md",
        sha256:
          "5488b680763f715342343d758e6799e888f3140e8fda13d9f77a9afb8c217d91",
        rawSha256:
          "0757e2fba7d1664aca1b83ba1a2435b074ab341793cceb4a5057584ed9270522",
        capturedAt: "2026-09-13T03:04:21.984412+00:00",
      },
      {
        id: "gemini-interactions",
        url: "https://ai.google.dev/gemini-api/docs/interactions",
        file: "gemini-interactions.md",
        sha256:
          "26ce5a7b9e7c5757a0510ba879d2fbba10bfd24a7f38361ad370d983d621a843",
        rawSha256:
          "9e4722b2beb2f404d2894727629cd60d7e73c86d620881e7ee03dba3c515cbbe",
        capturedAt: "2026-09-13T03:04:23.472987+00:00",
      },
      {
        id: "gemini-headless",
        url: "https://geminicli.com/docs/cli/headless/",
        file: "gemini-headless.md",
        sha256:
          "6793b84029a3b7cd790ce95f25ff19d0254b38c6b236a97f0f102a8662a755ea",
        rawSha256:
          "26caf47715778284640274391535969cae6ab4403587372272e73903473f7da0",
        capturedAt: "2026-09-13T03:01:46.720758+00:00",
      },
    ],
  },
] as const;
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
export function controlsHash(controls: ProviderControlsV1): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        effort: controls.effort,
        thinking: {
          mode: controls.thinking.mode,
          ...(controls.thinking.budgetTokens === undefined
            ? {}
            : { budgetTokens: controls.thinking.budgetTokens }),
        },
        sampling: {
          ...(controls.sampling.temperature === undefined
            ? {}
            : { temperature: controls.sampling.temperature }),
          ...(controls.sampling.topP === undefined
            ? {}
            : { topP: controls.sampling.topP }),
          ...(controls.sampling.topK === undefined
            ? {}
            : { topK: controls.sampling.topK }),
        },
        toolChoice: controls.toolChoice,
        execution: {
          mode: controls.execution.mode,
          store: controls.execution.store,
        },
      }),
    )
    .digest("hex");
}
export const PROVIDER_PROFILES: readonly ProviderProfileV1[] = deepFreeze(
  facts.map((f) => {
    const profile = {
      ...f,
      defaults: defaultProviderControls(f.id, f.provider),
      sourceManifestHash: SOURCE_MANIFEST_HASH,
    };
    return {
      ...profile,
      profileHash: createHash("sha256")
        .update(JSON.stringify(profile))
        .digest("hex"),
    };
  }),
);
export function resolveProfile(
  id: string,
): Result<ProviderProfileV1, ProviderFailure> {
  const value = PROVIDER_PROFILES.find((p) => p.id === id);
  return value
    ? { ok: true, value }
    : {
        ok: false,
        error: {
          _tag: "ModelUnavailable",
          retryClass: "never",
          message: "Exact model profile is unavailable",
          fieldPath: "profileId",
        },
      };
}
export function validateProfileControls(
  profileId: string,
  input: unknown,
  transportId?: TransportId,
  evidenced: readonly Capability[] = [],
): Result<ProviderControlsV1, ProviderFailure> {
  const decoded = decodeProviderControls(input);
  if (!decoded.ok) return decoded;
  const profile = resolveProfile(profileId);
  if (!profile.ok) return profile;
  const c = decoded.value;
  const fail = (
    fieldPath: string,
  ): Result<ProviderControlsV1, ProviderFailure> => ({
    ok: false,
    error: {
      _tag: "UnsupportedCapability",
      retryClass: "never",
      message: `profile-validation: unsupported control at ${fieldPath}`,
      fieldPath,
    },
  });
  if (!profile.value.efforts.includes(c.effort)) return fail("effort");
  if (
    profileId === "claude-opus-5" &&
    ["xhigh", "max"].includes(c.effort) &&
    c.thinking.mode === "disabled"
  )
    return fail("thinking.mode");
  if (profileId === "claude-fable-5-1") {
    if (c.thinking.mode !== "adaptive") return fail("thinking.mode");
    if (c.thinking.budgetTokens !== undefined)
      return fail("thinking.budgetTokens");
    if (Object.keys(c.sampling).length)
      return fail(`sampling.${Object.keys(c.sampling)[0]}`);
    if (c.toolChoice === "required" || typeof c.toolChoice === "object")
      return fail("toolChoice");
  }
  if (
    c.sampling.temperature !== undefined &&
    c.sampling.temperature > (profile.value.provider === "anthropic" ? 1 : 2)
  )
    return fail("sampling.temperature");
  if (
    c.execution.mode === "background" &&
    (transportId === "anthropic-messages" || !evidenced.includes("background"))
  )
    return fail("execution.mode");
  if (
    typeof c.execution.store === "boolean" &&
    (transportId === "anthropic-messages" || !evidenced.includes("store"))
  )
    return fail("execution.store");
  return decoded;
}
export function resolveControls(
  profileId: string,
  input?: unknown,
  transportId?: TransportId,
  evidenced: readonly Capability[] = [],
): Result<ProviderControlsV1, ProviderFailure> {
  const p = resolveProfile(profileId);
  if (!p.ok) return p;
  return validateProfileControls(
    profileId,
    input ?? p.value.defaults,
    transportId,
    evidenced,
  );
}
export function documentedCapability(
  profile: ProviderProfileV1,
  transportId: TransportId,
  capability: Capability,
): EvidenceState {
  if (!profile.transports.includes(transportId)) return "unsupported";
  const native = [
    "grok-acp",
    "claude-code",
    "codex-app-server",
    "gemini-cli",
  ].includes(transportId);
  if (capability === "codingTask") return native ? "documented" : "unsupported";
  if (["permissionBoundary", "workspaceBoundary"].includes(capability))
    return native ? "unknown" : "unsupported";
  if (["grammar"].includes(capability)) return "unknown";
  if (
    transportId === "xai-responses" &&
    ["remoteCancellation", "cursorReplay", "reconcile"].includes(capability)
  )
    return "unknown";
  if (
    transportId === "anthropic-messages" &&
    [
      "background",
      "store",
      "remoteCancellation",
      "cursorReplay",
      "reconcile",
    ].includes(capability)
  )
    return "unsupported";
  if (
    native &&
    [
      "background",
      "store",
      "remoteCancellation",
      "reconcile",
      "cursorReplay",
      "toolPolicyNone",
    ].includes(capability)
  )
    return "unknown";
  return "documented";
}
