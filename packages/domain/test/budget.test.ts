import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  budgetDimensions,
  emptyBudgetVector,
  initialBudgetState,
  reconcileBudget,
  reserveBudget,
} from "../src/index.js";

const budgetVectorArbitrary = fc.record({
  wallTimeMs: fc.nat({ max: 10_000 }),
  tokens: fc.nat({ max: 10_000 }),
  costMicros: fc.nat({ max: 10_000 }),
  toolCalls: fc.nat({ max: 10_000 }),
  turns: fc.nat({ max: 10_000 }),
  retries: fc.nat({ max: 10_000 }),
  concurrency: fc.nat({ max: 10_000 }),
  events: fc.nat({ max: 10_000 }),
  artifactBytes: fc.nat({ max: 10_000 }),
});

describe("budget reservation", () => {
  it("admits at most one request for the final token", () => {
    const state = initialBudgetState({
      ...emptyBudgetVector,
      tokens: 1,
    });
    const first = reserveBudget(state, {
      ...emptyBudgetVector,
      tokens: 1,
    });
    expect(first._tag).toBe("Reserved");
    if (first._tag === "Rejected") return;
    const second = reserveBudget(first.state, {
      ...emptyBudgetVector,
      tokens: 1,
    });
    expect(second).toEqual({
      _tag: "Rejected",
      dimension: "tokens",
      available: 0,
      requested: 1,
    });
  });

  it("never reserves beyond any hard limit", () => {
    fc.assert(
      fc.property(
        budgetVectorArbitrary,
        budgetVectorArbitrary,
        (limits, request) => {
          const result = reserveBudget(initialBudgetState(limits), request);
          if (result._tag === "Reserved") {
            for (const dimension of budgetDimensions) {
              expect(result.state.reserved[dimension]).toBeLessThanOrEqual(
                limits[dimension],
              );
            }
          }
        },
      ),
    );
  });

  it("reconciles observed usage without mutating the input state", () => {
    const state = {
      limits: { ...emptyBudgetVector, tokens: 10, toolCalls: 4 },
      reserved: { ...emptyBudgetVector, tokens: 3, toolCalls: 2 },
      observed: { ...emptyBudgetVector, tokens: 4, toolCalls: 1 },
    };
    const before = structuredClone(state);

    const reconciled = reconcileBudget(
      state,
      { ...emptyBudgetVector, tokens: 5, toolCalls: 1 },
      { ...emptyBudgetVector, tokens: 2, toolCalls: 3 },
    );

    expect(reconciled).toEqual({
      limits: { ...emptyBudgetVector, tokens: 10, toolCalls: 4 },
      reserved: { ...emptyBudgetVector, toolCalls: 1 },
      observed: { ...emptyBudgetVector, tokens: 6, toolCalls: 4 },
    });
    expect(state).toEqual(before);
  });
});
