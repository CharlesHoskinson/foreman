import * as Schema from "effect/Schema";

const NonNegativeInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
);

export const BudgetVector = Schema.Struct({
  wallTimeMs: NonNegativeInteger,
  tokens: NonNegativeInteger,
  costMicros: NonNegativeInteger,
  toolCalls: NonNegativeInteger,
  turns: NonNegativeInteger,
  retries: NonNegativeInteger,
  concurrency: NonNegativeInteger,
  events: NonNegativeInteger,
  artifactBytes: NonNegativeInteger,
});
export type BudgetVector = typeof BudgetVector.Type;
