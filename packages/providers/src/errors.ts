import type { ProviderIdentityV1 } from "./identity.js";
import type { ProviderUsageV1 } from "./usage.js";

interface FailureDetails {
  readonly message: string;
  readonly requestId?: string;
  readonly usage?: ProviderUsageV1;
  readonly fieldPath?: string;
  readonly providerIdentity?: ProviderIdentityV1;
}
type Permanent<Tag extends string> = FailureDetails & {
  readonly _tag: Tag;
  readonly retryClass: "never";
  readonly retryAfterMs?: never;
};
type Transient<Tag extends string> = FailureDetails & {
  readonly _tag: Tag;
  readonly retryClass: "transient";
  readonly retryAfterMs?: number;
};
export type ModelUnavailable = Permanent<"ModelUnavailable">;
export type ModelMismatch = Permanent<"ModelMismatch">;
export type UnsupportedCapability = Permanent<"UnsupportedCapability">;
export type CapabilityUnverified = Permanent<"CapabilityUnverified">;
export type PromptChannelUnsupported = Permanent<"PromptChannelUnsupported">;
export type AuthenticationRequired = Permanent<"AuthenticationRequired">;
export type ProbeUnknown = Permanent<"ProbeUnknown">;
export type OutputInvalid = Permanent<"OutputInvalid">;
export type OutputIncomplete = Permanent<"OutputIncomplete">;
export type MalformedEvent = Permanent<"MalformedEvent">;
export type ContinuationMismatch = Permanent<"ContinuationMismatch">;
export type ResumeUnavailable = Permanent<"ResumeUnavailable">;
export type OutcomeUnknown = Permanent<"OutcomeUnknown">;
export type RateLimited = Transient<"RateLimited">;
export type TransportDisconnected = Transient<"TransportDisconnected">;
export type ProviderFailure =
  | ModelUnavailable
  | ModelMismatch
  | UnsupportedCapability
  | CapabilityUnverified
  | PromptChannelUnsupported
  | AuthenticationRequired
  | ProbeUnknown
  | OutputInvalid
  | OutputIncomplete
  | MalformedEvent
  | ContinuationMismatch
  | ResumeUnavailable
  | OutcomeUnknown
  | RateLimited
  | TransportDisconnected;
