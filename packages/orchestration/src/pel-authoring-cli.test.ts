import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { makeForemanCli } from "./pel-authoring-cli.js";
import { authoringFailure } from "./pel-authoring-contract.js";
import { createDefaultAuthoringSnapshotV1 } from "./pel-host-descriptors.js";
function fixture(source = "(+ 1 2)") {
  const read: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const files: Record<string, string> = {
    "input.pel": source,
    "default.json": JSON.stringify(createDefaultAuthoringSnapshotV1()),
  };
  const cli = makeForemanCli({
    context: { defaultSnapshotPath: "default.json" },
    input: {
      read: (path, max) =>
        Effect.suspend(() => {
          read.push(path);
          const text = files[path];
          return text === undefined
            ? Effect.fail(
                authoringFailure("PEL_INPUT", "Missing file", 2, path),
              )
            : Buffer.byteLength(text) > max
              ? Effect.fail(authoringFailure("PEL_LIMIT", "Too large", 2, path))
              : Effect.succeed(Buffer.from(text));
        }),
    },
    output: {
      stdout: (s) =>
        Effect.sync(() => {
          out.push(s);
        }),
      stderr: (s) =>
        Effect.sync(() => {
          err.push(s);
        }),
    },
  });
  return { cli, read, out, err, files };
}
test("CLI rejects misuse before reading files and emits one JSON object", async () => {
  for (const args of [
    ["check", "--json"],
    ["check", "input.pel", "--prompt", "x", "--json"],
    ["plan", "input.pel", "--fixture-manifest", "x", "--json"],
  ]) {
    const f = fixture();
    const r = await Effect.runPromise(f.cli.run(args));
    assert.equal(r.exitCode, 2);
    assert.deepEqual(f.read, []);
    assert.equal(f.out.length, 1);
    assert.equal(JSON.parse(f.out[0]!).code, "PEL_CLI_USAGE");
    assert.deepEqual(f.err, []);
  }
});
test("CLI pure plan yields known arithmetic with no provider service", async () => {
  const f = fixture();
  const r = await Effect.runPromise(f.cli.run(["plan", "input.pel", "--json"]));
  assert.equal(r.exitCode, 0);
  const result = JSON.parse(f.out.join(""));
  assert.deepEqual(result.finalValueSummary, {
    kind: "known",
    value: { tag: "number", value: 3 },
  });
  assert.deepEqual(f.err, []);
});
test("CLI diagnostics retain source range and human caret", async () => {
  const f = fixture("(missing 1)");
  const r = await Effect.runPromise(f.cli.run(["check", "input.pel"]));
  assert.equal(r.exitCode, 2);
  assert.match(f.err.join(""), /input.pel:1:/);
  assert.match(f.err.join(""), /\^/);
  assert.match(f.err.join(""), /PEL_UNBOUND_SYMBOL/);
});
test("CLI rejects changed snapshot digest", async () => {
  const f = fixture();
  const snapshot = JSON.parse(f.files["default.json"]!);
  snapshot.defaultCredentialProfileRef = "account:tampered";
  f.files["default.json"] = JSON.stringify(snapshot);
  const r = await Effect.runPromise(
    f.cli.run(["check", "input.pel", "--json"]),
  );
  assert.equal(r.exitCode, 2);
});

