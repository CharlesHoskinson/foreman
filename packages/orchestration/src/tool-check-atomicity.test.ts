/**
 * Focused atomicity / pin / probe-root tests for tool-check (architect R4B2
 * correction round). Written RED-first against the incomplete TypeScript port.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import {
  PathLookup,
  ProcessExec,
  ProcessFailure,
  livePathLookup,
  liveProcessExec,
} from "./queue-services.js";
import {
  classifyHostClass,
  type HostClass,
} from "./tool-check-platform.js";
import {
  countMkdirContentionViolations,
  lookupPinnedVerdict,
  parsePinnedRegisterToml,
  pickProbeRoots,
  probeFlockOnce,
  probeMkdirOnce,
  runAtomicityProbes,
  validatePinnedTraceContent,
  type PinnedRegisterEntry,
} from "./tool-check-atomicity.js";

const liveLayer = Layer.mergeAll(liveProcessExec, livePathLookup);

const stubNoStrace = Layer.mergeAll(
  Layer.succeed(ProcessExec, {
    runCaptured: (opts) => {
      if (opts.command.includes("strace") || opts.args?.[0] === "strace") {
        return Effect.fail(new ProcessFailure("spawn_failed"));
      }
      if (opts.args?.includes("--version")) {
        return Effect.succeed({
          exitCode: 0,
          stdout: "mkdir (GNU coreutils) 9.4\n",
          stderr: "",
        });
      }
      return Effect.succeed({ exitCode: 1, stdout: "", stderr: "" });
    },
    runIgnoredStdio: () => Effect.fail(new ProcessFailure("spawn_failed")),
    runForeground: () => Effect.fail(new ProcessFailure("spawn_failed")),
  }),
  Layer.succeed(PathLookup, {
    which: (name) =>
      Effect.succeed(
        name === "strace" ? null : name === "mkdir" ? "/bin/mkdir" : null,
      ),
    fileExists: () => Effect.succeed(true),
    isExecutable: () => Effect.succeed(true),
  }),
);

describe("classifyHostClass pure osName seam", () => {
  /**
   * Exhaustive table: must not read ambient process.platform. On hosted
   * Windows CI, injecting Linux/WSL osName must not become windows-native;
   * on Linux, injecting Windows_NT/win32 must become windows-native.
   */
  const table: ReadonlyArray<{
    readonly name: string;
    readonly env: NodeJS.ProcessEnv;
    readonly osName: string;
    readonly isWsl: boolean;
    readonly want: HostClass;
  }> = [
    {
      name: "Windows_NT → windows-native",
      env: {},
      osName: "Windows_NT",
      isWsl: false,
      want: "windows-native",
    },
    {
      name: "win32 → windows-native",
      env: {},
      osName: "win32",
      isWsl: false,
      want: "windows-native",
    },
    {
      name: "Linux → linux-native",
      env: {},
      osName: "Linux",
      isWsl: false,
      want: "linux-native",
    },
    {
      name: "Linux + WSL → wsl-linux",
      env: {},
      osName: "Linux",
      isWsl: true,
      want: "wsl-linux",
    },
    {
      name: "MINGW64 → msys2-git-bash (precedes windows)",
      env: {},
      osName: "MINGW64_NT-10.0-19045",
      isWsl: false,
      want: "msys2-git-bash",
    },
    {
      name: "MSYS → msys2-git-bash",
      env: {},
      osName: "MSYS_NT-10.0",
      isWsl: false,
      want: "msys2-git-bash",
    },
    {
      name: "CYGWIN → msys2-git-bash",
      env: {},
      osName: "CYGWIN_NT-10.0",
      isWsl: false,
      want: "msys2-git-bash",
    },
    {
      name: "valid override authoritative on every host",
      env: { FOREMAN_LOCK_HOST_CLASS: "linux-native" },
      osName: "Windows_NT",
      isWsl: false,
      want: "linux-native",
    },
    {
      name: "valid override windows-native on Linux osName",
      env: { FOREMAN_LOCK_HOST_CLASS: "windows-native" },
      osName: "Linux",
      isWsl: true,
      want: "windows-native",
    },
    {
      name: "valid override msys2 on Linux",
      env: { FOREMAN_LOCK_HOST_CLASS: "msys2-git-bash" },
      osName: "Linux",
      isWsl: true,
      want: "msys2-git-bash",
    },
    {
      name: "valid override wsl-linux",
      env: { FOREMAN_LOCK_HOST_CLASS: "wsl-linux" },
      osName: "Windows_NT",
      isWsl: false,
      want: "wsl-linux",
    },
    {
      name: "invalid override falls through to Windows_NT",
      env: { FOREMAN_LOCK_HOST_CLASS: "not-a-class" },
      osName: "Windows_NT",
      isWsl: false,
      want: "windows-native",
    },
    {
      name: "invalid override falls through to Linux",
      env: { FOREMAN_LOCK_HOST_CLASS: "not-a-class" },
      osName: "Linux",
      isWsl: false,
      want: "linux-native",
    },
    {
      name: "invalid override falls through to WSL",
      env: { FOREMAN_LOCK_HOST_CLASS: "bogus" },
      osName: "Linux",
      isWsl: true,
      want: "wsl-linux",
    },
    {
      name: "MSYS precedence over WSL flag",
      env: {},
      osName: "MINGW64_NT-10.0",
      isWsl: true,
      want: "msys2-git-bash",
    },
  ];

  for (const row of table) {
    it(row.name, () => {
      assert.equal(
        classifyHostClass(row.env, row.osName, row.isWsl),
        row.want,
        row.name,
      );
    });
  }
});

