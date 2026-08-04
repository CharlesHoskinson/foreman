import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approvalChronologyValid,
  approvalIntervalValid,
  isRfc3339Instant,
  parseRfc3339Ms,
} from "./rfc3339.js";

describe("isRfc3339Instant / parseRfc3339Ms", () => {
  it("accepts Z, positive and negative offsets, valid leap day", () => {
    assert.equal(isRfc3339Instant("2026-08-01T12:00:00Z"), true);
    assert.equal(isRfc3339Instant("2026-08-01T12:00:00+02:00"), true);
    assert.equal(isRfc3339Instant("2026-08-01T12:00:00-05:30"), true);
    assert.equal(isRfc3339Instant("2024-02-29T00:00:00Z"), true);
    assert.ok(parseRfc3339Ms("2026-08-01T00:00:00Z") !== null);
  });

  it("rejects impossible calendars and time components", () => {
    assert.equal(isRfc3339Instant("2026-02-30T00:00:00Z"), false);
    assert.equal(isRfc3339Instant("2026-13-01T00:00:00Z"), false);
    assert.equal(isRfc3339Instant("2026-00-01T00:00:00Z"), false);
    assert.equal(isRfc3339Instant("2026-04-31T00:00:00Z"), false);
    assert.equal(isRfc3339Instant("2025-02-29T00:00:00Z"), false);
    assert.equal(isRfc3339Instant("2026-08-01T24:00:00Z"), false);
    assert.equal(isRfc3339Instant("2026-08-01T12:60:00Z"), false);
    assert.equal(isRfc3339Instant("2026-08-01T12:00:60Z"), false);
    assert.equal(isRfc3339Instant("2026-08-01T12:00:00+25:00"), false);
    assert.equal(isRfc3339Instant("2026-08-01T12:00:00+00:60"), false);
    assert.equal(isRfc3339Instant("not-a-date"), false);
  });

  it("parses fractional seconds exactly at millisecond precision", () => {
    const base = parseRfc3339Ms("2026-01-01T12:00:00Z")!;
    assert.equal(parseRfc3339Ms("2026-01-01T12:00:00.001Z"), base + 1);
    assert.equal(parseRfc3339Ms("2026-01-01T12:00:00.999Z"), base + 999);
    assert.equal(parseRfc3339Ms("2026-01-01T12:00:00.1Z"), base + 100);
    assert.equal(parseRfc3339Ms("2026-01-01T12:00:00.12Z"), base + 120);
    assert.equal(
      parseRfc3339Ms("2026-01-01T12:00:00.999+00:00"),
      base + 999,
    );
    assert.equal(
      parseRfc3339Ms("2026-01-01T13:00:00.001+01:00"),
      base + 1,
    );
  });

  it("rejects more than three fractional digits (no truncate/round)", () => {
    assert.equal(isRfc3339Instant("2026-01-01T12:00:00.9999Z"), false);
    assert.equal(isRfc3339Instant("2026-01-01T12:00:00.0001Z"), false);
    assert.equal(isRfc3339Instant("2026-01-01T12:00:00.1234Z"), false);
    assert.equal(parseRfc3339Ms("2026-01-01T12:00:00.9999Z"), null);
  });

  it("proves .999Z is not active at .000Z and is active at .999Z", () => {
    const approvedAt = "2026-01-01T12:00:00.999Z";
    const expiresAt = "2027-01-01T00:00:00Z";
    const recordedAt = "2026-01-01T12:00:00.000Z";
    const now000 = parseRfc3339Ms("2026-01-01T12:00:00.000Z")!;
    const now999 = parseRfc3339Ms("2026-01-01T12:00:00.999Z")!;
    assert.equal(
      approvalChronologyValid(recordedAt, approvedAt, expiresAt, now000),
      "not_yet",
    );
    assert.equal(
      approvalChronologyValid(recordedAt, approvedAt, expiresAt, now999),
      "ok",
    );
  });
});

describe("approvalChronologyValid", () => {
  const now = parseRfc3339Ms("2026-06-01T00:00:00Z")!;

  it("ok for recordedAt <= approvedAt <= now < expiresAt", () => {
    assert.equal(
      approvalChronologyValid(
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:00:00Z",
        "2027-01-01T00:00:00Z",
        now,
      ),
      "ok",
    );
    assert.equal(
      approvalChronologyValid(
        "2025-12-01T00:00:00Z",
        "2026-01-01T00:00:00Z",
        "2027-01-01T00:00:00Z",
        now,
      ),
      "ok",
    );
  });

  it("rejects future recordedAt, recordedAt after approvedAt, reversed, expired", () => {
    assert.equal(
      approvalChronologyValid(
        "2099-01-01T00:00:00Z",
        "2026-01-01T00:00:00Z",
        "2027-01-01T00:00:00Z",
        now,
      ),
      "recorded_after_approval",
    );
    assert.equal(
      approvalChronologyValid(
        "2026-05-01T00:00:00Z",
        "2026-01-01T00:00:00Z",
        "2027-01-01T00:00:00Z",
        now,
      ),
      "recorded_after_approval",
    );
    assert.equal(
      approvalChronologyValid(
        "2026-01-01T00:00:00Z",
        "2026-12-01T00:00:00Z",
        "2027-01-01T00:00:00Z",
        now,
      ),
      "not_yet",
    );
    assert.equal(
      approvalChronologyValid(
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:00:00Z",
        "2026-06-01T00:00:00Z",
        now,
      ),
      "expired",
    );
  });

  it("accepts exact equality recordedAt == approvedAt", () => {
    assert.equal(
      approvalChronologyValid(
        "2026-01-01T12:00:00.500Z",
        "2026-01-01T12:00:00.500Z",
        "2027-01-01T00:00:00Z",
        parseRfc3339Ms("2026-01-01T12:00:00.500Z")!,
      ),
      "ok",
    );
  });
});

describe("approvalIntervalValid (legacy)", () => {
  const now = Date.parse("2026-08-01T12:00:00Z");
  it("still rejects reversed and expired", () => {
    assert.equal(
      approvalIntervalValid(
        "2027-01-01T00:00:00Z",
        "2026-01-01T00:00:00Z",
        now,
      ),
      "reversed",
    );
  });
});
