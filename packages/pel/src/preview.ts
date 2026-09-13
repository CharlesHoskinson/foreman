import { isCheckedProgramV1 } from "./checker.js";
import type { CheckedProgramV1, PlanPreviewV1 } from "./analysis-types.js";
export { buildEffectiveAuthoringSnapshotV1 } from "./snapshot.js";
export function planPel(checked: CheckedProgramV1): PlanPreviewV1 {
  if (!isCheckedProgramV1(checked))
    throw new Error(
      "PEL_BINDING_MISMATCH: check the exact source and snapshot before preview",
    );
  return structuredClone({
    schemaVersion: 1,
    ...checked.analysis,
    binding: checked.binding,
    bindingDigest: checked.bindingDigest,
    limits: checked.snapshot.limits,
  });
}
