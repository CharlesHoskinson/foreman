import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advancePhysicalLineCursor,
  CURSOR_ZERO,
  decodePhysicalLineCursor,
  decodePhysicalLineCursorText,
  isCursorFailure,
  type PhysicalLineCursor,
} from "./index.js";

describe("physical line cursor", () => {
  it("decodes cursor 0", () => {
    const r = decodePhysicalLineCursor(0);
    assert.ok(!isCursorFailure(r));
    assert.equal(r, CURSOR_ZERO);
  });

  it("decodes positive safe integers", () => {
    const r = decodePhysicalLineCursor(42);
    assert.ok(!isCursorFailure(r));
    assert.equal(r as number, 42);
  });

  it("rejects negative, float, NaN, unsafe", () => {
    for (const v of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      const r = decodePhysicalLineCursor(v);
      assert.ok(isCursorFailure(r), String(v));
      assert.equal(r.reason, "invalid_cursor");
    }
  });

  it("strict decimal text: digits only", () => {
    assert.equal(decodePhysicalLineCursorText("0") as number, 0);
    assert.equal(decodePhysicalLineCursorText("12") as number, 12);
    assert.equal(decodePhysicalLineCursorText(String(Number.MAX_SAFE_INTEGER)) as number, Number.MAX_SAFE_INTEGER);
  });

  it("rejects corrupt text without converting to 0", () => {
    const bad = [
      "",
      " ",
      "1 ",
      " 1",
      "+1",
      "-1",
      "1e2",
      "1.0",
      "01",
      "00",
      "\n1",
      "1\r",
      "1\n",
      "0x1",
      "abc",
      "1_000",
    ];
    for (const t of bad) {
      const r = decodePhysicalLineCursorText(t);
      assert.ok(isCursorFailure(r), JSON.stringify(t));
      assert.equal(r.reason, "invalid_cursor");
      assert.notEqual(r as unknown, 0);
    }
  });

  it("advance accepts equality and forward", () => {
    const a = decodePhysicalLineCursor(3) as PhysicalLineCursor;
    const b = decodePhysicalLineCursor(3) as PhysicalLineCursor;
    const c = decodePhysicalLineCursor(10) as PhysicalLineCursor;
    assert.equal(advancePhysicalLineCursor(a, b) as number, 3);
    assert.equal(advancePhysicalLineCursor(a, c) as number, 10);
  });

  it("advance rejects regression", () => {
    const a = decodePhysicalLineCursor(10) as PhysicalLineCursor;
    const b = decodePhysicalLineCursor(9) as PhysicalLineCursor;
    const r = advancePhysicalLineCursor(a, b);
    assert.ok(isCursorFailure(r));
    assert.equal(r.reason, "cursor_regression");
  });

  it("advance from zero works", () => {
    const r = advancePhysicalLineCursor(CURSOR_ZERO, decodePhysicalLineCursor(5) as PhysicalLineCursor);
    assert.ok(!isCursorFailure(r));
    assert.equal(r as number, 5);
  });
});
