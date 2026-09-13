import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { makePelDraftSession } from "./pel-draft-session.js";

const bytes = (s: string) => new TextEncoder().encode(s);
const checker = (source: Uint8Array) => ({
  tag: "ok" as const,
  source: new TextDecoder().decode(source),
});
test("draft replacements retain exact bytes and undo without effects", async () => {
  const draft = await Effect.runPromise(
    makePelDraftSession({
      source: bytes("(+ 1 2)\n3"),
      check: checker,
      symbols: ["fm/task", "fm/review"],
    }),
  );
  const node = draft.nodes()[0]!;
  await Effect.runPromise(
    draft.replace("expression", bytes("(+ 4 5)"), node.nodeId),
  );
  assert.equal(new TextDecoder().decode(draft.source()), "(+ 4 5)\n3");
  assert.notEqual(
    draft.history()[0]!.sourceDigest,
    draft.history()[1]!.sourceDigest,
  );
  await Effect.runPromise(draft.undo());
  assert.equal(new TextDecoder().decode(draft.source()), "(+ 1 2)\n3");
  assert.deepEqual(draft.complete("fm/t"), ["fm/task"]);
});
test("draft rejects multiple expression fragments and run-bound state", async () => {
  const draft = await Effect.runPromise(
    makePelDraftSession({ source: bytes("1"), check: checker, symbols: [] }),
  );
  const failed = await Effect.runPromise(
    Effect.either(
      draft.replace("expression", bytes("2 3"), draft.nodes()[0]!.nodeId),
    ),
  );
  assert.equal(failed._tag, "Left");
  assert.equal(new TextDecoder().decode(draft.source()), "1");
  const bound = await Effect.runPromise(
    Effect.either(
      makePelDraftSession({
        source: bytes("1"),
        check: checker,
        symbols: [],
        continuation: { runId: "run" },
      }),
    ),
  );
  assert.equal(bound._tag, "Left");
  if (bound._tag === "Left")
    assert.equal(bound.left.code, "PEL_DRAFT_EXECUTED");
});
test("draft caps revisions at 100 and bytes at 16 MiB", async () => {
  const draft = await Effect.runPromise(
    makePelDraftSession({ source: bytes("0"), check: checker, symbols: [] }),
  );
  for (let i = 1; i <= 101; i++)
    await Effect.runPromise(draft.replace("program", bytes(String(i))));
  assert.equal(draft.history().length, 100);
  assert.equal(draft.history()[0]!.revision, 2);
  const large = bytes('"' + "x".repeat(900_000) + '"');
  for (let i = 0; i < 20; i++)
    await Effect.runPromise(draft.replace("program", large));
  assert.ok(
    draft.history().reduce((sum, r) => sum + r.byteLength, 0) <=
      16 * 1024 * 1024,
  );
  assert.equal(draft.source().byteLength, large.byteLength);
});

test("suffix replacement preserves UTF-8 prefix and rejects nested suffix targets", async () => {
  const draft = await Effect.runPromise(
    makePelDraftSession({
      source: bytes('"é"\n(+ 2 3)\n4'),
      check: checker,
      symbols: [],
    }),
  );
  const target = draft.nodes()[1]!;
  await Effect.runPromise(
    draft.replace("suffix", bytes("7\n8"), target.nodeId),
  );
  assert.equal(new TextDecoder().decode(draft.source()), '"é"\n7\n8');
  await Effect.runPromise(draft.undo());
  if (target.kind !== "call") assert.fail("Expected a call");
  const invalid = await Effect.runPromise(
    Effect.either(draft.replace("suffix", bytes("9"), target.items[1]!.nodeId)),
  );
  assert.equal(invalid._tag, "Left");
});