test("generation failures retain attempt diagnostics and cumulative usage in JSON", async () => {
  const out: string[] = [];
  const snapshot = JSON.stringify(createDefaultAuthoringSnapshotV1());
  const cli = makeForemanCli({
    context: { defaultSnapshotPath: "default" },
    input: { read: () => Effect.succeed(Buffer.from(snapshot)) },
    output: {
      stdout: (text) =>
        Effect.sync(() => {
          out.push(text);
        }),
      stderr: () => Effect.void,
    },
    generate: () =>
      Effect.fail({
        _tag: "PelGenerationFailure",
        code: "PEL_GENERATION_EXHAUSTED",
        message: "Three candidates failed",
        attemptDiagnostics: [
          { attempt: 0, diagnostics: [], sourceSample: "(" },
        ],
        cumulativeUsage: {
          inputTokens: 10,
          outputTokens: 20,
          providerCounters: { costUnits: 3 },
        },
      }),
  });
  const result = await Effect.runPromise(
    cli.run([
      "plan",
      "--prompt",
      "Write arithmetic",
      "--model",
      "gpt-6-astra",
      "--transport",
      "openai-responses",
      "--json",
    ]),
  );
  assert.equal(result.exitCode, 1);
  const value = JSON.parse(out.join(""));
  assert.equal(value.attemptDiagnostics.length, 1);
  assert.equal(value.cumulativeUsage.inputTokens, 10);
});

test("generation selection and controls fail before any provider call", async () => {
  const source = createDefaultAuthoringSnapshotV1();
  let calls = 0;
  const files: Record<string, string> = {
    snapshot: JSON.stringify(source),
    controls: JSON.stringify({
      ...source.providerProfiles[0]!.applicationDefaults,
      toolChoice: "none",
      surprise: true,
    }),
  };
  const output: string[] = [];
  const cli = makeForemanCli({
    context: { defaultSnapshotPath: "snapshot" },
    input: { read: (path) => Effect.succeed(Buffer.from(files[path]!)) },
    output: {
      stdout: (text) =>
        Effect.sync(() => {
          output.push(text);
        }),
      stderr: () => Effect.void,
    },
    generate: () => {
      calls++;
      return Effect.die("Provider must not run");
    },
  });
  for (const extra of [
    ["--transport", "fixture"],
    ["--transport", "openai-responses", "--controls", "controls"],
    [
      "--transport",
      "openai-responses",
      "--credential-profile",
      "account:missing",
    ],
    ["--transport", "openai-responses", "--grammar-mode", "grammar-required"],
  ]) {
    const result = await Effect.runPromise(
      cli.run([
        "plan",
        "--prompt",
        "Write arithmetic",
        "--model",
        "gpt-6-astra",
        ...extra,
        "--json",
      ]),
    );
    assert.equal(result.exitCode, 2);
  }
  assert.equal(calls, 0);
  assert.equal(output.length, 4);
});

test("interactive fragment editing exports exact draft and never invokes provider implicitly", async () => {
  const f = fixture();
  const source = createDefaultAuthoringSnapshotV1();
  const output: string[] = [];
  const errors: string[] = [];
  const lines = [
    "replace-program",
    "(+ 4 5)",
    ".end",
    "preview",
    "undo",
    "export",
    "abort",
  ];
  let calls = 0;
  const cli = makeForemanCli({
    context: { defaultSnapshotPath: "snapshot" },
    input: {
      read: (path) =>
        Effect.succeed(
          Buffer.from(
            path === "input.pel" ? "(+ 1 2)" : JSON.stringify(source),
          ),
        ),
    },
    output: {
      stdout: (text) =>
        Effect.sync(() => {
          output.push(text);
        }),
      stderr: (text) =>
        Effect.sync(() => {
          errors.push(text);
        }),
    },
    terminal: { readLine: () => Effect.succeed(lines.shift() ?? null) },
    generate: () => {
      calls++;
      return Effect.die("Provider must not run");
    },
  });
  const result = await Effect.runPromise(
    cli.run(["plan", "input.pel", "--interactive"]),
  );
  assert.equal(result.exitCode, 0);
  assert.equal(output.join(""), "(+ 1 2)");
  assert.equal(calls, 0);
  assert.ok(errors.some((line) => line.includes('"value":9')));
});

