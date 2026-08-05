/**
 * Foreman Setup CLI: argument parse, readiness projection, vendor preflight
 * persistence, login instructions only for positive not-authenticated evidence.
 * Sprint 3 R4C2 + R7B1 profile-bound preflight — TDD red-first.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import { isCanonicalJsonText } from "@foreman/core";
import {
  PathLookup,
  ProcessExec,
  ProcessFailure,
  type RunCapturedOptions,
} from "./queue-services.js";
import { PreflightClock } from "./vendor-preflight-live.js";
import {
  decodeVendorPreflightRecordV1,
  isVendorPreflightContractFailure,
  type VendorPreflightRecordV1,
} from "./vendor-preflight-contract.js";
import type { VendorCapabilityTableV1 } from "./vendor-preflight-manifest.js";
import {
  livePreflightRecordStore,
  PreflightRecordStore,
  PreflightStoreFailure,
} from "./vendor-preflight-store.js";
import {
  decodeCredentialProfilePreflightV1,
  isProfilePreflightDecodeFailure,
  profilePreflightRecordPath,
} from "./credential-profile-preflight.js";
import {
  setCredentialProfileRaceHook,
} from "./credential-profile.js";
import {
  EXIT_BOUNDARY_FAILURE,
  EXIT_INVALID_ARGUMENTS,
  EXIT_NOT_READY,
  EXIT_READY,
  MSG_CAPABILITY_TABLE_LOAD_FAILED,
  MSG_EXPLICIT_PROFILE_UNSCOPED,
  USAGE,
  authInstruction,
  finalizeSetupExitCode,
  lexicalStateRootPreflight,
  parseSetupArgv,
  parseDurableEnabledFromToml,
  resolveForemanHome,
  resolvePreflightRecordPath,
  resolveSetupProfileId,
  runForemanSetup,
  stripSetupNodeArgv,
  type SetupIo,
} from "./foreman-setup.js";
const FIXED = "2026-08-04T15:00:00.000Z";

const capabilityTable: VendorCapabilityTableV1 = {
  schemaVersion: 1,
  capabilities: [
    {
      vendor: "grok",
      cliName: "grok",
      evidenceClass: "probed",
      authArgv: ["models"],
      versionArgv: ["--version"],
      versionFloor: "0.2.118",
      authPositiveMarkers: ["You are logged in with grok.com."],
      authNegativeMarkers: ["not authenticated", "sign in", "log in"],
      updateMutates: true,
      updateCheckArgv: ["update", "--check", "--json"],
      loginInstruction: "grok login --device-code",
      installInstruction: "npm install -g @xai-official/grok@latest",
      updateInstruction: "npm install -g @xai-official/grok@latest",
      diagnoseInstruction: "Re-run bounded grok models",
    },
    {
      vendor: "codex",
      cliName: "codex",
      evidenceClass: "declared",
      authArgv: ["login", "status"],
      versionArgv: ["--version"],
      versionFloor: "0.146.0",
      authPositiveMarkers: [],
      authNegativeMarkers: ["Not logged in"],
      updateMutates: true,
      updateCheckArgv: null,
      loginInstruction: "codex login",
      installInstruction: "npm install -g @openai/codex@latest",
      updateInstruction: "npm install -g @openai/codex@latest",
      diagnoseInstruction: "Re-run codex login status",
    },
  ],
};

function captureIo(): SetupIo & { stdout: string; stderr: string } {
  const io = {
    stdout: "",
    stderr: "",
    writeStdout(t: string) {
      io.stdout += t;
    },
    writeStderr(t: string) {
      io.stderr += t;
    },
  };
  return io;
}

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "foreman-setup-home-"));
}

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "foreman-setup-repo-"));
}

type CapturedEnvCall = {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv | undefined;
};

function vendorLayer(opts: {
  grokAuthStdout: string;
  codexAuthStdout?: string;
  capturedEnvs?: CapturedEnvCall[];
}): Layer.Layer<ProcessExec | PathLookup | PreflightClock> {
  return Layer.mergeAll(
    Layer.succeed(ProcessExec, {
      runCaptured: (o: RunCapturedOptions) => {
        opts.capturedEnvs?.push({
          command: o.command,
          args: o.args,
          env: o.env,
        });
        const name = o.command.includes("codex")
          ? "codex"
          : o.command.includes("grok")
            ? "grok"
            : o.command;
        const head = o.args[0] ?? "";
        if (head === "--version") {
          const ver =
            name === "codex" ? "codex-cli 0.146.0" : "grok 0.2.118";
          return Effect.succeed({
            exitCode: 0,
            stdout: ver + "\n",
            stderr: "",
          });
        }
        if (name === "grok" && head === "models") {
          return Effect.succeed({
            exitCode: 0,
            stdout: opts.grokAuthStdout,
            stderr: "",
          });
        }
        if (name === "codex" && head === "login") {
          return Effect.succeed({
            exitCode: 0,
            stdout: opts.codexAuthStdout ?? "Logged in\n",
            stderr: "",
          });
        }
        if (name === "grok" && head === "update") {
          return Effect.succeed({
            exitCode: 0,
            stdout: '{"update_available":false}\n',
            stderr: "",
          });
        }
        // Other tools: missing
        return Effect.fail(new ProcessFailure("spawn_failed"));
      },
      runIgnoredStdio: () => Effect.fail(new ProcessFailure("spawn_failed")),
      runForeground: () => Effect.fail(new ProcessFailure("spawn_failed")),
    }),
    Layer.succeed(PathLookup, {
      which: (n) => {
        if (n === "grok") return Effect.succeed("/usr/bin/grok");
        if (n === "codex") return Effect.succeed("/usr/bin/codex");
        return Effect.succeed(null);
      },
      fileExists: () => Effect.succeed(false),
      isExecutable: () => Effect.succeed(false),
    }),
    Layer.succeed(PreflightClock, {
      nowUtcRfc3339: () => Effect.succeed(FIXED),
    }),
  );
}

describe("parseSetupArgv", () => {
  it("defaults to soft profile, no lane, no explicit credential profile", () => {
    const p = parseSetupArgv([]);
    assert.equal(p._tag, "Run");
    if (p._tag === "Run") {
      assert.equal(p.profile, "soft");
      assert.equal(p.lane, null);
      assert.equal(p.credentialProfile, null);
    }
  });

  it("accepts --profile hard|full and --lane grok|codex", () => {
    const p = parseSetupArgv(["--profile", "full", "--lane", "codex"]);
    assert.equal(p._tag, "Run");
    if (p._tag === "Run") {
      assert.equal(p.profile, "full");
      assert.equal(p.lane, "codex");
      assert.equal(p.credentialProfile, null);
    }
  });

  it("accepts explicit --credential-profile with --lane", () => {
    const p = parseSetupArgv([
      "--lane",
      "grok",
      "--credential-profile",
      "lane-a",
    ]);
    assert.equal(p._tag, "Run");
    if (p._tag === "Run") {
      assert.equal(p.lane, "grok");
      assert.equal(p.credentialProfile, "lane-a");
    }
  });

  it("rejects duplicate --credential-profile", () => {
    const p = parseSetupArgv([
      "--lane",
      "grok",
      "--credential-profile",
      "a",
      "--credential-profile",
      "b",
    ]);
    assert.equal(p._tag, "Invalid");
  });

  it("rejects invalid credential profile id", () => {
    const p = parseSetupArgv([
      "--lane",
      "grok",
      "--credential-profile",
      "../evil",
    ]);
    assert.equal(p._tag, "Invalid");
  });

  it("rejects explicit credential profile on unscoped run", () => {
    const p = parseSetupArgv(["--credential-profile", "lane-a"]);
    assert.equal(p._tag, "Invalid");
    if (p._tag === "Invalid") {
      assert.equal(p.message, MSG_EXPLICIT_PROFILE_UNSCOPED);
    }
  });

  it("resolveSetupProfileId uses defaults and explicit override", () => {
    assert.equal(resolveSetupProfileId("grok", null), "grok-default");
    assert.equal(resolveSetupProfileId("codex", null), "codex-default");
    assert.equal(resolveSetupProfileId("grok", "lane-a"), "lane-a");
  });

  it("rejects --lane claude and unknown args with exit-2 shape", () => {
    const claude = parseSetupArgv(["--lane", "claude"]);
    assert.equal(claude._tag, "Invalid");
    const unk = parseSetupArgv(["--unknown"]);
    assert.equal(unk._tag, "Invalid");
    const badProf = parseSetupArgv(["--profile", "durable"]);
    assert.equal(badProf._tag, "Invalid");
  });

  it("help returns Help tag", () => {
    assert.equal(parseSetupArgv(["--help"])._tag, "Help");
  });

  it("stripSetupNodeArgv drops node and script", () => {
    assert.deepEqual(
      stripSetupNodeArgv(["node", "foreman-setup.js", "--profile", "soft"]),
      ["--profile", "soft"],
    );
  });
});

describe("authInstruction and paths", () => {
  it("returns known login instructions without absolute paths", () => {
    assert.match(authInstruction("grok"), /grok login --device-code/);
    assert.match(authInstruction("codex"), /codex login/);
    assert.doesNotMatch(authInstruction("grok"), /\//);
  });

  it("resolves FOREMAN_HOME and preflight record path", () => {
    const home = resolveForemanHome({ FOREMAN_HOME: "/tmp/fh" });
    assert.equal(home, "/tmp/fh");
    assert.equal(
      resolvePreflightRecordPath(home, "grok"),
      join("/tmp/fh", "preflight", "grok.json"),
    );
  });

  it("on native Windows prefers USERPROFILE over Git-Bash-style HOME", () => {
    const home = resolveForemanHome(
      {
        HOME: "/c/Users/runneradmin",
        USERPROFILE: "C:\\Users\\runneradmin",
      },
      "win32",
    );
    assert.equal(home, join("C:\\Users\\runneradmin", ".foreman"));
  });

  it("on POSIX prefers HOME over USERPROFILE", () => {
    const home = resolveForemanHome(
      {
        HOME: "/home/runneradmin",
        USERPROFILE: "C:\\Users\\runneradmin",
      },
      "linux",
    );
    assert.equal(home, join("/home/runneradmin", ".foreman"));
  });

  it("parseDurableEnabledFromToml reads repository TOML only", () => {
    assert.equal(parseDurableEnabledFromToml(""), null);
    assert.equal(
      parseDurableEnabledFromToml("[durable]\nenabled = false\n"),
      false,
    );
    assert.equal(
      parseDurableEnabledFromToml("[durable]\nenabled = true\n"),
      true,
    );
    assert.equal(
      parseDurableEnabledFromToml("[other]\nenabled = false\n"),
      null,
    );
  });
});

describe("runForemanSetup persistence and readiness", () => {
  it("persists not-ready grok record under FOREMAN_HOME and exits 1 with login line", async () => {
    const home = tempHome();
    const repo = tempRepo();
    const io = captureIo();
    try {
      const code = await Effect.runPromise(
        runForemanSetup(
          ["--profile", "soft", "--lane", "grok"],
          io,
          {
            repoRoot: repo,
            capabilityTable,
            processEnv: {
              HOME: home,
              FOREMAN_HOME: home,
              FOREMAN_TEST_WSL_FORCE: "0",
              PATH: "/usr/bin",
            },
            layer: vendorLayer({
              grokAuthStdout: "You are not authenticated.\n",
            }),
            storeLayer: livePreflightRecordStore,
            nowUtc: () => FIXED,
            // Skip launcher side effects
            ensureLauncher: () => Effect.succeed({ ok: true as const }),
            durableEnabled: null,
          },
        ),
      );
      assert.equal(code, EXIT_NOT_READY);
      assert.match(io.stdout, /SETUP: NOT-READY/);
      assert.match(io.stdout, /grok: NOT-READY -- run grok login --device-code/);
      assert.doesNotMatch(io.stdout, /SETUP: READY/);
      const path = resolvePreflightRecordPath(home, "grok");
      assert.ok(existsSync(path), "expected persisted grok.json");
      const body = readFileSync(path, "utf8");
      assert.ok(isCanonicalJsonText(body.replace(/\n$/, "")));
      const decoded = decodeVendorPreflightRecordV1(JSON.parse(body));
      assert.ok(!isVendorPreflightContractFailure(decoded));
      assert.equal(decoded.vendor, "grok");
      assert.equal(decoded.facts.authenticated.value, "not-authenticated");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("does not emit login instruction for degraded unknown auth", async () => {
    const home = tempHome();
    const repo = tempRepo();
    const io = captureIo();
    try {
      const code = await Effect.runPromise(
        runForemanSetup(["--profile", "soft", "--lane", "grok"], io, {
          repoRoot: repo,
          capabilityTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "Error: leader socket unavailable\n",
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.equal(code, EXIT_NOT_READY);
      assert.match(io.stdout, /SETUP: NOT-READY/);
      assert.doesNotMatch(
        io.stdout,
        /grok: NOT-READY -- run grok login --device-code/,
      );
      // Still persist the unknown-auth record.
      const path = resolvePreflightRecordPath(home, "grok");
      assert.ok(existsSync(path));
      const decoded = decodeVendorPreflightRecordV1(
        JSON.parse(readFileSync(path, "utf8")),
      );
      assert.ok(!isVendorPreflightContractFailure(decoded));
      assert.equal(decoded.facts.authenticated.value, "unknown");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("with --lane persists only that vendor", async () => {
    const home = tempHome();
    const repo = tempRepo();
    const io = captureIo();
    try {
      await Effect.runPromise(
        runForemanSetup(["--lane", "grok"], io, {
          repoRoot: repo,
          capabilityTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are not authenticated.\n",
            codexAuthStdout: "Not logged in\n",
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.ok(existsSync(resolvePreflightRecordPath(home, "grok")));
      assert.equal(
        existsSync(resolvePreflightRecordPath(home, "codex")),
        false,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("without --lane persists both grok and codex", async () => {
    const home = tempHome();
    const repo = tempRepo();
    const io = captureIo();
    try {
      await Effect.runPromise(
        runForemanSetup(["--profile", "soft"], io, {
          repoRoot: repo,
          capabilityTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are not authenticated.\n",
            codexAuthStdout: "Not logged in\n",
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.ok(existsSync(resolvePreflightRecordPath(home, "grok")));
      assert.ok(existsSync(resolvePreflightRecordPath(home, "codex")));
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("fail-closed exit 3 when requested vendor has no captured record (empty capability table)", async () => {
    const home = tempHome();
    const repo = tempRepo();
    const io = captureIo();
    const emptyTable: VendorCapabilityTableV1 = {
      schemaVersion: 1,
      capabilities: [],
    };
    try {
      const code = await Effect.runPromise(
        runForemanSetup(["--lane", "grok"], io, {
          repoRoot: repo,
          capabilityTable: emptyTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are logged in with grok.com.\n",
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.equal(code, EXIT_BOUNDARY_FAILURE);
      assert.doesNotMatch(io.stdout, /SETUP: READY/);
      assert.doesNotMatch(io.stdout, /SETUP: NOT-READY/);
      assert.match(io.stderr, /boundary|missing|preflight|record/i);
      assert.doesNotMatch(io.stderr, /\/home\/|\\\\Users\\\\|stack|Error:/i);
      assert.equal(
        existsSync(resolvePreflightRecordPath(home, "grok")),
        false,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("unscoped run with only Grok capture validates whole profile first: exit 3, writes neither vendor", async () => {
    // Cold-audit defect: must not write Grok then fail on missing Codex.
    // All requested captures must be present before the first store write.
    const home = tempHome();
    const repo = tempRepo();
    const io = captureIo();
    const grokOnlyTable: VendorCapabilityTableV1 = {
      schemaVersion: 1,
      capabilities: [capabilityTable.capabilities[0]!],
    };
    try {
      const code = await Effect.runPromise(
        runForemanSetup(["--profile", "soft"], io, {
          repoRoot: repo,
          capabilityTable: grokOnlyTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are logged in with grok.com.\n",
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.equal(code, EXIT_BOUNDARY_FAILURE);
      assert.doesNotMatch(io.stdout, /SETUP: READY/);
      assert.doesNotMatch(io.stdout, /SETUP: NOT-READY/);
      assert.match(io.stderr, /missing preflight record/i);
      assert.equal(
        existsSync(resolvePreflightRecordPath(home, "grok")),
        false,
        "must not write Grok when Codex capture is missing",
      );
      assert.equal(
        existsSync(resolvePreflightRecordPath(home, "codex")),
        false,
        "must not write Codex when capture is missing",
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });
  it("fail-closed exit 3 on store write failure; never SETUP: READY", async () => {
    const home = tempHome();
    const repo = tempRepo();
    const io = captureIo();
    const failStore = Layer.succeed(PreflightRecordStore, {
      read: () => Effect.fail(new PreflightStoreFailure("absent")),
      write: () => Effect.fail(new PreflightStoreFailure("write_failed")),
    });
    try {
      const code = await Effect.runPromise(
        runForemanSetup(["--lane", "grok"], io, {
          repoRoot: repo,
          capabilityTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are logged in with grok.com.\n",
          }),
          storeLayer: failStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.equal(code, EXIT_BOUNDARY_FAILURE);
      assert.doesNotMatch(io.stdout, /SETUP: READY/);
      assert.match(io.stderr, /preflight|persist|boundary/i);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("invalid arguments exit 2 without SETUP line", async () => {
    const io = captureIo();
    const code = await Effect.runPromise(
      runForemanSetup(["--lane", "claude"], io, {
        repoRoot: "/tmp",
        capabilityTable,
        ensureLauncher: () => Effect.succeed({ ok: true as const }),
      }),
    );
    assert.equal(code, EXIT_INVALID_ARGUMENTS);
    assert.doesNotMatch(io.stdout, /SETUP:/);
    assert.match(io.stderr, /usage:|lane|claude|invalid/i);
  });

  it("help exits 0 with usage", async () => {
    const io = captureIo();
    const code = await Effect.runPromise(
      runForemanSetup(["--help"], io, {
        repoRoot: "/tmp",
        capabilityTable,
      }),
    );
    assert.equal(code, EXIT_READY);
    assert.match(io.stdout, /usage:/);
    assert.equal(USAGE.includes("foreman-setup"), true);
  });

  it("prints durable.enabled=false warning without rewriting config", async () => {
    const home = tempHome();
    const repo = tempRepo();
    const io = captureIo();
    try {
      mkdirSync(join(repo, ".foreman"), { recursive: true });
      const cfg = join(repo, ".foreman/config.toml");
      writeFileSync(cfg, "[durable]\nenabled = false\n", "utf8");
      const before = readFileSync(cfg, "utf8");
      await Effect.runPromise(
        runForemanSetup(["--lane", "grok"], io, {
          repoRoot: repo,
          capabilityTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are not authenticated.\n",
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
        }),
      );
      assert.match(io.stdout, /durable\.enabled=false/);
      assert.match(io.stdout, /differs from the shipped/);
      assert.equal(readFileSync(cfg, "utf8"), before);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("lane ready when grok ok reports SETUP: READY even if other must-tools fail", async () => {
    const home = tempHome();
    const repo = tempRepo();
    const io = captureIo();
    try {
      const code = await Effect.runPromise(
        runForemanSetup(["--lane", "grok"], io, {
          repoRoot: repo,
          capabilityTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are logged in with grok.com.\n",
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.equal(code, EXIT_READY);
      assert.match(io.stdout, /SETUP: READY/);
      assert.match(io.stdout, /LANE_READY: grok=yes/);
      const path = resolvePreflightRecordPath(home, "grok");
      assert.ok(existsSync(path));
      const decoded = decodeVendorPreflightRecordV1(
        JSON.parse(readFileSync(path, "utf8")),
      );
      assert.ok(!isVendorPreflightContractFailure(decoded));
      assert.equal(decoded.facts.authenticated.value, "authenticated");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("USAGE constant", () => {
  it("documents profile, lane, and credential-profile flags", () => {
    assert.match(USAGE, /--profile soft\|hard\|full/);
    assert.match(USAGE, /--lane grok\|codex/);
    assert.match(USAGE, /--credential-profile ID/);
  });
});

describe("R7B1 profile-bound Setup preflight", () => {
  it("probes with profile-bound GROK_HOME and leaves caller env unchanged", async () => {
    const home = tempHome();
    const repo = tempRepo();
    const io = captureIo();
    const capturedEnvs: CapturedEnvCall[] = [];
    const callerEnv: NodeJS.ProcessEnv = {
      HOME: home,
      FOREMAN_HOME: home,
      FOREMAN_TEST_WSL_FORCE: "0",
      PATH: "/usr/bin",
      GROK_HOME: "/ambient/grok",
      CODEX_HOME: "/ambient/codex",
    };
    const frozen = { ...callerEnv };
    try {
      await Effect.runPromise(
        runForemanSetup(["--lane", "grok"], io, {
          repoRoot: repo,
          capabilityTable,
          processEnv: callerEnv,
          layer: vendorLayer({
            grokAuthStdout: "You are not authenticated.\n",
            capturedEnvs,
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.deepEqual(callerEnv, frozen, "caller environment must not mutate");
      const grokProbes = capturedEnvs.filter(
        (c) =>
          c.command.includes("grok") &&
          (c.args[0] === "--version" || c.args[0] === "models"),
      );
      assert.ok(grokProbes.length >= 2, "expected version and auth probes");
      for (const c of grokProbes) {
        assert.ok(c.env, "probe must receive explicit child env");
        assert.match(c.env!.GROK_HOME ?? "", /credential-profiles.*homes\/grok|credential-profiles.*homes\\grok/);
        assert.equal(Object.hasOwn(c.env!, "CODEX_HOME"), false);
        assert.equal(c.env!.GROK_HOME !== "/ambient/grok", true);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("probes with profile-bound CODEX_HOME and leaves caller env unchanged", async () => {
    const home = tempHome();
    const repo = tempRepo();
    const io = captureIo();
    const capturedEnvs: CapturedEnvCall[] = [];
    const callerEnv: NodeJS.ProcessEnv = {
      HOME: home,
      FOREMAN_HOME: home,
      FOREMAN_TEST_WSL_FORCE: "0",
      PATH: "/usr/bin",
      GROK_HOME: "/ambient/grok",
      CODEX_HOME: "/ambient/codex",
    };
    const frozen = { ...callerEnv };
    try {
      await Effect.runPromise(
        runForemanSetup(["--lane", "codex"], io, {
          repoRoot: repo,
          capabilityTable,
          processEnv: callerEnv,
          layer: vendorLayer({
            grokAuthStdout: "You are logged in with grok.com.\n",
            codexAuthStdout: "Not logged in\n",
            capturedEnvs,
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.deepEqual(callerEnv, frozen, "caller environment must not mutate");
      const codexProbes = capturedEnvs.filter(
        (c) =>
          c.command.includes("codex") &&
          (c.args[0] === "--version" || c.args[0] === "login"),
      );
      assert.ok(codexProbes.length >= 2, "expected version and auth probes");
      for (const c of codexProbes) {
        assert.ok(c.env, "probe must receive explicit child env");
        assert.match(
          c.env!.CODEX_HOME ?? "",
          /credential-profiles.*homes\/codex|credential-profiles.*homes\\codex/,
        );
        assert.equal(Object.hasOwn(c.env!, "GROK_HOME"), false);
        assert.equal(c.env!.CODEX_HOME !== "/ambient/codex", true);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("persists default profile-scoped preflight at the exact path", async () => {
    const home = tempHome();
    const repo = tempRepo();
    const io = captureIo();
    try {
      await Effect.runPromise(
        runForemanSetup(["--lane", "grok"], io, {
          repoRoot: repo,
          capabilityTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are not authenticated.\n",
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      const legacy = resolvePreflightRecordPath(home, "grok");
      const scoped = profilePreflightRecordPath(home, "grok-default", "grok");
      assert.ok(existsSync(legacy), "legacy path");
      assert.ok(existsSync(scoped), "profile-scoped path");
      const body = readFileSync(scoped, "utf8");
      assert.ok(body.endsWith("\n"));
      const decoded = decodeCredentialProfilePreflightV1(JSON.parse(body));
      assert.ok(!isProfilePreflightDecodeFailure(decoded));
      assert.equal(decoded.profileId, "grok-default");
      assert.equal(decoded.vendor, "grok");
      assert.equal(decoded.record.vendor, "grok");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("persists explicit profile-scoped preflight for lane-scoped run", async () => {
    const home = tempHome();
    const repo = tempRepo();
    const io = captureIo();
    try {
      await Effect.runPromise(
        runForemanSetup(
          ["--lane", "codex", "--credential-profile", "lane-x"],
          io,
          {
            repoRoot: repo,
            capabilityTable,
            processEnv: {
              HOME: home,
              FOREMAN_HOME: home,
              FOREMAN_TEST_WSL_FORCE: "0",
              PATH: "/usr/bin",
            },
            layer: vendorLayer({
              grokAuthStdout: "You are logged in with grok.com.\n",
              codexAuthStdout: "Not logged in\n",
            }),
            storeLayer: livePreflightRecordStore,
            nowUtc: () => FIXED,
            ensureLauncher: () => Effect.succeed({ ok: true as const }),
            durableEnabled: null,
          },
        ),
      );
      const scoped = profilePreflightRecordPath(home, "lane-x", "codex");
      assert.ok(existsSync(scoped));
      const decoded = decodeCredentialProfilePreflightV1(
        JSON.parse(readFileSync(scoped, "utf8")),
      );
      assert.ok(!isProfilePreflightDecodeFailure(decoded));
      assert.equal(decoded.profileId, "lane-x");
      assert.equal(decoded.vendor, "codex");
      // Explicit profile path must not write under codex-default.
      assert.equal(
        existsSync(profilePreflightRecordPath(home, "codex-default", "codex")),
        false,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("unscoped run writes both default profile preflight records", async () => {
    const home = tempHome();
    const repo = tempRepo();
    const io = captureIo();
    try {
      await Effect.runPromise(
        runForemanSetup(["--profile", "soft"], io, {
          repoRoot: repo,
          capabilityTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are not authenticated.\n",
            codexAuthStdout: "Not logged in\n",
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.ok(
        existsSync(profilePreflightRecordPath(home, "grok-default", "grok")),
      );
      assert.ok(
        existsSync(profilePreflightRecordPath(home, "codex-default", "codex")),
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("refuses when state root is inside the worktree before probes", async () => {
    const repo = tempRepo();
    const home = join(repo, "nested-foreman-home");
    mkdirSync(home, { recursive: true });
    const io = captureIo();
    const capturedEnvs: CapturedEnvCall[] = [];
    try {
      const code = await Effect.runPromise(
        runForemanSetup(["--lane", "grok"], io, {
          repoRoot: repo,
          capabilityTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are logged in with grok.com.\n",
            capturedEnvs,
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.equal(code, EXIT_BOUNDARY_FAILURE);
      assert.match(io.stderr, /credential profile refused/);
      assert.match(io.stderr, /state_root_in_worktree/);
      assert.equal(capturedEnvs.length, 0, "must not probe before refuse");
      assert.equal(existsSync(resolvePreflightRecordPath(home, "grok")), false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("lexical preflight refuses relative state root without filesystem mutation", () => {
    const repo = tempRepo();
    try {
      const r = lexicalStateRootPreflight("relative-home", repo);
      assert.equal(r._tag, "Refuse");
      if (r._tag === "Refuse") {
        assert.equal(r.reason, "invalid_state_root");
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("refuses missing state root under worktree without creating it", async () => {
    const repo = tempRepo();
    const home = join(repo, "missing-nested-home");
    assert.equal(existsSync(home), false);
    const io = captureIo();
    const capturedEnvs: CapturedEnvCall[] = [];
    try {
      const code = await Effect.runPromise(
        runForemanSetup(["--lane", "grok"], io, {
          repoRoot: repo,
          capabilityTable,
          processEnv: {
            HOME: "/tmp",
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are logged in with grok.com.\n",
            capturedEnvs,
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.equal(code, EXIT_BOUNDARY_FAILURE);
      assert.match(io.stderr, /state_root_in_worktree/);
      assert.equal(existsSync(home), false, "must not create under worktree");
      assert.equal(capturedEnvs.length, 0, "must not probe");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("refuses relative FOREMAN_HOME without mutation or probes", async () => {
    const repo = tempRepo();
    const io = captureIo();
    const capturedEnvs: CapturedEnvCall[] = [];
    try {
      const code = await Effect.runPromise(
        runForemanSetup(["--lane", "grok"], io, {
          repoRoot: repo,
          capabilityTable,
          processEnv: {
            HOME: "/tmp",
            FOREMAN_HOME: "not-absolute-home",
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are logged in with grok.com.\n",
            capturedEnvs,
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.equal(code, EXIT_BOUNDARY_FAILURE);
      assert.match(io.stderr, /invalid_state_root/);
      assert.equal(capturedEnvs.length, 0);
      assert.equal(existsSync(join(repo, "not-absolute-home")), false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("re-resolve after probes refuses changed authority and writes nothing", async () => {
    const home = tempHome();
    const repo = tempRepo();
    const io = captureIo();
    const capturedEnvs: CapturedEnvCall[] = [];
    const authPath = join(
      home,
      "credential-profiles",
      "grok-default",
      "profile.json",
    );
    // Fresh init reads authority once post-write. The next authority read is
    // post-probe resolveProfile — swap the inode so re-resolve fails closed.
    let authorityReads = 0;
    setCredentialProfileRaceHook({
      afterReadAuthority: () => {
        authorityReads += 1;
        if (authorityReads >= 2 && existsSync(authPath)) {
          const body = readFileSync(authPath);
          unlinkSync(authPath);
          writeFileSync(authPath, body);
        }
      },
    });
    try {
      const code = await Effect.runPromise(
        runForemanSetup(["--lane", "grok"], io, {
          repoRoot: repo,
          capabilityTable,
          processEnv: {
            HOME: home,
            FOREMAN_HOME: home,
            FOREMAN_TEST_WSL_FORCE: "0",
            PATH: "/usr/bin",
          },
          layer: vendorLayer({
            grokAuthStdout: "You are not authenticated.\n",
            capturedEnvs,
          }),
          storeLayer: livePreflightRecordStore,
          nowUtc: () => FIXED,
          ensureLauncher: () => Effect.succeed({ ok: true as const }),
          durableEnabled: null,
        }),
      );
      assert.equal(code, EXIT_BOUNDARY_FAILURE);
      assert.match(io.stderr, /credential profile refused/);
      assert.ok(
        capturedEnvs.length > 0,
        "probes must run before post-probe re-resolve refuse",
      );
      assert.equal(
        existsSync(profilePreflightRecordPath(home, "grok-default", "grok")),
        false,
      );
      assert.equal(existsSync(resolvePreflightRecordPath(home, "grok")), false);
    } finally {
      setCredentialProfileRaceHook(undefined);
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("explicit profile on unscoped run exits 2 without SETUP line", async () => {
    const io = captureIo();
    const code = await Effect.runPromise(
      runForemanSetup(["--credential-profile", "lane-a"], io, {
        repoRoot: "/tmp",
        capabilityTable,
        ensureLauncher: () => Effect.succeed({ ok: true as const }),
      }),
    );
    assert.equal(code, EXIT_INVALID_ARGUMENTS);
    assert.doesNotMatch(io.stdout, /SETUP:/);
    assert.match(io.stderr, /credential-profile requires --lane/);
  });
});

describe("boundary diagnostics and stream write settle", () => {
  it("capability-load diagnostic is fixed and sanitized (no raw exception)", () => {
    assert.equal(
      MSG_CAPABILITY_TABLE_LOAD_FAILED,
      "foreman-setup: capability table load failed",
    );
    // Fixed public string must not embed exception/path/stack markers.
    assert.doesNotMatch(
      MSG_CAPABILITY_TABLE_LOAD_FAILED,
      /ENOENT|EACCES|stack|Error:|\/home\/|\\\\Users\\\\|reference-manifest/i,
    );
    assert.equal(MSG_CAPABILITY_TABLE_LOAD_FAILED.includes("/"), false);
    assert.equal(MSG_CAPABILITY_TABLE_LOAD_FAILED.includes("\\"), false);
    // Must not append a dynamic suffix after the fixed sentence.
    assert.equal(
      MSG_CAPABILITY_TABLE_LOAD_FAILED,
      "foreman-setup: capability table load failed",
    );
  });
  it("finalizeSetupExitCode returns domain code when all writes succeed", async () => {
    const code = await finalizeSetupExitCode(EXIT_READY, [
      Promise.resolve(),
      Promise.resolve(),
    ]);
    assert.equal(code, EXIT_READY);
    const code2 = await finalizeSetupExitCode(EXIT_INVALID_ARGUMENTS, [
      Promise.resolve(),
    ]);
    assert.equal(code2, EXIT_INVALID_ARGUMENTS);
  });

  it("finalizeSetupExitCode returns exit 3 when any stdout/stderr write fails", async () => {
    const code = await finalizeSetupExitCode(EXIT_READY, [
      Promise.resolve(),
      Promise.reject(new Error("EPIPE")),
    ]);
    assert.equal(code, EXIT_BOUNDARY_FAILURE);

    const codeInvalid = await finalizeSetupExitCode(EXIT_INVALID_ARGUMENTS, [
      Promise.reject(Object.assign(new Error("EBADF"), { code: "EBADF" })),
    ]);
    assert.equal(codeInvalid, EXIT_BOUNDARY_FAILURE);
  });

  it("spawned dist: broken stdout pipe on --help exits 3 (not domain 0)", async () => {
    // Cold-audit witness class: failed stdout write must not keep domain exit 0.
    // On Linux Node 24, `1>&-` is remapped to /dev/null (writes succeed); a
    // destroyed pipe is the portable EPIPE regression for the same contract.
    const script = join(
      process.cwd(),
      "skills/foreman/runtime/dist/foreman-setup.js",
    );
    if (!existsSync(script)) {
      // Bundle absent in pure unit environments; unit settle tests still cover.
      return;
    }
    const { spawn } = await import("node:child_process");
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, [script, "--help"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (c: Buffer) => {
        stderr += c.toString();
      });
      // Close the read end immediately so the child's stdout write gets EPIPE.
      child.stdout.destroy();
      child.on("close", (c) => {
        // Must not leak stream error internals on the surviving stream.
        assert.doesNotMatch(stderr, /EPIPE|EBADF|Error: write|Unhandled/i);
        resolve(c);
      });
    });
    assert.equal(code, EXIT_BOUNDARY_FAILURE);
  });

  it("spawned dist: broken stderr pipe on invalid --lane exits 3 (not domain 2)", async () => {
    // Cold-audit witness class: failed stderr write must not keep domain exit 2.
    const script = join(
      process.cwd(),
      "skills/foreman/runtime/dist/foreman-setup.js",
    );
    if (!existsSync(script)) {
      return;
    }
    const { spawn } = await import("node:child_process");
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, [script, "--lane", "bad"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      child.stdout.on("data", (c: Buffer) => {
        stdout += c.toString();
      });
      child.stderr.destroy();
      child.on("close", (c) => {
        assert.doesNotMatch(stdout, /EPIPE|EBADF|Error: write|Unhandled/i);
        resolve(c);
      });
    });
    assert.equal(code, EXIT_BOUNDARY_FAILURE);
  });
});
