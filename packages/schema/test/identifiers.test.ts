import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  AuthorityClass,
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
});
