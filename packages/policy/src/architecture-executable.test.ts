import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyExecutableSource,
  parseLsTreeLine,
  readShebangInterpreter,
  shebangReason,
  type FileIdentity,
} from "./architecture-executable.js";

const enc = (s: string) => new TextEncoder().encode(s);

const regular: FileIdentity = {
  present: true,
  mode: "100644",
  isExecutable: false,
  isSymlink: false,
  isSpecial: false,
};

const executable: FileIdentity = {
  present: true,
  mode: "100755",
  isExecutable: true,
  isSymlink: false,
  isSpecial: false,
};

describe("parseLsTreeLine", () => {
  it("parses regular, executable, symlink, and special modes", () => {
    const reg = parseLsTreeLine("100644 blob abcdef\tpath");
    assert.ok(!("error" in reg));
    if ("error" in reg) return;
    assert.equal(reg.isExecutable, false);
    assert.equal(reg.isSymlink, false);

    const exe = parseLsTreeLine("100755 blob abcdef\tbin/tool");
    assert.ok(!("error" in exe));
    if ("error" in exe) return;
    assert.equal(exe.isExecutable, true);

    const link = parseLsTreeLine("120000 blob abcdef\tlink");
    assert.ok(!("error" in link));
    if ("error" in link) return;
    assert.equal(link.isSymlink, true);

    const sub = parseLsTreeLine("160000 commit abcdef\tsub");
    assert.ok(!("error" in sub));
    if ("error" in sub) return;
    assert.equal(sub.isSpecial, true);
  });

  it("rejects malformed mode output", () => {
    assert.deepEqual(parseLsTreeLine("not-a-line"), { error: true });
    assert.deepEqual(parseLsTreeLine("100644 blob"), { error: true });
  });
});

describe("classifyExecutableSource", () => {
  it("rejects executable-mode extensionless file", () => {
    assert.equal(
      classifyExecutableSource({
        path: "bin/release-tool",
        identity: executable,
        bytes: enc("echo hi\n"),
      }),
      "prohibited_extensionless_executable",
    );
  });

  it("rejects non-executable Python shebang", () => {
    assert.equal(
      classifyExecutableSource({
        path: "bin/release-tool",
        identity: regular,
        bytes: enc("#!/usr/bin/env python3\nprint(1)\n"),
      }),
      "prohibited_python",
    );
  });

  it("rejects shell, bun, deno, and unknown shebangs", () => {
    assert.equal(
      classifyExecutableSource({
        path: "bin/x",
        identity: regular,
        bytes: enc("#!/bin/bash\n"),
      }),
      "prohibited_posix_shell",
    );
    assert.equal(
      classifyExecutableSource({
        path: "bin/x",
        identity: regular,
        bytes: enc("#!/usr/bin/env bun\n"),
      }),
      "prohibited_bun_only",
    );
    assert.equal(
      classifyExecutableSource({
        path: "bin/x",
        identity: regular,
        bytes: enc("#!/usr/bin/env deno\n"),
      }),
      "prohibited_deno_only",
    );
    assert.equal(
      classifyExecutableSource({
        path: "bin/x",
        identity: regular,
        bytes: enc("#!/usr/bin/env weird-interp\n"),
      }),
      "prohibited_extensionless_executable",
    );
  });

  it("accepts TypeScript with Node shebang", () => {
    assert.equal(
      classifyExecutableSource({
        path: "packages/cli/src/main.ts",
        identity: executable,
        bytes: enc("#!/usr/bin/env node\nexport const n = 1;\n"),
      }),
      null,
    );
  });

  it("rejects symlink and special modes", () => {
    assert.equal(
      classifyExecutableSource({
        path: "bin/x",
        identity: {
          present: true,
          mode: "120000",
          isExecutable: false,
          isSymlink: true,
          isSpecial: false,
        },
        bytes: enc("target"),
      }),
      "prohibited_special_mode",
    );
  });

  it("handles hostile path characters as one path", () => {
    const path = "bin/weird name/\ntool";
    assert.equal(
      classifyExecutableSource({
        path,
        identity: regular,
        bytes: enc("#!/usr/bin/env python3\n"),
      }),
      "prohibited_python",
    );
  });

  it("shebangReason and readShebangInterpreter helpers", () => {
    assert.equal(readShebangInterpreter(enc("nope")), null);
    assert.equal(shebangReason("/usr/bin/env python3", "x"), "prohibited_python");
    assert.equal(shebangReason("/usr/bin/env node", "a.ts"), null);
  });
});
