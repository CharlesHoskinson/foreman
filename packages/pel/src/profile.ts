import { createHash } from "node:crypto";
import type { PelLimitsV1 } from "./types.js";
export interface PelProfileV1 {
  readonly id: string;
  readonly digest: string;
  readonly limits: PelLimitsV1;
}
export const DEFAULT_LIMITS: PelLimitsV1 = Object.freeze({
  maxSourceBytes: 1024 * 1024,
  maxTokens: 100000,
  maxAstNodes: 50000,
  maxSyntaxDepth: 256,
  maxReductions: 100000,
  maxIterations: 10000,
  maxCallDepth: 256,
  maxValueBytes: 16 * 1024 * 1024,
});
const id = "pel-paper-v2-foreman-1";
export const PEL_PROFILE: PelProfileV1 = Object.freeze({
  id,
  digest: createHash("sha256")
    .update(JSON.stringify({ id, limits: DEFAULT_LIMITS }))
    .digest("hex"),
  limits: DEFAULT_LIMITS,
});
