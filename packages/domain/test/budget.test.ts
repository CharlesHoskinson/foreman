import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  emptyBudgetVector,
  initialBudgetState,
  reserveBudget,
} from "../src/index.js";

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
        fc.nat({ max: 10_000 }),
        fc.nat({ max: 10_000 }),
        (limit, request) => {
          const result = reserveBudget(
            initialBudgetState({
              ...emptyBudgetVector,
              tokens: limit,
            }),
            { ...emptyBudgetVector, tokens: request },
          );
          if (result._tag === "Reserved") {
            expect(result.state.reserved.tokens).toBeLessThanOrEqual(limit);
          }
        },
      ),
    );
  });
});
