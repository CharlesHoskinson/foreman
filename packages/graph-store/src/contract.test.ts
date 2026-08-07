import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filesOnlyFactory,
  formatReport,
  runSuite,
  stubFactory,
} from "./contract-suite.js";

describe("GraphStore contract suite (files-only)", () => {
  it("passes every behavioral case", () => {
    const report = runSuite(filesOnlyFactory);
    if (!report.ok) {
      assert.fail(formatReport(report));
    }
    assert.equal(report.results.length, 18);
    assert.equal(report.failed, 0);
  });

  it("fails the deliberately broken stub for multiple independent reasons", () => {
    const report = runSuite(stubFactory);
    assert.equal(report.ok, false);
    assert.ok(report.failed >= 3, `expected >=3 failures, got ${report.failed}`);
  });
});
