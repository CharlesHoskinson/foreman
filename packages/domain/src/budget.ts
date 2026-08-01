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

export type BudgetReconciliationDecision =
  | { readonly _tag: "Reconciled"; readonly state: BudgetState }
  | {
      readonly _tag: "Rejected";
      readonly reason: "release_exceeds_reserved";
      readonly dimension: BudgetDimension;
      readonly activeReserved: number;
      readonly release: number;
    }
  | {
      readonly _tag: "ObservedOverrun";
      readonly dimension: BudgetDimension;
      readonly reserved: number;
      readonly observed: number;
      readonly state: BudgetState;
    }
  | {
      readonly _tag: "BudgetExhausted";
      readonly dimension: Exclude<BudgetDimension, "concurrency">;
      readonly limit: number;
      readonly accounted: number;
      readonly state: BudgetState;
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
    const consumed =
      dimension === "concurrency" ? 0 : state.observed[dimension];
    const available = Math.max(
      0,
      state.limits[dimension] - consumed - state.reserved[dimension],
    );
    const accounted = consumed + state.reserved[dimension];
    if (accounted > state.limits[dimension] || request[dimension] > available) {
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
): BudgetReconciliationDecision => {
  for (const dimension of budgetDimensions) {
    if (reservation[dimension] > state.reserved[dimension]) {
      return {
        _tag: "Rejected",
        reason: "release_exceeds_reserved",
        dimension,
        activeReserved: state.reserved[dimension],
        release: reservation[dimension],
      };
    }
  }

  const nextReserved = mapVector(
    state.reserved,
    reservation,
    (total, release) => total - release,
  );
  const nextObserved: BudgetVector = {
    ...mapVector(
      state.observed,
      observed,
      (accounted, actual) => accounted + actual,
    ),
    concurrency: Math.max(state.observed.concurrency, observed.concurrency),
  };
  const nextState: BudgetState = {
    ...state,
    reserved: nextReserved,
    observed: nextObserved,
  };

  for (const dimension of budgetDimensions) {
    if (dimension === "concurrency") continue;
    const accounted = nextObserved[dimension] + nextReserved[dimension];
    if (accounted > state.limits[dimension]) {
      return {
        _tag: "BudgetExhausted",
        dimension,
        limit: state.limits[dimension],
        accounted,
        state: nextState,
      };
    }
  }

  for (const dimension of budgetDimensions) {
    if (observed[dimension] > reservation[dimension]) {
      return {
        _tag: "ObservedOverrun",
        dimension,
        reserved: reservation[dimension],
        observed: observed[dimension],
        state: nextState,
      };
    }
  }

  return { _tag: "Reconciled", state: nextState };
};
