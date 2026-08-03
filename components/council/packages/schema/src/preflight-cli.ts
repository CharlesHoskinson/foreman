import * as Schema from "effect/Schema";
import { NonBlankString } from "./deliberation.js";
import { decodeStrictSync } from "./decode.js";
import { ArtifactId } from "./identifiers.js";
import {
  CouncilPromptContractV1,
  GitCommitSha,
  ProviderFamilyV1,
} from "./prompt-preflight.js";

const uniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

/**
 * Maps one contract artifact identity to a host filesystem path for the CLI.
 * Paths are runtime inputs only; they never enter ready tokens or receipts.
 */
export const PreflightCliArtifactPathV1 = Schema.Struct({
  artifactId: ArtifactId,
  path: NonBlankString,
});
export type PreflightCliArtifactPathV1 = typeof PreflightCliArtifactPathV1.Type;

/**
 * Closed stdin request for the Council preflight CLI.
 * Rejects unknown fields, empty strings, and duplicate artifact identifiers.
 * Provider family `google` is accepted at the boundary and fails closed later
 * without substitution (Gemini adapter is not implemented).
 */
export const PreflightCliRequestV1 = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  contract: CouncilPromptContractV1,
  provider: Schema.Struct({
    family: ProviderFamilyV1,
    executable: NonBlankString,
    model: NonBlankString,
  }),
  observedBundle: Schema.Struct({
    baseSha: GitCommitSha,
    headSha: GitCommitSha,
    diffPath: NonBlankString,
  }),
  artifactPaths: Schema.NonEmptyArray(PreflightCliArtifactPathV1),
  cwd: NonBlankString,
}).pipe(
  Schema.filter((request) =>
    uniqueStrings(request.artifactPaths.map((item) => item.artifactId)),
  ),
);
export type PreflightCliRequestV1 = typeof PreflightCliRequestV1.Type;

/**
 * Strict decoder for PreflightCliRequestV1. Excess properties are errors.
 */
export const decodePreflightCliRequestV1 = (
  value: unknown,
): PreflightCliRequestV1 => decodeStrictSync(PreflightCliRequestV1, value);
