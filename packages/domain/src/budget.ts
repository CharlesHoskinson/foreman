import type { BudgetVector } from "@council/schema";

export const budgetDimensions = [
  "wallTimeMs",
  "tokens",
  "costMicros",
  "toolCalls",
  "turns",
  "retries",
  "concurrency",
  "events",
  "artifactBytes",
] as const;

export type BudgetDimension = (typeof budgetDimensions)[number];

export const emptyBudgetVector: BudgetVector = {
  wallTimeMs: 0,
  tokens: 0,
  costMicros: 0,
  toolCalls: 0,
  turns: 0,
  retries: 0,
  concurrency: 0,
  events: 0,
  artifactBytes: 0,
};

export type BudgetState = {
  readonly limits: BudgetVector;
  readonly reserved: BudgetVector;
  readonly observed: BudgetVector;
};

export type BudgetReservationDecision =
  | { readonly _tag: "Reserved"; readonly state: BudgetState }
  | {
      readonly _tag: "Rejected";
      readonly dimension: BudgetDimension;
      readonly available: number;
      readonly requested: number;
    };

const mapVector = (
  left: BudgetVector,
  right: BudgetVector,
  operation: (leftValue: number, rightValue: number) => number,
): BudgetVector => ({
  wallTimeMs: operation(left.wallTimeMs, right.wallTimeMs),
  tokens: operation(left.tokens, right.tokens),
  costMicros: operation(left.costMicros, right.costMicros),
  toolCalls: operation(left.toolCalls, right.toolCalls),
  turns: operation(left.turns, right.turns),
  retries: operation(left.retries, right.retries),
  concurrency: operation(left.concurrency, right.concurrency),
  events: operation(left.events, right.events),
  artifactBytes: operation(left.artifactBytes, right.artifactBytes),
});

export const initialBudgetState = (limits: BudgetVector): BudgetState => ({
  limits,
  reserved: emptyBudgetVector,
  observed: emptyBudgetVector,
});

export const reserveBudget = (
  state: BudgetState,
  request: BudgetVector,
): BudgetReservationDecision => {
  for (const dimension of budgetDimensions) {
    const available = state.limits[dimension] - state.reserved[dimension];
    if (request[dimension] > available) {
      return {
        _tag: "Rejected",
        dimension,
        available,
        requested: request[dimension],
      };
    }
  }

  return {
    _tag: "Reserved",
    state: {
      ...state,
      reserved: mapVector(state.reserved, request, (a, b) => a + b),
    },
  };
};

export const reconcileBudget = (
  state: BudgetState,
  reservation: BudgetVector,
  observed: BudgetVector,
): BudgetState => ({
  ...state,
  reserved: mapVector(state.reserved, reservation, (total, release) =>
    Math.max(0, total - release),
  ),
  observed: mapVector(state.observed, observed, (a, b) => a + b),
});