describe("parsePinnedRegisterToml", () => {
  it("returns empty array when register has no active pinned tables", () => {
    const text = `
# [[lock_atomicity.pinned]]
# mechanism = "mkdir"
[lock_atomicity.coreutils_hazard]
summary = "x"
`;
    const entries = parsePinnedRegisterToml(text);
    assert.equal(entries.length, 0);
  });

  it("parses a valid pinned table", () => {
    const text = `
[[lock_atomicity.pinned]]
mechanism = "mkdir"
sha256 = "abc"
host_class = "linux-native"
trace_artifact = "docs/t.trace"
probe_target = "x"
filesystem_classes = ["local"]
verdict = "atomic"
date = "2026-08-04"
notes = "ok"
`;
    const entries = parsePinnedRegisterToml(text);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.mechanism, "mkdir");
    assert.equal(entries[0]!.sha256, "abc");
    assert.equal(entries[0]!.probe_target, "x");
    assert.deepEqual(entries[0]!.filesystem_classes, ["local"]);
  });

  it("rejects unknown field in pinned table", () => {
    const text = `
[[lock_atomicity.pinned]]
mechanism = "mkdir"
sha256 = "abc"
host_class = "linux-native"
trace_artifact = "docs/t.trace"
probe_target = "x"
filesystem_classes = ["local"]
verdict = "atomic"
invented = "no"
`;
    const entries = parsePinnedRegisterToml(text);
    assert.equal(entries.length, 0);
  });

  it("rejects pinned table when filesystem_classes is omitted", () => {
    const text = `
[[lock_atomicity.pinned]]
mechanism = "mkdir"
sha256 = "abc"
host_class = "linux-native"
trace_artifact = "docs/t.trace"
probe_target = "x"
verdict = "atomic"
`;
    const entries = parsePinnedRegisterToml(text);
    assert.equal(entries.length, 0);
  });

  it("rejects pinned table when filesystem_classes is empty", () => {
    const text = `
[[lock_atomicity.pinned]]
mechanism = "mkdir"
sha256 = "abc"
host_class = "linux-native"
trace_artifact = "docs/t.trace"
probe_target = "x"
filesystem_classes = []
verdict = "atomic"
`;
    const entries = parsePinnedRegisterToml(text);
    assert.equal(entries.length, 0);
  });

  it("rejects pinned table when filesystem_classes is filtered-empty", () => {
    const text = `
[[lock_atomicity.pinned]]
mechanism = "mkdir"
sha256 = "abc"
host_class = "linux-native"
trace_artifact = "docs/t.trace"
probe_target = "x"
filesystem_classes = [""]
verdict = "atomic"
`;
    const entries = parsePinnedRegisterToml(text);
    assert.equal(entries.length, 0);
  });
});

