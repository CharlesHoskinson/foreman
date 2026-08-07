import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNameStatusDelta } from "./architecture-delta.js";
import { MAX_INPUT_BYTES } from "@foreman/core";

const enc = new TextEncoder();

describe("parseNameStatusDelta", () => {
  it("parses added modified deleted and renamed with hostile paths", () => {
    const hostile = "path with spaces/\tlead\ndash.js";
    const withNewline = "dir/\nfile.py";
    const raw =
      "A\0tools/new.py\0" +
      "M\0scripts/old.sh\0" +
      "D\0gone.ps1\0" +
      "R100\0old name.js\0" +
      hostile +
      "\0" +
      "A\0" +
      withNewline +
      "\0";
    const r = parseNameStatusDelta(enc.encode(raw));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.records.length, 5);
    assert.deepEqual(r.records[0], {
      kind: "added",
      path: "tools/new.py",
      status: "A",
    });
    assert.equal(r.records[1]!.kind, "modified");
    assert.equal(r.records[2]!.kind, "deleted");
    assert.equal(r.records[3]!.kind, "renamed");
    if (r.records[3]!.kind === "renamed") {
      assert.equal(r.records[3]!.oldPath, "old name.js");
      assert.equal(r.records[3]!.path, hostile);
    }
    assert.equal(r.records[4]!.path, withNewline);
  });

  it("rejects malformed and oversized deltas", () => {
    assert.equal(parseNameStatusDelta(enc.encode("A")).ok, false);
    assert.equal(parseNameStatusDelta(enc.encode("A\0")).ok, false);
    assert.equal(parseNameStatusDelta(enc.encode("X\0p\0")).ok, false);
    const big = new Uint8Array(MAX_INPUT_BYTES + 1);
    assert.deepEqual(parseNameStatusDelta(big), {
      ok: false,
      reason: "oversize_output",
    });
  });
});
