/**
 * Live VendorPreflight inspect with injected ProcessExec / PathLookup.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import {
  PathLookup,
  ProcessExec,
  ProcessFailure,
  type CapturedProcessResult,
  type RunCapturedOptions,
  type RunForegroundOptions,
  type RunIgnoredStdioOptions,
} from "./queue-services.js";
import type { VendorCapabilityV1 } from "./vendor-preflight-manifest.js";
import {
  PreflightClock,
  inspectVendor,
} from "./vendor-preflight-live.js";
import { argvContainsMutatingUpdate } from "./vendor-preflight-manifest.js";

const FIXED_TS = "2026-08-04T12:00:00.000Z";

const grokCap: VendorCapabilityV1 = {
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
  diagnoseInstruction: "Re-run bounded grok models and inspect network",
};

const claudeCap: VendorCapabilityV1 = {
  vendor: "claude",
  cliName: "claude",
  evidenceClass: "declared",
  authArgv: ["auth", "status"],
  versionArgv: ["--version"],
  versionFloor: "2.1.220",
  authPositiveMarkers: [],
  authNegativeMarkers: [],
  updateMutates: true,
  updateCheckArgv: null,
  loginInstruction: "claude auth login",
  installInstruction: "Install Claude Code",
  updateInstruction: "claude update",
  diagnoseInstruction: "Re-run claude auth status",
};

const codexCap: VendorCapabilityV1 = {
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
};

type Call = {
  readonly command: string;
  readonly args: readonly string[];
};

function makeLayers(opts: {
  readonly which: string | null;
  readonly run: (
    o: RunCapturedOptions,
  ) => Effect.Effect<CapturedProcessResult, ProcessFailure>;
  readonly calls: Call[];
}) {
  const processLayer = Layer.succeed(ProcessExec, {
    runCaptured: (o) => {
      opts.calls.push({ command: o.command, args: o.args });
      return opts.run(o);
    },
    runIgnoredStdio: (_o: RunIgnoredStdioOptions) =>
      Effect.fail(new ProcessFailure("spawn_failed")),
    runForeground: (_o: RunForegroundOptions) =>
      Effect.fail(new ProcessFailure("spawn_failed")),
  });
  const pathLayer = Layer.succeed(PathLookup, {
    which: (name) =>
      Effect.sync(() =>
        opts.which !== null && name.length > 0 ? opts.which : null,
      ),
    fileExists: () => Effect.succeed(false),
    isExecutable: () => Effect.succeed(false),
  });
  const clockLayer = Layer.succeed(PreflightClock, {
    nowUtcRfc3339: () => Effect.succeed(FIXED_TS),
  });
  return Layer.mergeAll(processLayer, pathLayer, clockLayer);
}

async function runInspect(
  capability: VendorCapabilityV1,
  layer: Layer.Layer<ProcessExec | PathLookup | PreflightClock>,
) {
  return Effect.runPromise(
    inspectVendor(capability).pipe(Effect.provide(layer)),
  );
}

describe("inspectVendor live adapter", () => {
  it("Grok timeout -> auth unknown, timeout reason, no login instruction", async () => {
    const calls: Call[] = [];
    const layer = makeLayers({
      which: "/usr/bin/grok",
      calls,
      run: (o) => {
        if (o.args[0] === "models") {
          return Effect.fail(new ProcessFailure("timeout"));
        }
        return Effect.succeed({
          exitCode: 0,
          stdout: "0.2.118\n",
          stderr: "",
        });
      },
    });
    const rec = await runInspect(grokCap, layer);
    assert.equal(rec.facts.authenticated.value, "unknown");
    assert.match(rec.facts.authenticated.reason, /timeout/i);
    assert.notEqual(rec.remediation.kind, "login");
    assert.notEqual(rec.remediation.instruction, "grok login --device-code");
    assert.equal(rec.remediation.kind, "diagnose");
    const authProbe = rec.probes.find((p) => p.kind === "auth");
    assert.ok(authProbe);
    assert.equal(authProbe!.outcome, "timeout");
    assert.deepEqual(authProbe!.argv, ["/usr/bin/grok", "models"]);
  });

  it("recognized signed-out signal -> not-authenticated and vendor login only", async () => {
    const calls: Call[] = [];
    const layer = makeLayers({
      which: "/usr/bin/grok",
      calls,
      run: (o) => {
        if (o.args[0] === "models") {
          return Effect.succeed({
            exitCode: 0,
            stdout: "You are not authenticated.\n",
            stderr: "",
          });
        }
        return Effect.succeed({
          exitCode: 0,
          stdout: "0.2.118\n",
          stderr: "",
        });
      },
    });
    const rec = await runInspect(grokCap, layer);
    assert.equal(rec.facts.authenticated.value, "not-authenticated");
    assert.equal(rec.remediation.kind, "login");
    assert.equal(rec.remediation.instruction, "grok login --device-code");
  });

  it("unmatched zero-exit banner -> unknown", async () => {
    const calls: Call[] = [];
    const layer = makeLayers({
      which: "/usr/bin/grok",
      calls,
      run: (o) => {
        if (o.args[0] === "models") {
          return Effect.succeed({
            exitCode: 0,
            stdout: "unexpected banner from future release\n",
            stderr: "",
          });
        }
        return Effect.succeed({
          exitCode: 0,
          stdout: "0.2.118\n",
          stderr: "",
        });
      },
    });
    const rec = await runInspect(grokCap, layer);
    assert.equal(rec.facts.authenticated.value, "unknown");
    assert.equal(
      rec.probes.find((p) => p.kind === "auth")?.outcome,
      "unmatched_output",
    );
  });

  it("Claude valid loggedIn and malformed JSON", async () => {
    const calls: Call[] = [];
    const okLayer = makeLayers({
      which: "/usr/local/bin/claude",
      calls,
      run: (o) => {
        if (o.args[0] === "auth") {
          return Effect.succeed({
            exitCode: 0,
            stdout: JSON.stringify({ loggedIn: true }),
            stderr: "",
          });
        }
        return Effect.succeed({
          exitCode: 0,
          stdout: "2.1.220 (Claude Code)\n",
          stderr: "",
        });
      },
    });
    const ok = await runInspect(claudeCap, okLayer);
    assert.equal(ok.facts.authenticated.value, "authenticated");

    const badCalls: Call[] = [];
    const badLayer = makeLayers({
      which: "/usr/local/bin/claude",
      calls: badCalls,
      run: (o) => {
        if (o.args[0] === "auth") {
          return Effect.succeed({
            exitCode: 0,
            stdout: "not-json-at-all",
            stderr: "",
          });
        }
        return Effect.succeed({
          exitCode: 0,
          stdout: "2.1.220\n",
          stderr: "",
        });
      },
    });
    const bad = await runInspect(claudeCap, badLayer);
    assert.equal(bad.facts.authenticated.value, "unknown");
    assert.equal(
      bad.probes.find((p) => p.kind === "auth")?.outcome,
      "malformed_output",
    );
  });

  it("Codex recognized signed-out nonzero vs unrecognized nonzero", async () => {
    const signedCalls: Call[] = [];
    const signedLayer = makeLayers({
      which: "/usr/bin/codex",
      calls: signedCalls,
      run: (o) => {
        if (o.args[0] === "login") {
          return Effect.succeed({
            exitCode: 1,
            stdout: "Not logged in\n",
            stderr: "",
          });
        }
        return Effect.succeed({
          exitCode: 0,
          stdout: "codex-cli 0.146.0\n",
          stderr: "",
        });
      },
    });
    const signed = await runInspect(codexCap, signedLayer);
    assert.equal(signed.facts.authenticated.value, "not-authenticated");

    const unkCalls: Call[] = [];
    const unkLayer = makeLayers({
      which: "/usr/bin/codex",
      calls: unkCalls,
      run: (o) => {
        if (o.args[0] === "login") {
          return Effect.succeed({
            exitCode: 2,
            stdout: "internal transport fault\n",
            stderr: "",
          });
        }
        return Effect.succeed({
          exitCode: 0,
          stdout: "0.146.0\n",
          stderr: "",
        });
      },
    });
    const unk = await runInspect(codexCap, unkLayer);
    assert.equal(unk.facts.authenticated.value, "unknown");
  });

  it("missing CLI runs neither auth nor version process", async () => {
    const calls: Call[] = [];
    const layer = makeLayers({
      which: null,
      calls,
      run: () =>
        Effect.succeed({ exitCode: 0, stdout: "should-not-run", stderr: "" }),
    });
    const rec = await runInspect(grokCap, layer);
    assert.equal(rec.facts.discoverable.value, "missing");
    assert.equal(rec.resolvedPath, null);
    assert.equal(rec.probes.length, 0);
    assert.equal(calls.length, 0);
    assert.equal(rec.remediation.kind, "install");
  });

  it("authenticated below floor -> authenticated + outdated + update", async () => {
    const calls: Call[] = [];
    const layer = makeLayers({
      which: "/usr/bin/grok",
      calls,
      run: (o) => {
        if (o.args[0] === "models") {
          return Effect.succeed({
            exitCode: 0,
            stdout: "You are logged in with grok.com.\n",
            stderr: "",
          });
        }
        return Effect.succeed({
          exitCode: 0,
          stdout: "0.2.100\n",
          stderr: "",
        });
      },
    });
    const rec = await runInspect(grokCap, layer);
    assert.equal(rec.facts.authenticated.value, "authenticated");
    assert.equal(rec.facts.current.value, "outdated");
    assert.equal(rec.remediation.kind, "update");
    assert.notEqual(rec.remediation.kind, "login");
  });

  it("observed argv contains no mutating update command", async () => {
    const calls: Call[] = [];
    const layer = makeLayers({
      which: "/usr/bin/grok",
      calls,
      run: (o) => {
        if (o.args[0] === "models") {
          return Effect.succeed({
            exitCode: 0,
            stdout: "You are logged in with grok.com.\n",
            stderr: "",
          });
        }
        return Effect.succeed({
          exitCode: 0,
          stdout: "0.2.118\n",
          stderr: "",
        });
      },
    });
    const rec = await runInspect(grokCap, layer);
    for (const c of calls) {
      const full = [c.command, ...c.args];
      assert.equal(argvContainsMutatingUpdate(full, "grok"), false);
    }
    for (const p of rec.probes) {
      assert.equal(argvContainsMutatingUpdate(p.argv, "grok"), false);
    }
  });

  it("refuses Claude and Codex update --check --json at the live boundary without spawning", async () => {
    for (const base of [claudeCap, codexCap] as const) {
      const calls: Call[] = [];
      const poisoned: VendorCapabilityV1 = {
        ...base,
        authArgv: ["update", "--check", "--json"],
      };
      const layer = makeLayers({
        which: `/usr/bin/${base.cliName}`,
        calls,
        run: () =>
          Effect.succeed({
            exitCode: 0,
            stdout: "should never spawn\n",
            stderr: "",
          }),
      });
      const either = await Effect.runPromise(
        inspectVendor(poisoned).pipe(Effect.provide(layer), Effect.either),
      );
      assert.equal(either._tag, "Left");
      if (either._tag === "Left") {
        assert.equal(either.left.reason, "mutating_argv_refused");
      }
      assert.equal(
        calls.length,
        0,
        `${base.vendor} must not spawn update --check --json`,
      );
    }
  });

  it("timeout, output overflow, spawn failure, empty, cancel stay typed fail-closed", async () => {
    const cases: Array<{
      readonly fail: "timeout" | "output_bound" | "spawn_failed" | "cancelled";
    }> = [
      { fail: "timeout" },
      { fail: "output_bound" },
      { fail: "spawn_failed" },
      { fail: "cancelled" },
    ];
    for (const c of cases) {
      const calls: Call[] = [];
      const layer = makeLayers({
        which: "/usr/bin/grok",
        calls,
        run: (o) => {
          if (o.args[0] === "models") {
            return Effect.fail(new ProcessFailure(c.fail));
          }
          return Effect.succeed({
            exitCode: 0,
            stdout: "0.2.118\n",
            stderr: "",
          });
        },
      });
      const rec = await runInspect(grokCap, layer);
      assert.equal(rec.facts.authenticated.value, "unknown", c.fail);
      assert.notEqual(rec.remediation.kind, "login", c.fail);
      assert.equal(
        rec.probes.find((p) => p.kind === "auth")?.outcome,
        c.fail,
      );
    }

    // empty output
    const emptyCalls: Call[] = [];
    const emptyLayer = makeLayers({
      which: "/usr/bin/grok",
      calls: emptyCalls,
      run: (o) => {
        if (o.args[0] === "models") {
          return Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
        }
        return Effect.succeed({
          exitCode: 0,
          stdout: "0.2.118\n",
          stderr: "",
        });
      },
    });
    const empty = await runInspect(grokCap, emptyLayer);
    assert.equal(empty.facts.authenticated.value, "unknown");
    assert.equal(
      empty.probes.find((p) => p.kind === "auth")?.outcome,
      "empty_output",
    );
  });
});
