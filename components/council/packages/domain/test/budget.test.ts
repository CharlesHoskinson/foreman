import type { BudgetVector } from "@council/schema";
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

const cumulativeDimensions = budgetDimensions.filter(
  (dimension) => dimension !== "concurrency",
);

type BudgetCommand =
  | { readonly _tag: "Reserve"; readonly request: BudgetVector }
  | {
      readonly _tag: "Reconcile";
      readonly reservation: BudgetVector;
      readonly observed: BudgetVector;
    };

const budgetCommandArbitrary: fc.Arbitrary<BudgetCommand> = fc.oneof(
  budgetVectorArbitrary.map((request) => ({
    _tag: "Reserve" as const,
    request,
  })),
  fc
    .tuple(budgetVectorArbitrary, budgetVectorArbitrary)
    .map(([reservation, observed]) => ({
      _tag: "Reconcile" as const,
      reservation,
      observed,
    })),
);

describe("budget reservation", () => {
  it.each(budgetDimensions)(
    "admits at most one competing request for the final %s unit",
    (dimension) => {
      const state = initialBudgetState({
        ...emptyBudgetVector,
        [dimension]: 1,
      });
      const first = reserveBudget(state, {
        ...emptyBudgetVector,
        [dimension]: 1,
      });
      expect(first._tag).toBe("Reserved");
      if (first._tag === "Rejected") return;
      const second = reserveBudget(first.state, {
        ...emptyBudgetVector,
        [dimension]: 1,
      });
      expect(second).toEqual({
        _tag: "Rejected",
        dimension,
        available: 0,
        requested: 1,
      });
    },
  );

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
      _tag: "Rejected",
      reason: "release_exceeds_reserved",
      dimension: "tokens",
      activeReserved: 3,
      release: 5,
    });
    expect(state).toEqual(before);
  });

  it("does not replenish cumulative budget after reconciliation", () => {
    const initial = initialBudgetState({
      ...emptyBudgetVector,
      tokens: 10,
    });
    const first = reserveBudget(initial, {
      ...emptyBudgetVector,
      tokens: 10,
    });
    expect(first._tag).toBe("Reserved");
    if (first._tag !== "Reserved") return;
    const reconciled = reconcileBudget(
      first.state,
      { ...emptyBudgetVector, tokens: 10 },
      { ...emptyBudgetVector, tokens: 10 },
    );
    expect(reconciled._tag).toBe("Reconciled");
    if (reconciled._tag !== "Reconciled") return;
    expect(
      reserveBudget(reconciled.state, {
        ...emptyBudgetVector,
        tokens: 10,
      }),
    ).toEqual({
      _tag: "Rejected",
      dimension: "tokens",
      available: 0,
      requested: 10,
    });
  });

  it("reuses concurrency only after its reservation is reconciled", () => {
    const initial = initialBudgetState({
      ...emptyBudgetVector,
      concurrency: 1,
    });
    const first = reserveBudget(initial, {
      ...emptyBudgetVector,
      concurrency: 1,
    });
    expect(first._tag).toBe("Reserved");
    if (first._tag !== "Reserved") return;
    expect(
      reserveBudget(first.state, {
        ...emptyBudgetVector,
        concurrency: 1,
      })._tag,
    ).toBe("Rejected");
    const reconciled = reconcileBudget(
      first.state,
      { ...emptyBudgetVector, concurrency: 1 },
      { ...emptyBudgetVector, concurrency: 1 },
    );
    expect(reconciled._tag).toBe("Reconciled");
    if (reconciled._tag !== "Reconciled") return;
    expect(
      reserveBudget(reconciled.state, {
        ...emptyBudgetVector,
        concurrency: 1,
      })._tag,
    ).toBe("Reserved");
  });

  it("accounts actual observations when use overruns a reservation", () => {
    const state = {
      limits: { ...emptyBudgetVector, tokens: 10 },
      reserved: { ...emptyBudgetVector, tokens: 4 },
      observed: emptyBudgetVector,
    };
    expect(
      reconcileBudget(
        state,
        { ...emptyBudgetVector, tokens: 4 },
        { ...emptyBudgetVector, tokens: 6 },
      ),
    ).toEqual({
      _tag: "ObservedOverrun",
      dimension: "tokens",
      reserved: 4,
      observed: 6,
      state: {
        ...state,
        reserved: emptyBudgetVector,
        observed: { ...emptyBudgetVector, tokens: 6 },
      },
    });
  });

  it("accounts actual observations when a cumulative budget is exhausted", () => {
    const state = {
      limits: { ...emptyBudgetVector, tokens: 5 },
      reserved: { ...emptyBudgetVector, tokens: 4 },
      observed: { ...emptyBudgetVector, tokens: 3 },
    };
    expect(
      reconcileBudget(
        state,
        { ...emptyBudgetVector, tokens: 4 },
        { ...emptyBudgetVector, tokens: 4 },
      ),
    ).toEqual({
      _tag: "BudgetExhausted",
      dimension: "tokens",
      limit: 5,
      accounted: 7,
      state: {
        ...state,
        reserved: emptyBudgetVector,
        observed: { ...emptyBudgetVector, tokens: 7 },
      },
    });
  });

  it("reports observed use plus remaining reservations on exhaustion", () => {
    const state = {
      limits: { ...emptyBudgetVector, tokens: 5 },
      reserved: { ...emptyBudgetVector, tokens: 4 },
      observed: { ...emptyBudgetVector, tokens: 3 },
    };
    expect(
      reconcileBudget(
        state,
        { ...emptyBudgetVector, tokens: 2 },
        { ...emptyBudgetVector, tokens: 1 },
      ),
    ).toMatchObject({
      _tag: "BudgetExhausted",
      dimension: "tokens",
      limit: 5,
      accounted: 6,
    });
  });

  it("does not accept even a zero reservation from an over-limit state", () => {
    expect(
      reserveBudget(
        {
          limits: { ...emptyBudgetVector, tokens: 5 },
          reserved: emptyBudgetVector,
          observed: { ...emptyBudgetVector, tokens: 7 },
        },
        emptyBudgetVector,
      ),
    ).toEqual({
      _tag: "Rejected",
      dimension: "tokens",
      available: 0,
      requested: 0,
    });
  });

  it("preserves cumulative safety across generated reserve/reconcile commands", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...budgetDimensions),
        fc.integer({ min: 0, max: 10_000 }),
        fc.array(budgetCommandArbitrary, { minLength: 1, maxLength: 80 }),
        (activeDimension, limit, commands) => {
          const limits = { ...emptyBudgetVector, [activeDimension]: limit };
          let state = initialBudgetState(limits);
          for (const command of commands) {
            let accepted = false;
            if (command._tag === "Reserve") {
              const request = {
                ...emptyBudgetVector,
                [activeDimension]: command.request[activeDimension],
              };
              const result = reserveBudget(state, request);
              if (result._tag === "Reserved") {
                state = result.state;
                accepted = true;
              }
            } else {
              const reservation = {
                ...emptyBudgetVector,
                [activeDimension]: command.reservation[activeDimension],
              };
              const observed = {
                ...emptyBudgetVector,
                [activeDimension]: command.observed[activeDimension],
              };
              const result = reconcileBudget(state, reservation, observed);
              if (result._tag !== "Rejected") state = result.state;
              accepted = result._tag === "Reconciled";
            }
            if (!accepted) continue;
            for (const dimension of cumulativeDimensions) {
              expect(
                state.observed[dimension] + state.reserved[dimension],
              ).toBeLessThanOrEqual(state.limits[dimension]);
            }
            expect(state.reserved.concurrency).toBeLessThanOrEqual(
              state.limits.concurrency,
            );
          }
        },
      ),
    );
  });
});