test("human generation failures show cumulative usage and attempt diagnostics", async () => {
  const errors: string[] = [];
  const snapshot = JSON.stringify(createDefaultAuthoringSnapshotV1());
  const cli = makeForemanCli({
    context: { defaultSnapshotPath: "snapshot" },
    input: { read: () => Effect.succeed(Buffer.from(snapshot)) },
    output: {
      stdout: () => Effect.void,
      stderr: (text) =>
        Effect.sync(() => {
          errors.push(text);
        }),
    },
    generate: () =>
      Effect.fail({
        _tag: "PelGenerationFailure",
        code: "PEL_GENERATION_EXHAUSTED",
        message: "Three candidates failed",
        attemptDiagnostics: [
          { attempt: 0, diagnostics: [], sourceSample: "(" },
        ],
        cumulativeUsage: {
          inputTokens: 10,
          providerCounters: { costUnits: 3 },
        },
      }),
  });
  const result = await Effect.runPromise(
    cli.run([
      "plan",
      "--prompt",
      "Write arithmetic",
      "--model",
      "gpt-6-astra",
      "--transport",
      "openai-responses",
    ]),
  );
  assert.equal(result.exitCode, 1);
  assert.match(errors.join(""), /"inputTokens":10/);
  assert.match(errors.join(""), /"attempt":0/);
});

test("successful human generation preserves source stdout and reports all attempt usage", async () => {
  const { checkPel, planPel } = await import("@foreman/pel");
  const snapshot = createDefaultAuthoringSnapshotV1();
  const checked = checkPel({ source: Buffer.from("(+ 1 2)"), snapshot });
  assert.equal(checked.tag, "ok");
  if (checked.tag !== "ok") return;
  const out: string[] = [];
  const err: string[] = [];
  const cli = makeForemanCli({
    context: { defaultSnapshotPath: "snapshot" },
    input: {
      read: () => Effect.succeed(Buffer.from(JSON.stringify(snapshot))),
    },
    output: {
      stdout: (text) =>
        Effect.sync(() => {
          out.push(text);
        }),
      stderr: (text) =>
        Effect.sync(() => {
          err.push(text);
        }),
    },
    generate: () =>
      Effect.succeed({
        schemaVersion: 1,
        pelSource: "(+ 1 2)",
        preview: planPel(checked.checked),
        attemptCount: 2,
        providerIdentities: [],
        cumulativeUsage: {
          inputTokens: 20,
          providerCounters: { costUnits: 3 },
        },
      }),
  });
  const result = await Effect.runPromise(
    cli.run([
      "plan",
      "--prompt",
      "Write arithmetic",
      "--model",
      "gpt-6-astra",
      "--transport",
      "openai-responses",
    ]),
  );
  assert.equal(result.exitCode, 0);
  assert.equal(out.join(""), "(+ 1 2)");
  const detail = JSON.parse(err.join(""));
  assert.equal(detail.attemptCount, 2);
  assert.equal(detail.cumulativeUsage.inputTokens, 20);
  assert.deepEqual(detail.preview.finalValueSummary, {
    kind: "known",
    value: { tag: "number", value: 3 },
  });
});

test("T-M2-014 packaged authoring asset is regenerated from the sole declaration module", async () => {
  const { readFile } = await import("node:fs/promises");
  const { canonicalize } = await import("@foreman/core");
  const asset = await readFile(
    "skills/foreman/runtime/assets/pel/default-authoring-snapshot.json",
    "utf8",
  );
  assert.equal(asset, canonicalize(createDefaultAuthoringSnapshotV1()) + "\n");
});