describe("validatePinnedTraceContent", () => {
  it("mkdir requires probe_target-bound EEXIST", () => {
    const ok = validatePinnedTraceContent({
      mechanism: "mkdir",
      probeTarget: "x",
      content: '1234 mkdirat(AT_FDCWD, "/tmp/p/x", 0777) = -1 EEXIST (File exists)\n',
    });
    assert.equal(ok, true);
    const unbound = validatePinnedTraceContent({
      mechanism: "mkdir",
      probeTarget: "x",
      content: '1234 mkdirat(AT_FDCWD, "/tmp/other", 0777) = -1 EEXIST (File exists)\n',
    });
    assert.equal(unbound, false);
    const missingProbe = validatePinnedTraceContent({
      mechanism: "mkdir",
      probeTarget: "",
      content: 'mkdirat(..., "/tmp/p/x", ...) = -1 EEXIST\n',
    });
    assert.equal(missingProbe, false);
  });

  it("flock requires loser EAGAIN and independent holder evidence", () => {
    const loser =
      "flock(9, LOCK_EX|LOCK_NB) = -1 EAGAIN (Resource temporarily unavailable)\n";
    assert.equal(
      validatePinnedTraceContent({
        mechanism: "flock",
        probeTarget: "",
        content: loser,
      }),
      false,
    );
    assert.equal(
      validatePinnedTraceContent({
        mechanism: "flock",
        probeTarget: "",
        content: loser + "holder_acquired=1\n",
      }),
      true,
    );
    assert.equal(
      validatePinnedTraceContent({
        mechanism: "flock",
        probeTarget: "",
        content: loser + "flock(8, LOCK_EX) = 0\n",
      }),
      true,
    );
  });
});

