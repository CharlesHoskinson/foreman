import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalize, sha256Hex } from "@foreman/core";
import type { PelProgram, SourceSpan } from "../src/ast.js";
import { parsePel } from "../src/parser.js";
import {
  createPelEnvironment,
  extractClosureEnvironment,
  startPel,
} from "../src/evaluator.js";
import { createHostRegistry } from "../src/host-contract.js";
import {
  decodeHostArgumentsV1,
  encodeHostArgumentsV1,
} from "../src/host-arguments.js";
import {
  normalizePelNode,
  validateRevisionPrefix,
  type RecordedRevisionCallV1,
} from "../src/revision.js";
import type {
  PelClosureValue,
  PelEnvironmentTableV1,
  PelValue,
  Result,
} from "../src/types.js";

function program(source: string): PelProgram {
  const parsed = parsePel(new TextEncoder().encode(source));
  assert.equal(parsed.ok, true);
  return parsed.value;
}

function call(
  owner: PelProgram,
  expression: number,
  boundArguments: Readonly<Record<string, PelValue>>,
  suffix = "call",
): RecordedRevisionCallV1 {
  const node = owner.expressions[expression];
  assert.ok(node);
  return {
    oldRequestId: `old-${expression}-${suffix}`,
    nodeId: node.nodeId,
    invocationPath: `root/expression/${expression}/${suffix}`,
    boundArguments,
  };
}

function codeOf(result: Result<unknown, { readonly code: string }>): string {
  assert.equal(result.ok, false);
  return result.error.code;
}