test("T-M2-001/002 CLI JSON matrix rejects invalid inputs without an execution service", async () => {
  for (const [source, code] of [
    ["(+ 1 2)", null],
    ["(", "PEL_PARSE"],
    ["missing", "PEL_UNBOUND_SYMBOL"],
    ['(fm/task "x" :model "role:implementer")', "PEL_ARGUMENT_MODE"],
    ["'missing", null],
  ] as const) {
    const f = fixture(source);
    const result = await Effect.runPromise(
      f.cli.run(["check", "input.pel", "--json"]),
    );
    assert.equal(result.exitCode, code ? 2 : 0);
    assert.equal(f.out.length, 1);
    assert.equal(f.err.length, 0);
    const json = JSON.parse(f.out[0]!);
    if (code) {
      assert.equal(json.diagnostics[0].code, code);
      assert.equal(json.diagnostics[0].span.line, 1);
    }
  }
  for (const mode of [
    "missing-source",
    "missing-snapshot",
    "oversized-snapshot",
  ] as const) {
    const f = fixture();
    if (mode === "missing-source") delete f.files["input.pel"];
    else if (mode === "missing-snapshot") delete f.files["default.json"];
    else f.files["default.json"] = " ".repeat(16 * 1024 * 1024 + 1);
    const result = await Effect.runPromise(
      f.cli.run(["check", "input.pel", "--json"]),
    );
    assert.equal(result.exitCode, 2);
    assert.equal(f.out.length, 1);
    assert.equal(f.err.length, 0);
  }
});

test("T-M2-003/005/011 canonical effects and human/JSON diagnostics retain exact selections", async () => {
  const { readFile } = await import("node:fs/promises");
  const f = fixture(
    await readFile("examples/pel/implement-verify-review.pel", "utf8"),
  );
  const result = await Effect.runPromise(
    f.cli.run(["plan", "input.pel", "--json"]),
  );
  assert.equal(result.exitCode, 0, f.err.join(""));
  const preview = JSON.parse(f.out[0]!);
  assert.deepEqual(
    preview.effects.map((e: { registryId: string }) => e.registryId),
    ["fm/task", "fm/verify", "fm/review"],
  );
  assert.equal(preview.effects[0].model.profileId, "grok-4.6");
  assert.equal(preview.effects[0].model.transportId, "grok-acp");
  assert.equal(preview.effects[0].model.controls.effort, "high");
  assert.deepEqual(preview.effects[1].gates, ["candidate-full"]);
  assert.equal(preview.effects[2].model.profileId, "gpt-5.6-sol");
  assert.equal(preview.effects[2].model.controls.effort, "medium");
  assert.ok(
    preview.dependencies.some((d: { kind: string }) => d.kind === "order"),
  );
  for (const [source, code] of [
    ['(fm/task "x" :model "role:implementer")', "PEL_ARGUMENT_MODE"],
    ["(fm/tsk)", "PEL_UNBOUND_SYMBOL"],
    [
      '(fm/task "x" "missing-model" "artifact:approved-spec" "schema:candidate-v1")',
      "PEL_PROFILE_UNSUPPORTED",
    ],
    [
      '(fm/task "x" "role:implementer" "artifact:approved-spec" "schema:missing")',
      "PEL_SCHEMA",
    ],
  ] as const) {
    for (const json of [false, true]) {
      const fixtureCase = fixture(source);
      const result = await Effect.runPromise(
        fixtureCase.cli.run([
          "check",
          "input.pel",
          ...(json ? ["--json"] : []),
        ]),
      );
      assert.equal(result.exitCode, 2);
      if (json) {
        const value = JSON.parse(fixtureCase.out[0]!);
        assert.equal(value.diagnostics[0].code, code);
        assert.ok(value.diagnostics[0].signature);
        assert.equal(value.diagnostics[0].span.line, 1);
      } else {
        const text = fixtureCase.err.join("");
        assert.match(text, /input.pel:1:/);
        assert.ok(text.includes(code));
        assert.match(text, /\^/);
        assert.match(text, /Signature:/);
      }
    }
  }
  const unresolved = fixture('(case 1 ["is one" (fm/checkpoint "yes") #t 0])');
  await Effect.runPromise(unresolved.cli.run(["plan", "input.pel", "--json"]));
  const dynamic = JSON.parse(unresolved.out[0]!);
  assert.equal(dynamic.status, "bounded-dynamic");
  assert.equal(dynamic.finalValueSummary.kind, "unresolved");
  assert.ok(dynamic.finalValueSummary.reason);
});

