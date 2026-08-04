import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openSync, closeSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boundBytes, readFdBounded } from "./bounded-read.js";
import { isCoreFailure } from "./failures.js";
import { MAX_INPUT_BYTES } from "./utf8.js";

describe("boundBytes", () => {
  it("accepts at limit", () => {
    const data = new Uint8Array(MAX_INPUT_BYTES);
    const r = boundBytes(data, MAX_INPUT_BYTES);
    assert.ok(r instanceof Uint8Array);
    assert.equal(r.byteLength, MAX_INPUT_BYTES);
  });

  it("rejects limit plus one", () => {
    const data = new Uint8Array(MAX_INPUT_BYTES + 1);
    const r = boundBytes(data, MAX_INPUT_BYTES);
    assert.ok(isCoreFailure(r));
    assert.equal(r._tag, "OversizeInput");
  });
});

describe("readFdBounded", () => {
  it("accepts at limit and rejects oversize without retaining full excess", () => {
    const path = join(tmpdir(), `foreman-bound-${process.pid}.bin`);
    const limit = 64;
    try {
      writeFileSync(path, Buffer.alloc(limit, 0x41));
      const fdOk = openSync(path, "r");
      try {
        const ok = readFdBounded(fdOk, limit);
        assert.ok(ok instanceof Uint8Array);
        assert.equal(ok.byteLength, limit);
      } finally {
        closeSync(fdOk);
      }

      writeFileSync(path, Buffer.alloc(limit + 1, 0x42));
      const fdBad = openSync(path, "r");
      try {
        const bad = readFdBounded(fdBad, limit);
        assert.ok(isCoreFailure(bad));
        assert.equal(bad._tag, "OversizeInput");
      } finally {
        closeSync(fdBad);
      }
    } finally {
      try {
        unlinkSync(path);
      } catch {
        /* ignore */
      }
    }
  });

  it("stops after detecting growth past limit on sequential read", () => {
    const path = join(tmpdir(), `foreman-bound-grow-${process.pid}.bin`);
    try {
      writeFileSync(path, Buffer.alloc(33, 0x43));
      const fd = openSync(path, "r");
      try {
        const r = readFdBounded(fd, 32);
        assert.ok(isCoreFailure(r));
        assert.equal(r._tag, "OversizeInput");
      } finally {
        closeSync(fd);
      }
    } finally {
      try {
        unlinkSync(path);
      } catch {
        /* ignore */
      }
    }
  });
});
