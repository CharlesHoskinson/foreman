import { Effect } from "effect";
import type { ProviderTransport } from "../contract.js";
import type { ProviderFailure } from "../errors.js";
import {
  createGrokAcpProtocol,
  type GrokAcpProtocolOptions,
} from "./grok-acp-protocol.js";
import {
  createNativeProcessPort,
  type NativeProcessPort,
} from "./native-process.js";

export interface GrokAcpOptions extends Omit<GrokAcpProtocolOptions, "process"> {
  readonly process?: NativeProcessPort;
}

/** Public Grok admission. Stock ACP has no qualified aggregate budget control. */
export function createGrokAcpTransport(options: GrokAcpOptions): ProviderTransport {
  const protocol = createGrokAcpProtocol({
    ...options,
    process: options.process ?? options.host?.process ?? createNativeProcessPort(options.now),
  });
  return {
    ...protocol,
    get installedVersion() {
      return protocol.installedVersion;
    },
    start: () => Effect.fail<ProviderFailure>({
      _tag: "UnsupportedCapability",
      retryClass: "never",
      fieldPath: "limits.hardBudgetEnforcement",
      message:
        "Grok ACP cannot enforce aggregate maxInputTokens, maxOutputTokens, or maxCostUsd before native requests",
    }),
  };
}