describe("validateRevisionPrefix", () => {
  it("maps an unchanged whole-form prefix across source digests", () => {
    const oldProgram = program("(test/a 1)\n(test/b :x 2)\n(+ 1 2)");
    const newProgram = program(
      "; revised whitespace\n(test/a 1)\n\n(test/b :x 2)\n(+ 8 9)",
    );
    const recordedCalls = [
      call(oldProgram, 0, { value: { tag: "number", value: 1 } }),
      call(oldProgram, 1, { x: { tag: "number", value: 2 } }),
    ];

    const result = validateRevisionPrefix(
      oldProgram,
      newProgram,
      2,
      recordedCalls,
    );
    assert.equal(result.ok, true);
    assert.equal(result.value.completedPrefixCount, 2);
    assert.equal(result.value.oldSourceDigest, oldProgram.sourceDigest);
    assert.equal(result.value.newSourceDigest, newProgram.sourceDigest);
    assert.equal(
      result.value.prefixDigest,
      sha256Hex(
        canonicalize(oldProgram.expressions.slice(0, 2).map(normalizePelNode)),
      ),
    );
    assert.deepEqual(
      result.value.nodeMappings.filter(
        (mapping) => mapping.path === "0" || mapping.path === "1",
      ),
      [
        {
          path: "0",
          oldNodeId: oldProgram.expressions[0]?.nodeId,
          newNodeId: newProgram.expressions[0]?.nodeId,
        },
        {
          path: "1",
          oldNodeId: oldProgram.expressions[1]?.nodeId,
          newNodeId: newProgram.expressions[1]?.nodeId,
        },
      ],
    );
    assert.deepEqual(
      result.value.callMappings.map(
        ({ oldRequestId, invocationPath, nodePath }) => ({
          oldRequestId,
          invocationPath,
          nodePath,
        }),
      ),
      [
        {
          oldRequestId: "old-0-call",
          invocationPath: "root/expression/0/call",
          nodePath: "0",
        },
        {
          oldRequestId: "old-1-call",
          invocationPath: "root/expression/1/call",
          nodePath: "1",
        },
      ],
    );
  });

  it("rejects any change within a completed top-level form", () => {
    const oldProgram = program("(test/a 1)\n(+ 1 2)");
    const newProgram = program("(test/a 2)\n(+ 1 2)");
    assert.equal(
      codeOf(
        validateRevisionPrefix(oldProgram, newProgram, 1, [
          call(oldProgram, 0, { value: { tag: "number", value: 1 } }),
        ]),
      ),
      "PEL_CONTINUATION_MISMATCH",
    );
  });

  it("rejects partial or out-of-range completed-prefix counts", () => {
    const oldProgram = program("(test/a)\n(test/b)");
    const newProgram = program("(test/a)\n(test/b)");
    for (const count of [-1, 1.5, 3]) {
      assert.equal(
        codeOf(validateRevisionPrefix(oldProgram, newProgram, count, [])),
        "PEL_CONTINUATION_MISMATCH",
      );
    }
  });

  it("rejects recorded calls outside the prefix or under a foreign path", () => {
    const oldProgram = program("(test/a)\n(test/b)");
    const newProgram = program("(test/a)\n(test/b)");
    assert.equal(
      codeOf(
        validateRevisionPrefix(oldProgram, newProgram, 1, [
          call(oldProgram, 1, {}),
        ]),
      ),
      "PEL_CONTINUATION_MISMATCH",
    );
    assert.equal(
      codeOf(
        validateRevisionPrefix(oldProgram, newProgram, 1, [
          {
            ...call(oldProgram, 0, {}),
            invocationPath: "root/expression/1/call",
          },
        ]),
      ),
      "PEL_CONTINUATION_MISMATCH",
    );
  });

  it("rejects duplicate call identities and non-host-safe bound arguments", () => {
    const oldProgram = program("(test/a)");
    const newProgram = program("(test/a)");
    const first = call(oldProgram, 0, { x: { tag: "number", value: 1 } });
    assert.equal(
      codeOf(
        validateRevisionPrefix(oldProgram, newProgram, 1, [
          first,
          { ...first },
        ]),
      ),
      "PEL_CONTINUATION_MISMATCH",
    );
    assert.equal(
      codeOf(
        validateRevisionPrefix(oldProgram, newProgram, 1, [
          call(oldProgram, 0, { x: { tag: "symbol", name: "unsafe" } }),
        ]),
      ),
      "PEL_CONTINUATION_MISMATCH",
    );
  });

  it("uses the changed form span for prefix mismatch diagnostics", () => {
    const oldProgram = program("1\n2");
    const newProgram = program("1\n3");
    const result = validateRevisionPrefix(oldProgram, newProgram, 2, []);
    assert.equal(result.ok, false);
    const expected: SourceSpan =
      newProgram.expressions[1]?.span ?? newProgram.expressions[0]!.span;
    assert.deepEqual(result.error.span, expected);
  });

  it("maps a completed recursive-closure call through canonical host arguments", () => {
    const prefix =
      "(def self (lambda [:n] (if (eq n 0) 42 (self (- n 1)))))\n(print self)";
    const oldProgram = program(`${prefix}\nmissing`);
    const newProgram = program(`; revised suffix\n${prefix}\n(len [])`);
    const registry = createHostRegistry();
    assert.equal(registry.ok, true);
    const suspended = startPel(
      oldProgram,
      createPelEnvironment(registry.value),
    );
    assert.equal(suspended.tag, "suspend");
    if (suspended.tag !== "suspend") return;
    const request = suspended.ready[0];
    const closure = request.boundArguments.vals as PelClosureValue;
    assert.equal(closure.tag, "closure");
    const environment = extractClosureEnvironment(
      suspended.continuation,
      closure,
    );
    assert.equal(environment.ok, true);
    if (!environment.ok) return;
    const recorded = {
      oldRequestId: request.requestId,
      nodeId: request.nodeId,
      invocationPath: request.invocationPath,
      boundArguments: request.boundArguments,
      environmentTable: environment.value,
    } as RecordedRevisionCallV1 & {
      readonly environmentTable: PelEnvironmentTableV1;
    };

    const mapping = validateRevisionPrefix(oldProgram, newProgram, 2, [
      recorded,
    ]);
    assert.equal(mapping.ok, true, JSON.stringify(mapping));
    if (!mapping.ok) return;
    const callMapping = mapping.value.callMappings[0]!;
    assert.equal(callMapping.argumentKind, "internal");
    if (callMapping.argumentKind !== "internal") return;
    assert.equal(
      callMapping.boundArgumentsDigest,
      sha256Hex(canonicalize(callMapping.argumentEncoding)),
    );
    assert.equal(
      callMapping.argumentEncoding.sourceDigest,
      oldProgram.sourceDigest,
    );
    const directEncoding = encodeHostArgumentsV1(
      request.boundArguments,
      environment.value,
    );
    assert.equal(directEncoding.ok, true, JSON.stringify(directEncoding));
    if (directEncoding.ok)
      assert.deepEqual(callMapping.argumentEncoding, directEncoding.value);
    assert.ok(
      callMapping.argumentEncoding.nodes.some(
        (node) => node.kind === "closure-ref",
      ),
    );
    const decoded = decodeHostArgumentsV1(callMapping.argumentEncoding, {
      sourceDigest: oldProgram.sourceDigest,
      registryDigest: environment.value.registryDigest,
      optionsDigest: environment.value.optionsDigest,
    });
    assert.equal(decoded.ok, true, JSON.stringify(decoded));
    assert.ok(
      mapping.value.nodeMappings.some(
        (node) =>
          node.oldNodeId === request.nodeId &&
          node.newNodeId !== request.nodeId,
      ),
    );

    const {
      environmentTable: _environmentTable,
      ...recordedWithoutEnvironment
    } = recorded;
    const withoutEnvironment = validateRevisionPrefix(
      oldProgram,
      newProgram,
      2,
      [recordedWithoutEnvironment],
    );
    assert.equal(withoutEnvironment.ok, false);
    if (!withoutEnvironment.ok)
      assert.equal(withoutEnvironment.error.code, "PEL_CONTINUATION_MISMATCH");

    const changedPrefix = program(
      `; changed closure\n${prefix.replace("42", "43")}\n(len [])`,
    );
    const changed = validateRevisionPrefix(oldProgram, changedPrefix, 2, [
      recorded,
    ]);
    assert.equal(changed.ok, false);
    if (!changed.ok)
      assert.equal(changed.error.code, "PEL_CONTINUATION_MISMATCH");
  });
});
