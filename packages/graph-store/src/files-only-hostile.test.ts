import assert from "node:assert/strict";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  GraphStoreError,
  LimitExceededError,
  PublishConflictError,
  UnexpectedEmptyError,
  UnexpectedNonEmptyError,
} from "./failures.js";
import { openFilesOnly, FilesOnlyGraphStore } from "./files-only.js";
import { MAX_QUERY_RESULTS } from "./bounds.js";
import { defaultSchemaPayload } from "./schema.js";
import * as queries from "./queries.js";

function tempRoot(label: string): string {
  return mkdtempSync(join(tmpdir(), `gs-${label}-`));
}

describe("files-only hostile inputs", () => {
  it("rejects duplicate JSON keys in generation file", () => {
    const root = tempRoot("dup");
    try {
      const store = openFilesOnly({ root, autoSchema: true });
      store.upsertDocument({
        "@type": "Task",
        task_key: "t",
        title: "ok",
      });
      const genId = store.currentGenerationId();
      const genPath = join(root, "generations", genId, "generation.json");
      writeFileSync(
        genPath,
        '{"schemaVersion":1,"generationId":"' +
          genId +
          '","schemaRegistered":true,"schema":null,"schemaAuthor":"x","schemaMessage":"y","documents":{},"documents":{}}\n',
      );
      assert.throws(() => openFilesOnly({ root, autoSchema: false }), Error);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid UTF-8 in CURRENT", () => {
    const root = tempRoot("utf8");
    try {
      openFilesOnly({ root, autoSchema: true });
      writeFileSync(join(root, "CURRENT"), Buffer.from([0xff, 0xfe, 0xfd]));
      assert.throws(() => openFilesOnly({ root, autoSchema: false }), Error);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects symlink store root", () => {
    const base = tempRoot("symroot");
    const real = join(base, "real");
    const link = join(base, "link");
    try {
      mkdirSync(real);
      symlinkSync(real, link);
      assert.throws(
        () => openFilesOnly({ root: link, autoSchema: true }),
        Error,
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("rejects symlink CURRENT", () => {
    const root = tempRoot("symcur");
    try {
      const store = openFilesOnly({ root, autoSchema: true });
      store.upsertDocument({
        "@type": "Task",
        task_key: "t",
        title: "x",
      });
      const genId = store.currentGenerationId();
      const target = join(root, "generations", genId, "generation.json");
      rmSync(join(root, "CURRENT"), { force: true });
      symlinkSync(target, join(root, "CURRENT"));
      assert.throws(() => openFilesOnly({ root, autoSchema: false }), Error);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects hard-linked CURRENT", () => {
    const root = tempRoot("hard");
    try {
      const store = openFilesOnly({ root, autoSchema: true });
      store.upsertDocument({
        "@type": "Task",
        task_key: "t",
        title: "x",
      });
      const cur = join(root, "CURRENT");
      const extra = join(root, "CURRENT.hard");
      linkSync(cur, extra);
      assert.throws(() => openFilesOnly({ root, autoSchema: false }), Error);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects path traversal attempts in generation id via CURRENT", () => {
    const root = tempRoot("trav");
    try {
      openFilesOnly({ root, autoSchema: true });
      writeFileSync(join(root, "CURRENT"), "../escape\n");
      assert.throws(() => openFilesOnly({ root, autoSchema: false }), Error);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts path-with-spaces roots", () => {
    const base = tempRoot("spaces");
    const root = join(base, "my store root");
    try {
      mkdirSync(root);
      const store = openFilesOnly({ root, autoSchema: true });
      const id = store.upsertDocument({
        "@type": "Task",
        task_key: "space",
        title: "ok",
      });
      assert.equal(id, "Task/space");
      const reopened = openFilesOnly({ root, autoSchema: false });
      assert.equal(reopened.getDocumentById("Task/space")?.["title"], "ok");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("rejects missing generation pointed by CURRENT", () => {
    const root = tempRoot("miss");
    try {
      openFilesOnly({ root, autoSchema: true });
      writeFileSync(join(root, "CURRENT"), "0000000000000099\n");
      assert.throws(() => openFilesOnly({ root, autoSchema: false }), Error);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects torn CURRENT content", () => {
    const root = tempRoot("torn");
    try {
      openFilesOnly({ root, autoSchema: true });
      writeFileSync(join(root, "CURRENT"), "not-a-generation\n");
      assert.throws(() => openFilesOnly({ root, autoSchema: false }), Error);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("produces deterministic generation output", () => {
    const rootA = tempRoot("det-a");
    const rootB = tempRoot("det-b");
    try {
      const a = openFilesOnly({ root: rootA, autoSchema: false });
      const b = openFilesOnly({ root: rootB, autoSchema: false });
      a.registerSchema(defaultSchemaPayload(), {
        author: "t",
        message: "m",
      });
      b.registerSchema(defaultSchemaPayload(), {
        author: "t",
        message: "m",
      });
      a.upsertDocument({
        "@type": "Task",
        task_key: "d",
        title: "same",
      });
      b.upsertDocument({
        "@type": "Task",
        task_key: "d",
        title: "same",
      });
      const genA = a.currentGenerationId();
      const genB = b.currentGenerationId();
      const bytesA = readFileSync(
        join(rootA, "generations", genA, "generation.json"),
      );
      const bytesB = readFileSync(
        join(rootB, "generations", genB, "generation.json"),
      );
      assert.equal(bytesA.toString("utf8"), bytesB.toString("utf8"));
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  it("serializes concurrent in-process open attempts on one root", () => {
    const root = tempRoot("conc");
    try {
      openFilesOnly({ root, autoSchema: true });
      const s1 = openFilesOnly({ root, autoSchema: false });
      const s2 = openFilesOnly({ root, autoSchema: false });
      assert.ok(s1 instanceof FilesOnlyGraphStore);
      assert.ok(s2 instanceof FilesOnlyGraphStore);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves distinct concurrent publications and rejects last-writer-wins", () => {
    const root = tempRoot("pub");
    try {
      openFilesOnly({ root, autoSchema: true });
      const a = openFilesOnly({ root, autoSchema: false });
      const b = openFilesOnly({ root, autoSchema: false });
      a.upsertDocument({
        "@type": "Task",
        task_key: "p1",
        title: "a",
      });
      b.upsertDocument({
        "@type": "Task",
        task_key: "p2",
        title: "b",
      });
      const final = openFilesOnly({ root, autoSchema: false });
      const docs = final.listDocuments("Task");
      const keys = new Set(docs.map((d) => String(d["task_key"])));
      assert.deepEqual([...keys].sort(), ["p1", "p2"]);
      assert.equal(final.getDocumentById("Task/p1")?.["title"], "a");
      assert.equal(final.getDocumentById("Task/p2")?.["title"], "b");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails with typed conflict on concurrent stale shared-document change", () => {
    const root = tempRoot("conflict");
    try {
      openFilesOnly({ root, autoSchema: true });
      const a = openFilesOnly({ root, autoSchema: false });
      const b = openFilesOnly({ root, autoSchema: false });
      a.upsertDocument({
        "@type": "Task",
        task_key: "shared",
        title: "from-a",
      });
      assert.throws(
        () =>
          b.upsertDocument({
            "@type": "Task",
            task_key: "shared",
            title: "from-b",
          }),
        (e: unknown) =>
          e instanceof PublishConflictError ||
          (e instanceof GraphStoreError &&
            e.failure.reason === "publish_conflict"),
      );
      const final = openFilesOnly({ root, autoSchema: false });
      assert.equal(final.getDocumentById("Task/shared")?.["title"], "from-a");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("isolates nested JSON: caller mutation does not poison store state", () => {
    const store = openFilesOnly({ root: null, autoSchema: true });
    const input: {
      "@type": string;
      task_key: string;
      depends_on: string[];
      title: string;
    } = {
      "@type": "Task",
      task_key: "iso",
      title: "t",
      depends_on: ["Task/other"],
    };
    store.upsertDocument({
      "@type": "Task",
      task_key: "other",
      title: "o",
    });
    store.upsertDocument(input);
    input.depends_on.push("Task/iso");
    input.title = "mutated";
    const got = store.getDocumentById("Task/iso");
    assert.ok(got);
    assert.equal(got["title"], "t");
    assert.deepEqual(got["depends_on"], ["Task/other"]);
    // Returned values are isolated (deep-frozen clone): mutation fails closed
    // and must not affect internal memory either way.
    assert.throws(() => {
      (got["depends_on"] as string[]).push("Task/poison");
    }, TypeError);
    const again = store.getDocumentById("Task/iso");
    assert.deepEqual(again!["depends_on"], ["Task/other"]);
    assert.equal(again!["title"], "t");
  });

  it("rejects contract-invalid persisted generation on open", () => {
    const root = tempRoot("badgen");
    try {
      const store = openFilesOnly({ root, autoSchema: true });
      store.upsertDocument({
        "@type": "Task",
        task_key: "t",
        title: "ok",
      });
      const genId = store.currentGenerationId();
      const genPath = join(root, "generations", genId, "generation.json");
      // Unknown snapshot key + invalid document + map key != @id
      writeFileSync(
        genPath,
        JSON.stringify({
          schemaVersion: 1,
          generationId: genId,
          schemaRegistered: true,
          schema: null,
          schemaAuthor: "x",
          schemaMessage: "y",
          documents: {
            "Task/wrong": {
              "@type": "Task",
              task_key: "t",
              "@id": "Task/t",
              freeform: true,
            },
          },
          extraKey: true,
        }) + "\n",
      );
      assert.throws(() => openFilesOnly({ root, autoSchema: false }), Error);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rolls back memory when publication fails", () => {
    const root = tempRoot("rollback");
    try {
      openFilesOnly({ root, autoSchema: true });
      const store = openFilesOnly({
        root,
        autoSchema: false,
        inject: { failDuringPublish: true },
      });
      assert.throws(
        () =>
          store.upsertDocument({
            "@type": "Task",
            task_key: "should-not-stick",
            title: "x",
          }),
        Error,
      );
      assert.equal(store.getDocumentById("Task/should-not-stick"), null);
      const reopened = openFilesOnly({ root, autoSchema: false });
      assert.equal(reopened.getDocumentById("Task/should-not-stick"), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("injected failure before CURRENT leaves generation unpublished as current", () => {
    const root = tempRoot("inj-cur");
    try {
      openFilesOnly({ root, autoSchema: true });
      const before = openFilesOnly({ root, autoSchema: false });
      const beforeGen = before.currentGenerationId();
      const store = openFilesOnly({
        root,
        autoSchema: false,
        inject: { failBeforeCurrent: true },
      });
      assert.throws(
        () =>
          store.upsertDocument({
            "@type": "Task",
            task_key: "half",
            title: "x",
          }),
        Error,
      );
      // Handle rolled back
      assert.equal(store.getDocumentById("Task/half"), null);
      // CURRENT still points at prior generation
      const cur = readFileSync(join(root, "CURRENT"), "utf8").trim();
      assert.equal(cur.padStart(16, "0"), beforeGen);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("handles short writes during durable publish", () => {
    const root = tempRoot("short");
    try {
      const store = openFilesOnly({
        root,
        autoSchema: true,
        inject: { shortWriteOnce: true },
      });
      store.upsertDocument({
        "@type": "Task",
        task_key: "sw",
        title: "ok",
      });
      const reopened = openFilesOnly({ root, autoSchema: false });
      assert.equal(reopened.getDocumentById("Task/sw")?.["title"], "ok");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses overwrite of existing immutable generation file", () => {
    const root = tempRoot("excl");
    try {
      const store = openFilesOnly({ root, autoSchema: true });
      store.upsertDocument({
        "@type": "Task",
        task_key: "e",
        title: "v1",
      });
      // Plant a pre-existing file for the next generation id
      const next = String(Number(store.currentGenerationId()) + 1).padStart(
        16,
        "0",
      );
      const genDir = join(root, "generations", next);
      mkdirSync(genDir, { recursive: true });
      writeFileSync(join(genDir, "generation.json"), "{}\n");
      assert.throws(
        () =>
          store.upsertDocument({
            "@type": "Task",
            task_key: "e2",
            title: "v2",
          }),
        Error,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("expected empty / non-empty / unexpected empty / unexpected non-empty", () => {
    const store = openFilesOnly({ root: null, autoSchema: true });
    const empty = store.query("claims_contradicting", {
      expectEmpty: true,
      params: { claim_key: "none" },
    });
    assert.equal(empty.isEmpty, true);
    assert.throws(
      () => store.query("unevaluated_leaves", { expectEmpty: false }),
      UnexpectedEmptyError,
    );
    store.upsertDocument({
      "@type": "Claim",
      claim_key: "c1",
      text: "t",
      status: "live",
      confidence: "low",
    });
    store.upsertDocument({
      "@type": "Claim",
      claim_key: "c2",
      text: "t2",
      status: "live",
      confidence: "low",
      contradicts: ["Claim/c1"],
    });
    const rows = store.query("claims_contradicting", {
      expectEmpty: false,
      params: { claim_id: "Claim/c1" },
    });
    assert.equal(rows.rows.length, 1);
    assert.throws(
      () =>
        store.query("claims_contradicting", {
          expectEmpty: true,
          params: { claim_id: "Claim/c1" },
        }),
      UnexpectedNonEmptyError,
    );
  });

  it("bounds cycle traversal", () => {
    const store = openFilesOnly({ root: null, autoSchema: true });
    store.upsertDocument({
      "@type": "Task",
      task_key: "a",
      title: "a",
    });
    store.upsertDocument({
      "@type": "Task",
      task_key: "b",
      title: "b",
      depends_on: ["Task/a"],
    });
    assert.throws(
      () =>
        store.upsertDocument({
          "@type": "Task",
          task_key: "a",
          title: "a2",
          depends_on: ["Task/b"],
        }),
      (e: unknown) =>
        e instanceof Error && e.message.toLowerCase().includes("cycle"),
    );
  });

  it("throws LimitExceededError instead of silently truncating query results", () => {
    // Build an index larger than MAX_QUERY_RESULTS for claims_contradicting
    const index = new Map<string, Record<string, unknown>>();
    index.set("Claim/root", {
      "@type": "Claim",
      "@id": "Claim/root",
      claim_key: "root",
      text: "r",
      status: "live",
      confidence: "low",
    });
    const n = MAX_QUERY_RESULTS + 5;
    for (let i = 0; i < n; i++) {
      const id = `Claim/c${i}`;
      index.set(id, {
        "@type": "Claim",
        "@id": id,
        claim_key: `c${i}`,
        text: "t",
        status: "live",
        confidence: "low",
        contradicts: ["Claim/root"],
      });
    }
    assert.throws(
      () =>
        queries.queryClaimsContradicting(index, { claim_id: "Claim/root" }),
      LimitExceededError,
    );
  });
});
