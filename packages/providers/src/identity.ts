interface ProviderIdentityBaseV1 {
  readonly provider: string;
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
        readonly turnId?: string;
      }
  );