test("T-M2-012 terminal transcript covers draft commands and explicit repair", async () => {
  const { parsePel } = await import("@foreman/pel");
  const source = "1 2";
  const parsed = parsePel(Buffer.from(source));
  assert.ok(parsed.ok);
  const lines = [
    "show",
    "check",
    "preview",
    "history",
    `replace-expression ${parsed.value.expressions[0]!.nodeId}`,
    "3",
    ".end",
    "undo",
    `replace-suffix ${parsed.value.expressions[1]!.nodeId}`,
    "4",
    "5",
    ".end",
    "undo",
    "replace-program",
    "9",
    ".end",
    "undo",
    "repair",
    "history",
    "export",
    "abort",
  ];
  const out: string[] = [],
    err: string[] = [];
  let calls = 0;
  let completions: readonly string[] = [];
  const snapshot = createDefaultAuthoringSnapshotV1();
  const cli = makeForemanCli({
    context: { defaultSnapshotPath: "snapshot" },
    input: {
      read: (path) =>
        Effect.succeed(
          Buffer.from(path === "input.pel" ? source : JSON.stringify(snapshot)),
        ),
    },
    output: {
      stdout: (text) =>
        Effect.sync(() => {
          out.push(text);
        }),
      stderr: (text) =>
        Effect.sync(() => {
          err.push(text);
        }),
    },
    terminal: {
      readLine: () => Effect.succeed(lines.shift() ?? null),
      setCompleter: (complete) => {
        completions = complete("fm/t");
      },
    },
    generate: () => {
      calls++;
      return Effect.fail({
        _tag: "PelGenerationFailure",
        code: "PEL_GENERATION_EXHAUSTED",
        message: "Fixture refuses repair",
        attemptDiagnostics: [],
        cumulativeUsage: { providerCounters: {} },
      });
    },
  });
  const result = await Effect.runPromise(
    cli.run([
      "plan",
      "input.pel",
      "--interactive",
      "--model",
      "gpt-6-astra",
      "--transport",
      "openai-responses",
    ]),
  );
  assert.equal(result.exitCode, 0);
  assert.equal(out.join(""), source);
  assert.equal(calls, 1);
  assert.deepEqual(completions, ["fm/task"]);
  assert.ok(
    err.some((s) =>
      s.includes("Provider use requested: gpt-6-astra/openai-responses"),
    ),
  );
  assert.ok(err.some((s) => s.includes("PEL_GENERATION_EXHAUSTED")));
});

test("T-M2-013 all four packaged examples check and plan under Node 24", async () => {
  const { spawnSync } = await import("node:child_process");
  for (const example of [
    "implement-verify-review",
    "conditional",
    "parallel-read",
    "repair",
  ])
    for (const command of ["check", "plan"]) {
      const run = spawnSync(
        process.execPath,
        [
          "skills/foreman/runtime/dist/foreman.js",
          command,
          `examples/pel/${example}.pel`,
          "--json",
        ],
        { encoding: "utf8" },
      );
      assert.equal(
        run.status,
        0,
        `${example}/${command}: ${run.stdout} ${run.stderr}`,
      );
      assert.equal(run.stderr, "");
      assert.equal(JSON.parse(run.stdout).schemaVersion, 1);
    }
  const invalid = spawnSync(
    process.execPath,
    [
      "skills/foreman/runtime/dist/foreman.js",
      "check",
      "packages/pel/test/fixtures/repair-invalid.pel",
      "--json",
    ],
    { encoding: "utf8" },
  );
  assert.equal(invalid.status, 2);
  assert.equal(
    JSON.parse(invalid.stdout).diagnostics[0].code,
    "PEL_ARGUMENT_MODE",
  );
});
