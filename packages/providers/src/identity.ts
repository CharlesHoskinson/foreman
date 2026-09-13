interface ProviderIdentityBaseV1 {
  readonly provider: string;
  /** Exact observed model when the protocol supplies a separate field. */
  readonly model?: string;
  readonly profileId: string;
  readonly transportId: string;
  readonly credentialProfileRef: string;
}
export type ProviderIdentityV1 = ProviderIdentityBaseV1 &
  (
    | {
        readonly kind: "api";
        readonly endpointRevision: string;
        readonly responseId: string;
      }
    | {
        readonly kind: "native";
        readonly protocolVersion: string;
        readonly sessionId: string;
        readonly threadId?: string;
        readonly turnId?: string;
      }
  );