describe("lookupPinnedVerdict", () => {
  it("never invents a pin when register is empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-pin-empty-"));
    try {
      const manifest = join(dir, "manifest.toml");
      writeFileSync(manifest, "# no pins\n", "utf8");
      const hit = lookupPinnedVerdict({
        mechanism: "mkdir",
        sha256: "deadbeef",
        hostClass: "linux-native",
        repoRoot: dir,
        manifestPath: manifest,
      });
      assert.equal(hit, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects wrong host_class", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-pin-host-"));
    try {
      const trace = join(dir, "t.trace");
      writeFileSync(
        trace,
        'mkdirat(AT_FDCWD, "/tmp/p/x", 0777) = -1 EEXIST (File exists)\n',
        "utf8",
      );
      const manifest = join(dir, "manifest.toml");
      writeFileSync(
        manifest,
        `
[[lock_atomicity.pinned]]
mechanism = "mkdir"
sha256 = "aa"
host_class = "msys2-git-bash"
trace_artifact = "t.trace"
probe_target = "x"
filesystem_classes = ["local"]
verdict = "atomic"
`,
        "utf8",
      );
      const hit = lookupPinnedVerdict({
        mechanism: "mkdir",
        sha256: "aa",
        hostClass: "linux-native",
        repoRoot: dir,
        manifestPath: manifest,
      });
      assert.equal(hit, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects wrong digest", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-pin-sha-"));
    try {
      const trace = join(dir, "t.trace");
      writeFileSync(
        trace,
        'mkdirat(AT_FDCWD, "/tmp/p/x", 0777) = -1 EEXIST (File exists)\n',
        "utf8",
      );
      const manifest = join(dir, "manifest.toml");
      writeFileSync(
        manifest,
        `
[[lock_atomicity.pinned]]
mechanism = "mkdir"
sha256 = "aa"
host_class = "linux-native"
trace_artifact = "t.trace"
probe_target = "x"
filesystem_classes = ["local"]
verdict = "atomic"
`,
        "utf8",
      );
      const hit = lookupPinnedVerdict({
        mechanism: "mkdir",
        sha256: "bb",
        hostClass: "linux-native",
        repoRoot: dir,
        manifestPath: manifest,
      });
      assert.equal(hit, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects symlink trace artifact", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-pin-sym-"));
    try {
      const real = join(dir, "real.trace");
      writeFileSync(
        real,
        'mkdirat(AT_FDCWD, "/tmp/p/x", 0777) = -1 EEXIST (File exists)\n',
        "utf8",
      );
      const link = join(dir, "t.trace");
      symlinkSync(real, link);
      const manifest = join(dir, "manifest.toml");
      writeFileSync(
        manifest,
        `
[[lock_atomicity.pinned]]
mechanism = "mkdir"
sha256 = "aa"
host_class = "linux-native"
trace_artifact = "t.trace"
probe_target = "x"
filesystem_classes = ["local"]
verdict = "atomic"
`,
        "utf8",
      );
      const hit = lookupPinnedVerdict({
        mechanism: "mkdir",
        sha256: "aa",
        hostClass: "linux-native",
        repoRoot: dir,
        manifestPath: manifest,
      });
      assert.equal(hit, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects mkdir pin without probe_target", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-pin-nopt-"));
    try {
      const trace = join(dir, "t.trace");
      writeFileSync(
        trace,
        'mkdirat(AT_FDCWD, "/tmp/p/x", 0777) = -1 EEXIST (File exists)\n',
        "utf8",
      );
      const manifest = join(dir, "manifest.toml");
      writeFileSync(
        manifest,
        `
[[lock_atomicity.pinned]]
mechanism = "mkdir"
sha256 = "aa"
host_class = "linux-native"
trace_artifact = "t.trace"
filesystem_classes = ["local"]
verdict = "atomic"
`,
        "utf8",
      );
      const hit = lookupPinnedVerdict({
        mechanism: "mkdir",
        sha256: "aa",
        hostClass: "linux-native",
        repoRoot: dir,
        manifestPath: manifest,
      });
      assert.equal(hit, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts matching host, digest, probe-bound trace", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-pin-ok-"));
    try {
      const trace = join(dir, "t.trace");
      writeFileSync(
        trace,
        'mkdirat(AT_FDCWD, "/tmp/p/x", 0777) = -1 EEXIST (File exists)\n',
        "utf8",
      );
      const manifest = join(dir, "manifest.toml");
      writeFileSync(
        manifest,
        `
[[lock_atomicity.pinned]]
mechanism = "mkdir"
sha256 = "AA"
host_class = "linux-native"
trace_artifact = "t.trace"
probe_target = "x"
filesystem_classes = ["local", "mnt-drvfs"]
verdict = "atomic"
`,
        "utf8",
      );
      const hit = lookupPinnedVerdict({
        mechanism: "mkdir",
        sha256: "aa",
        hostClass: "linux-native",
        repoRoot: dir,
        manifestPath: manifest,
      });
      assert.ok(hit);
      assert.equal(hit!.verdict, "atomic");
      assert.equal(hit!.evidence_class, "pinned-mechanism");
      assert.deepEqual(hit!.filesystem_classes, ["local", "mnt-drvfs"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects empty and out-of-root traces", () => {
    const dir = mkdtempSync(join(tmpdir(), "fm-pin-oor-"));
    const outside = mkdtempSync(join(tmpdir(), "fm-pin-out-"));
    try {
      writeFileSync(join(dir, "empty.trace"), "", "utf8");
      const outsideTrace = join(outside, "out.trace");
      writeFileSync(
        outsideTrace,
        'mkdirat(AT_FDCWD, "/tmp/p/x", 0777) = -1 EEXIST (File exists)\n',
        "utf8",
      );
      const manifest = join(dir, "manifest.toml");
      writeFileSync(
        manifest,
        `
[[lock_atomicity.pinned]]
mechanism = "mkdir"
sha256 = "aa"
host_class = "linux-native"
trace_artifact = "empty.trace"
probe_target = "x"
filesystem_classes = ["local"]
verdict = "atomic"
`,
        "utf8",
      );
      assert.equal(
        lookupPinnedVerdict({
          mechanism: "mkdir",
          sha256: "aa",
          hostClass: "linux-native",
          repoRoot: dir,
          manifestPath: manifest,
        }),
        null,
      );
      writeFileSync(
        manifest,
        `
[[lock_atomicity.pinned]]
mechanism = "mkdir"
sha256 = "aa"
host_class = "linux-native"
trace_artifact = ${JSON.stringify(outsideTrace)}
probe_target = "x"
filesystem_classes = ["local"]
verdict = "atomic"
`,
        "utf8",
      );
      assert.equal(
        lookupPinnedVerdict({
          mechanism: "mkdir",
          sha256: "aa",
          hostClass: "linux-native",
          repoRoot: dir,
          manifestPath: manifest,
        }),
        null,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("countMkdirContentionViolations", () => {
  it("counts overlapping ENTER without EXIT", () => {
    assert.equal(
      countMkdirContentionViolations("ENTER\nENTER\nEXIT\nEXIT\n"),
      1,
    );
    assert.equal(countMkdirContentionViolations("ENTER\nEXIT\nENTER\nEXIT\n"), 0);
  });
});

describe("no-strace mkdir path uses contention evidence", () => {
  it("labels clean sample unknown/contention not flavour", async () => {
    if (process.platform === "win32") return;
    const parent = mkdtempSync(join(tmpdir(), "fm-mkdir-ct-"));
    try {
      // Force no-strace path by injecting PathLookup without strace and using
      // real mkdir via process.execPath is not enough — use live layer but
      // PATH that hides strace is hard. Call the contention helper contract
      // via probe with stub that reports no strace.
      const whichMkdir = "/bin/mkdir";
      if (!existsSync(whichMkdir)) return;
      const once = await Effect.runPromise(
        probeMkdirOnce(whichMkdir, parent).pipe(
          Effect.provide(
            Layer.mergeAll(
              liveProcessExec,
              Layer.succeed(PathLookup, {
                which: (n) =>
                  Effect.succeed(
                    n === "strace" ? null : n === "mkdir" ? whichMkdir : null,
                  ),
                fileExists: () => Effect.succeed(true),
                isExecutable: () => Effect.succeed(true),
              }),
            ),
          ),
        ),
      );
      // Without strace: evidence must be contention (never flavour for the
      // sample path), verdict unknown or non-atomic.
      assert.equal(once.evidence, "contention");
      assert.ok(once.verdict === "unknown" || once.verdict === "non-atomic");
      assert.doesNotMatch(once.notes, /^flavour/);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe("probeFlockOnce holder/loser", () => {
  it("does not license atomic from a single unheld flock strace", async () => {
    if (process.platform === "win32") return;
    const parent = mkdtempSync(join(tmpdir(), "fm-flock-bad-"));
    try {
      // Live flock+strace: real concurrent proof may yield atomic. The
      // regression is that a path without holder must not yield atomic.
      // Force holder failure by using a non-executable flock path after
      // isExecutable is mocked true — use a fake flock that cannot hold.
      const fake = join(parent, "fake-flock");
      writeFileSync(
        fake,
        "#!/bin/sh\necho fail\nexit 1\n",
        { mode: 0o755 },
      );
      const once = await Effect.runPromise(
        probeFlockOnce(fake, parent).pipe(
          Effect.provide(
            Layer.mergeAll(
              liveProcessExec,
              Layer.succeed(PathLookup, {
                which: (n) =>
                  Effect.succeed(n === "strace" ? "/usr/bin/strace" : null),
                fileExists: () => Effect.succeed(true),
                isExecutable: () => Effect.succeed(true),
              }),
            ),
          ),
        ),
      );
      assert.notEqual(once.verdict, "atomic");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("live flock+strace can prove atomic with holder+loser when tools exist", async () => {
    if (process.platform === "win32") return;
    const parent = mkdtempSync(join(tmpdir(), "fm-flock-live-"));
    try {
      const flockPath = await Effect.runPromise(
        Effect.gen(function* () {
          const paths = yield* PathLookup;
          return yield* paths.which("flock");
        }).pipe(Effect.provide(liveLayer)),
      );
      if (!flockPath) return;
      const once = await Effect.runPromise(
        probeFlockOnce(flockPath, parent).pipe(Effect.provide(liveLayer)),
      );
      // On a normal Linux host with util-linux flock + strace this is atomic.
      // If tools missing, unknown is acceptable; atomic without holder notes is not.
      if (once.verdict === "atomic") {
        assert.equal(once.evidence, "syscall");
        assert.match(once.notes, /holder proceeded|LOCK_EX\|LOCK_NB/);
      } else {
        assert.notEqual(once.verdict, "atomic");
      }
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe("pickProbeRoots distinct mount keys", () => {
  it("dedupes identical filesystem-class + mount-target keys", async () => {
    const a = mkdtempSync(join(tmpdir(), "fm-probe-a-"));
    const b = mkdtempSync(join(tmpdir(), "fm-probe-b-"));
    try {
      const roots = await Effect.runPromise(
        pickProbeRoots({
          candidates: [a, a, b, join(tmpdir(), "fm-probe-missing-xyz")],
        }).pipe(Effect.provide(liveLayer)),
      );
      const set = new Set(roots);
      assert.equal(set.size, roots.length);
      assert.ok(roots.length >= 1);
      assert.ok(roots.every((r) => existsSync(r)));
      assert.ok(roots.includes(a));
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  it("falls back to existing writable portable dir when candidates missing", async () => {
    const portable = mkdtempSync(join(tmpdir(), "fm-probe-fb-"));
    try {
      const roots = await Effect.runPromise(
        pickProbeRoots({
          candidates: [
            join(tmpdir(), "fm-probe-no-a"),
            join(tmpdir(), "fm-probe-no-b"),
          ],
          fallback: portable,
        }).pipe(Effect.provide(liveLayer)),
      );
      assert.deepEqual(roots, [portable]);
      assert.ok(existsSync(roots[0]!));
    } finally {
      rmSync(portable, { recursive: true, force: true });
    }
  });

  it("never returns a nonexistent probe root for invalid fallback", async () => {
    const roots = await Effect.runPromise(
      pickProbeRoots({
        candidates: [
          join(tmpdir(), "fm-probe-no-c"),
          join(tmpdir(), "fm-probe-no-d"),
        ],
        fallback: join(tmpdir(), "fm-probe-no-fallback-xyz"),
      }).pipe(Effect.provide(liveLayer)),
    );
    // May use portable tmpdir() safe alternative, or empty — never a ghost path.
    assert.ok(roots.every((r) => existsSync(r)));
    if (roots.length > 0) {
      assert.ok(roots.includes(tmpdir()) || roots.every((r) => existsSync(r)));
    }
  });

  it("default fallback is portable tmpdir when no candidates writable", async () => {
    const roots = await Effect.runPromise(
      pickProbeRoots({
        candidates: [
          join(tmpdir(), "fm-probe-no-e"),
          join(tmpdir(), "fm-probe-no-f"),
        ],
      }).pipe(Effect.provide(liveLayer)),
    );
    assert.ok(roots.length >= 1);
    assert.ok(roots.every((r) => existsSync(r)));
    assert.ok(roots.includes(tmpdir()));
  });
});

describe("runAtomicityProbes wires hostClass into pin path", () => {
  it("passes hostClass through (pin never fires on empty register)", async () => {
    if (process.platform === "win32") return;
    const hostClass: HostClass = "linux-native";
    const result = await Effect.runPromise(
      runAtomicityProbes({
        timestamp: "2026-08-04T00:00:00Z",
        profile: "soft",
        hostClass,
        repoRoot: process.cwd(),
        processEnv: { FOREMAN_LOCK_HOST_CLASS: hostClass },
      }).pipe(Effect.provide(liveLayer)),
    );
    assert.ok(Array.isArray(result.rows));
    // Pin path is exercised without inventing pins: empty register stays empty.
    for (const row of result.rows) {
      if (row.evidence_class === "pinned-mechanism") {
        // Only valid if a real pin existed; current manifest has zero.
        assert.fail("empty register must not produce pinned-mechanism");
      }
    }
  });
});

// Ensure PinnedRegisterEntry type is used
void (null as unknown as PinnedRegisterEntry);
void stubNoStrace;
void mkdirSync;
void readFileSync;
