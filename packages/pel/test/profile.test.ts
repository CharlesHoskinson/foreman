import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalize, sha256Hex } from "@foreman/core";
import { parsePel } from "../src/parser.js";
import { PEL_PROFILE, DEFAULT_LIMITS } from "../src/profile.js";
import { createHostRegistry } from "../src/host-contract.js";
import { canonicalPelData, decodePelData } from "../src/values.js";
import type { PelDataValue, PelRunOptionsV1 } from "../src/types.js";
import type { PelNode } from "../src/ast.js";
import * as evaluator from "../src/evaluator.js";
interface Fixture {
  id: string;
  decision: string;
  class: string;
  paperSection: string;
  paperPage: string;
  paperLocator: string;
  sourceDigest: string;
  input: string;
  ast: unknown;
  effects: string[];
  resultOrError: {
    phase: "parse" | "evaluate";
    accepted?: boolean;
    value?: PelDataValue;
    code?: string;
  };
  dependencyMode?: "ordered" | "automatic";
  nlSelection?: boolean;
  receiptOrder?: "reverse";
  roundTrip?: boolean;
  resumeMismatch?: boolean;
  canonicalRoundTrip?: boolean;
  invalidHostResult?: boolean;
  assertPrintDefaults?: boolean;
  forbiddenValue?: PelDataValue;
  hostFailure?: { code: string; message: string };
}
let packageRoot = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(packageRoot, "test/fixtures/paper-v2.json"))) {
  const parent = dirname(packageRoot);
  if (parent === packageRoot)
    throw new Error("Pel fixture package root was not found");
  packageRoot = parent;
}
const repositoryRoot = resolve(packageRoot, "../..");
const corpus = JSON.parse(
  readFileSync(join(packageRoot, "test/fixtures/paper-v2.json"), "utf8"),
) as { profileId: string; fixtures: Fixture[] };
const design = readFileSync(
  join(repositoryRoot, "openspec/changes/foredi-01-pel-language/design.md"),
  "utf8",
);
const manifest = JSON.parse(
  readFileSync(
    join(repositoryRoot, "docs/research/pel-release/sources/pel/manifest.json"),
    "utf8",
  ),
) as { file: string; sha256: string }[];
const pdfDigest = manifest.find(
  (entry) => entry.file === "arxiv-2505.13453v2.pdf",
)!.sha256;
const matrix = design
  .split("\n")
  .filter((line) => /^\|.*PV2-\d{3}-P/u.test(line))
  .map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );
function validateMetadata(fixtures: readonly Fixture[]): void {
  assert.equal(matrix.length, 56);
  assert.equal(fixtures.length, 112);
  assert.equal(new Set(fixtures.map((f) => f.id)).size, 112);
  for (const row of matrix)
    for (const id of [row[3], row[4]]) {
      const fixture = fixtures.find((f) => f.id === id);
      assert.ok(fixture, `Missing ${id}`);
      assert.equal(fixture.decision, row[0]);
      assert.equal(fixture.class, row[1]);
      assert.equal(fixture.paperLocator, row[2]);
      assert.equal(
        fixture.paperSection,
        row[2]!.match(/§[0-9.]+/gu)?.join(" and ") ?? "",
      );
      assert.equal(
        fixture.paperPage,
        row[2]!.match(/pp?[0-9]+(?:–[0-9]+)?/gu)?.join(" and ") ?? "",
      );
      assert.equal(fixture.sourceDigest, pdfDigest);
      assert.ok(["paper", "erratum", "extension"].includes(fixture.class));
      assert.ok(Object.hasOwn(fixture, "ast"));
      assert.ok(fixture.resultOrError);
      assert.ok(Array.isArray(fixture.effects));
    }
}
function astShape(node: PelNode): unknown {
  const { nodeId: _, span: __, ...fields } = node;
  switch (node.kind) {
    case "call":
    case "list":
      return { ...fields, items: node.items.map(astShape) };
    case "pair":
      return { ...fields, value: astShape(node.value) };
    case "quote":
      return { ...fields, expression: astShape(node.expression) };
    case "pipe":
      return {
        ...fields,
        left: astShape(node.left),
        right: astShape(node.right),
      };
    default:
      return fields;
  }
}
test("T-M1-019 exact profile classifications and PDF attribution", () => {
  assert.equal(corpus.profileId, PEL_PROFILE.id);
  validateMetadata(corpus.fixtures);
  const compatibility = readFileSync(
    join(repositoryRoot, "docs/reference/pel/compatibility.md"),
    "utf8",
  );
  for (const row of matrix)
    assert.ok(compatibility.includes("| " + row.join(" | ") + " |"), row[3]!);
});
test("T-M1-019 missing fixtures and altered metadata fail validation", () => {
  assert.throws(() => validateMetadata(corpus.fixtures.slice(1)));
  for (const change of [
    { class: "paper" },
    { paperLocator: "§4.1, p99" },
    { paperPage: "p99" },
    { sourceDigest: "0".repeat(64) },
    { decision: "invented" },
  ]) {
    const changed = structuredClone(corpus.fixtures);
    Object.assign(changed[0]!, change);
    assert.throws(() => validateMetadata(changed));
  }
});
const registryResult = createHostRegistry([
  {
    id: "test/echo",
    name: "test/echo",
    argSpec: {
      kind: "fixed",
      parameters: [{ name: "input", required: true, evaluation: "strict" }],
    },
    resultSchemaId: "schema:pel-data-v1",
    failureSchemaId: "schema:pel-host-failure-v1",
    effectKind: "read",
    capabilities: [],
    resources: { reads: [], writes: [], unknown: false },
    resourceResolverId: "static",
    resourceEnvelope: {},
  },
]);
assert.ok(registryResult.ok, JSON.stringify(registryResult));
const registry = registryResult.value;
for (const fixture of corpus.fixtures)
  test(`T-M1-019 ${fixture.id} ${fixture.decision}`, () => {
    const parsed = parsePel(new TextEncoder().encode(fixture.input));
    if (!parsed.ok) {
      assert.equal(fixture.ast, null);
      assert.equal(fixture.resultOrError.phase, "parse");
      assert.equal(parsed.error[0]?.code, fixture.resultOrError.code);
      assert.deepEqual(fixture.effects, []);
      return;
    }
    assert.deepEqual(parsed.value.expressions.map(astShape), fixture.ast);
    if (fixture.resultOrError.phase === "parse") {
      assert.equal(fixture.resultOrError.accepted, true);
      assert.deepEqual(fixture.effects, []);
      return;
    }
    assert.equal(
      typeof evaluator.startPel,
      "function",
      "The evaluator is required for semantic conformance",
    );
    const selection = fixture.nlSelection
      ? {
          profileId: "fixture",
          transportId: "fixture",
          controls: {},
          credentialProfileRef: "account:fixture",
          outputSchemaId: "schema:pel-boolean-v1",
        }
      : null;
    const options: PelRunOptionsV1 = {
      dependencyMode: fixture.dependencyMode ?? "ordered",
      nlConditionProfile: selection,
      nlConditionProfileDigest: selection
        ? sha256Hex(canonicalize(selection))
        : null,
      replay: { mode: "none" },
    };
    let step = evaluator.startPel(
      parsed.value,
      evaluator.createPelEnvironment(registry),
      DEFAULT_LIMITS,
      options,
    );
    const effects: string[] = [];
    const seen = new Set<string>();
    let resumes = 0;
    while (step.tag === "suspend") {
      assert.ok(step.ready.length > 0);
      assert.ok(++resumes <= 100, "Unbounded fixture suspension");
      for (const request of step.ready) {
        if (seen.has(request.requestId))
          assert.equal(request.alreadyEmitted, true);
        else {
          assert.equal(request.alreadyEmitted, false);
          seen.add(request.requestId);
          effects.push(request.registryId);
        }
      }
      const request =
        fixture.receiptOrder === "reverse"
          ? step.ready.at(-1)!
          : step.ready[0]!;
      if (fixture.assertPrintDefaults) {
        assert.deepEqual(request.boundArguments.sep, {
          tag: "string",
          value: "",
        });
        assert.deepEqual(request.boundArguments.nl, {
          tag: "boolean",
          value: false,
        });
      }
      if (request.registryId === "pel/nl-condition") {
        assert.deepEqual(request.selection, selection);
        assert.equal(request.selectionDigest, options.nlConditionProfileDigest);
      }
      let value: unknown =
        request.registryId === "print"
          ? request.boundArguments.vals
          : request.registryId === "pel/nl-condition"
            ? { tag: "boolean", value: true }
            : request.boundArguments.input;
      if (fixture.invalidHostResult)
        value = { tag: "symbol", name: "injected" };
      const outcome = fixture.hostFailure
        ? { tag: "failure" as const, failure: fixture.hostFailure }
        : { tag: "success" as const, value: value as PelDataValue };
      const continuation = fixture.roundTrip
        ? JSON.parse(JSON.stringify(step.continuation))
        : step.continuation;
      const revised: ReturnType<typeof parsePel> = fixture.resumeMismatch
        ? parsePel(new TextEncoder().encode(fixture.input + "\n"))
        : parsed;
      assert.ok(revised.ok);
      step = evaluator.resumePel(
        revised.value,
        registry,
        continuation,
        [{ requestId: request.requestId, outcome }],
        options,
      );
    }
    assert.deepEqual(effects, fixture.effects);
    if (fixture.resultOrError.code) {
      assert.equal(step.tag, "failed");
      if (step.tag === "failed") {
        assert.equal(step.diagnostic.code, fixture.resultOrError.code);
        if (fixture.hostFailure)
          assert.deepEqual(step.diagnostic.hostFailure, fixture.hostFailure);
      }
      return;
    }
    assert.equal(step.tag, "done", JSON.stringify(step));
    if (step.tag !== "done") return;
    assert.deepEqual(step.value, fixture.resultOrError.value);
    if (fixture.forbiddenValue)
      assert.notDeepEqual(step.value, fixture.forbiddenValue);
    if (fixture.canonicalRoundTrip) {
      const encoded = canonicalPelData(step.value);
      assert.ok(encoded.ok);
      const decoded = decodePelData(JSON.parse(encoded.value));
      assert.ok(decoded.ok);
      assert.deepEqual(decoded.value, step.value);
    }
  });
