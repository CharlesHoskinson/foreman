import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  AuthorityClass,
  EpochMilliseconds,
  RunId,
  UtcTimestamp,
  ValidationStatus,
} from "../src/index.js";

describe("schema primitives", () => {
  it("accepts a prefixed uppercase ULID run identifier", () => {
    expect(
      Schema.decodeUnknownSync(RunId)("run_01ARZ3NDEKTSV4RRFFQ69G5FAV"),
    ).toBe("run_01ARZ3NDEKTSV4RRFFQ69G5FAV");
  });

  it("rejects an unprefixed identifier", () => {
    expect(() =>
      Schema.decodeUnknownSync(RunId)("01ARZ3NDEKTSV4RRFFQ69G5FAV"),
    ).toThrow();
  });

  it("rejects ULIDs whose timestamp prefix exceeds the 128-bit range", () => {
    expect(() =>
      Schema.decodeUnknownSync(RunId)("run_81ARZ3NDEKTSV4RRFFQ69G5FAV"),
    ).toThrow();
  });

  it("accepts both boundary values for the first ULID character", () => {
    expect(
      Schema.decodeUnknownSync(RunId)("run_01ARZ3NDEKTSV4RRFFQ69G5FAV"),
    ).toBe("run_01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(
      Schema.decodeUnknownSync(RunId)("run_71ARZ3NDEKTSV4RRFFQ69G5FAV"),
    ).toBe("run_71ARZ3NDEKTSV4RRFFQ69G5FAV");
  });

  it("rejects unknown authority and validation values", () => {
    expect(() => Schema.decodeUnknownSync(AuthorityClass)("system")).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(ValidationStatus)("trusted"),
    ).toThrow();
  });

  it("accepts a canonical UTC timestamp", () => {
    expect(
      Schema.decodeUnknownSync(UtcTimestamp)("2026-08-01T12:00:00.000Z"),
    ).toBe("2026-08-01T12:00:00.000Z");
  });

  it.each([
    "2026-02-29T12:00:00.000Z",
    "2026-13-01T12:00:00.000Z",
    "2026-08-01T24:00:00.000Z",
    "2026-08-01T12:00:00.001+00:00",
    "2026-08-01T12:00:00Z",
  ])("rejects an impossible or non-canonical UTC timestamp %s", (value) => {
    expect(() => Schema.decodeUnknownSync(UtcTimestamp)(value)).toThrow();
  });

  it("accepts only nonnegative safe epoch milliseconds", () => {
    expect(Schema.decodeUnknownSync(EpochMilliseconds)(0)).toBe(0);
    expect(
      Schema.decodeUnknownSync(EpochMilliseconds)(Number.MAX_SAFE_INTEGER),
    ).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(EpochMilliseconds)(value),
      ).toThrow();
    }
  });
});
