import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Redacted, Stream } from "effect";
import {
  createGeminiCliTransport,
  geminiConfigurationFiles,
} from "./gemini-cli.js";
import type { GeminiConfigurationV1 } from "./gemini-cli.js";
import type { NativeLaunchV1, NativeProcessPort } from "./native-process.js";
import type { ProviderRequestV1 } from "../contract.js";
import { defaultProviderControls } from "../controls.js";
import {
  controlsHash,
  resolveProfile,
  SOURCE_MANIFEST_HASH,
} from "../profiles.js";
import { createHash } from "node:crypto";
const schema = {
  type: "association",
  additionalKeys: false,
  fields: [
    { key: "answer", required: true, schema: { type: "string", maxBytes: 64 } },
  ],
} as const;
function request(): ProviderRequestV1 {
  const p = resolveProfile("gemini-3.8-flash");
  assert.ok(p.ok);
  return {
    schemaVersion: 1,
    effectId: "e",
    profileId: "gemini-3.8-flash",
    transportId: "gemini-cli",
    trustedInstructions: "Exact λ\n$(literal)",
    artifacts: [],
    toolPolicy: { mode: "none" },
    controls: {
      ...defaultProviderControls("gemini-3.8-flash", "google"),
      toolChoice: "none",
    },
    limits: {
      deadline: Date.now() + 60000,
      maxInputTokens: 1000,
      maxOutputTokens: 1000,
      maxToolCalls: 0,
      maxCostUsd: 1,
      maxOutputBytes: 10000,
      spendReservationRef: "r",
    },
    outputSchema: { id: "schema:test", content: schema },
    credentialProfileRef: "account:g",
    profileHash: p.value.profileHash,
    sourceManifestHash: SOURCE_MANIFEST_HASH,
    transportVersion: "1",
  };
}
const credentials = {
  resolve: () =>
    Effect.succeed({
      environment: { GEMINI_API_KEY: Redacted.make("fake-key") },
    }),
};
async function fixture(
  r: ProviderRequestV1,
  events: Record<string, unknown>[],
  nativeProfileDirectory?: string,
) {
  const directory = await mkdtemp(join(tmpdir(), "fm-gemini-test-"));
  const files = geminiConfigurationFiles(r);
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const settingsPath = join(directory, "settings.json"),
    defaultsPath = join(directory, "defaults.json"),
    adminPolicyPath = join(directory, "deny.toml");
  await Promise.all([
    writeFile(settingsPath, files.settings),
    writeFile(defaultsPath, files.defaults),
    writeFile(adminPolicyPath, files.policy),
  ]);
  const configuration: GeminiConfigurationV1 = {
    settingsPath,
    defaultsPath,
    adminPolicyPath,
    configDirectory: directory,
    settingsSha256: sha(files.settings),
    defaultsSha256: sha(files.defaults),
    policySha256: sha(files.policy),
    controlsHash: controlsHash(r.controls),
    systemPoliciesIsolated: true,
  };
  const launches: NativeLaunchV1[] = [];
  let closed = 0;
  const process: NativeProcessPort = {
    open: (launch) => {
      launches.push(launch);
      return Effect.succeed({
        events: Stream.fromIterable(events),
        send: () => Effect.die("unexpected send"),
        close: () =>
          Effect.sync(() => {
            closed++;
          }),
      });
    },
  };
  const transport = createGeminiCliTransport({
    credentials: nativeProfileDirectory
      ? { resolve: () => Effect.succeed({ nativeProfileDirectory }) }
      : credentials,
    schemaRegistry: { "schema:test": schema },
    configuration,
    protocolVersion: "0.59.0",
    host: {
      cwd: directory,
      environment: { PATH: "/usr/bin", GEMINI_CLI_HOME: "/ambient" },
      process,
      toolPolicyNoneEnforced: true,
      workspaceBoundaryEnforced: false,
      permissionBoundaryEnforced: false,
    },
  });
  return {
    transport,
    launches,
    configuration,
    directory,
    get closed() {
      return closed;
    },
    dispose: () => rm(directory, { recursive: true, force: true }),
  };
}
const events = [
  { type: "init", session_id: "s1", model: "gemini-3.8-flash" },
  {
    type: "message",
    role: "assistant",
    content: '{"answer":"λ"}',
    delta: true,
  },
  {
    type: "result",
    status: "success",
    stats: {
      input_tokens: 4,
      output_tokens: 5,
      cached: 1,
      models: { "gemini-3.8-flash": { input_tokens: 4, output_tokens: 5 } },
    },
  },
];
test("Gemini admin deny policy explicitly matches every tool in the required TOML field", () => {
  const policy = geminiConfigurationFiles(request()).policy;
  assert.match(policy, /^toolName = "\*"$/m);
  assert.match(policy, /^decision = "deny"$/m);
  assert.match(policy, /^priority = 999$/m);
  assert.equal((policy.match(/^\[\[rule\]\]$/gm) ?? []).length, 1);
});
test("Gemini CLI uses exact stdin, isolated settings, deny-all policy and observed per-model identity", async () => {
  const r = request();
  const f = await fixture(r, events);
  try {
    const output = await Effect.runPromise(
      Effect.scoped(
        f.transport.start(r).pipe(Effect.flatMap(Stream.runCollect)),
      ),
    );
    const completed = Array.from(output).at(-1);
    assert.equal(completed?.payload.type, "completed");
    assert.equal(completed?.providerIdentity.kind, "native");
    assert.equal(f.launches.length, 1);
    const launch = f.launches[0]!;
    assert.ok(launch.cmd.includes("--admin-policy"));
    assert.ok(launch.cmd.includes("gemini-3.8-flash"));
    assert.equal(launch.cmd.includes(r.trustedInstructions), false);
    assert.ok(
      Buffer.from(launch.initialInput!)
        .toString()
        .includes(r.trustedInstructions),
    );
    assert.equal(launch.closeInput, true);
    assert.equal(launch.environment.GEMINI_CLI_HOME, f.directory);
    assert.equal(
      launch.environment.GEMINI_CLI_SYSTEM_SETTINGS_PATH,
      f.configuration.settingsPath,
    );
    assert.equal(f.closed, 1);
  } finally {
    await f.dispose();
  }
});
test("Gemini refuses native coding, changed controls and config tampering before spawn", async () => {
  const r = request();
  const f = await fixture(r, events);
  try {
    for (const changed of [
      {
        ...r,
        toolPolicy: {
          mode: "native-coding" as const,
          workspaceGrantId: "g",
          permissionGrantIds: [],
          hostPermissionPortRef: "p",
        },
      },
      { ...r, controls: { ...r.controls, effort: "low" as const } },
    ]) {
      const result = await Effect.runPromise(
        Effect.scoped(Effect.either(f.transport.start(changed))),
      );
      assert.equal(result._tag, "Left");
    }
    await writeFile(f.configuration.adminPolicyPath, "allow all");
    const result = await Effect.runPromise(
      Effect.scoped(Effect.either(f.transport.start(r))),
    );
    assert.equal(result._tag, "Left");
    assert.equal(f.launches.length, 0);
  } finally {
    await f.dispose();
  }
});
test("Gemini never treats fallback model usage or tool execution as a valid completion", async () => {
  const r = request();
  for (const records of [
    [
      ...events.slice(0, 2),
      {
        type: "result",
        status: "success",
        stats: { models: { "different-model": { input_tokens: 1 } } },
      },
    ],
    [
      events[0]!,
      { type: "tool_use", tool_name: "run_shell_command", tool_id: "t1" },
    ],
  ]) {
    const f = await fixture(r, records);
    try {
      await assert.rejects(
        Effect.runPromise(
          Effect.scoped(
            f.transport.start(r).pipe(Effect.flatMap(Stream.runCollect)),
          ),
        ),
      );
      assert.equal(f.launches.length, 1);
    } finally {
      await f.dispose();
    }
  }
});
test("Gemini stream loss never restarts or claims cancellation", async () => {
  const r = request();
  const f = await fixture(r, events.slice(0, 2));
  try {
    await assert.rejects(
      Effect.runPromise(
        Effect.scoped(
          f.transport.start(r).pipe(Effect.flatMap(Stream.runCollect)),
        ),
      ),
      /OutcomeUnknown/,
    );
    const id = {
      kind: "native" as const,
      provider: "google",
      profileId: r.profileId,
      model: r.profileId,
      transportId: "gemini-cli",
      credentialProfileRef: r.credentialProfileRef,
      protocolVersion: "0.59.0",
      sessionId: "s1",
    };
    assert.equal(
      (await Effect.runPromise(f.transport.cancel(id))).remoteOutcome,
      "unknown",
    );
    const replay = await Effect.runPromise(
      Effect.scoped(Effect.either(f.transport.resume(r, id, "cursor"))),
    );
    assert.equal(replay._tag, "Left");
    assert.equal(f.launches.length, 1);
  } finally {
    await f.dispose();
  }
});
test("Gemini native OAuth profile selects its parent home without nesting another .gemini", async () => {
  const r = request();
  const f = await fixture(r, events, "/selected-account/.gemini");
  try {
    await Effect.runPromise(
      Effect.scoped(
        f.transport.start(r).pipe(Effect.flatMap(Stream.runCollect)),
      ),
    );
    assert.equal(
      f.launches[0]!.environment.GEMINI_CLI_HOME,
      "/selected-account",
    );
  } finally {
    await f.dispose();
  }
  const invalid = await fixture(r, events, "/selected-account/not-gemini");
  try {
    const result = await Effect.runPromise(
      Effect.scoped(Effect.either(invalid.transport.start(r))),
    );
    assert.equal(result._tag, "Left");
    assert.equal(invalid.launches.length, 0);
  } finally {
    await invalid.dispose();
  }
});
