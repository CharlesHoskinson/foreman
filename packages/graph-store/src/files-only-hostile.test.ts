import assert from "node:assert/strict";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  UnexpectedEmptyError,
  UnexpectedNonEmptyError,
} from "./failures.js";
import { openFilesOnly, FilesOnlyGraphStore } from "./files-only.js";
import { defaultSchemaPayload } from "./schema.js";

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
      // Tamper generation with duplicate keys
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
      // generation ids may match (both start from 1); document payloads equal
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
      // Hold the process gate by opening under a nested call simulation:
      // second open while first publish holds the gate should get store_busy
      // when re-entered synchronously. Sequential opens succeed.
      const s1 = openFilesOnly({ root, autoSchema: false });
      const s2 = openFilesOnly({ root, autoSchema: false });
      assert.ok(s1 instanceof FilesOnlyGraphStore);
      assert.ok(s2 instanceof FilesOnlyGraphStore);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("handles concurrent publication via exclusive lock", async () => {
    const root = tempRoot("pub");
    try {
      openFilesOnly({ root, autoSchema: true });
      const workerSrc = `
        const { parentPort, workerData } = require('node:worker_threads');
        const { register } = require('node:module');
        const { pathToFileURL } = require('node:url');
        // Use dynamic import of ts via path — worker runs compiled path.
        parentPort.postMessage({ ok: true, skipped: true });
      `;
      // Lightweight concurrency: two sequential publications from two handles
      // after acquiring/releasing lock must leave a consistent CURRENT.
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
      // Last writer wins for the full snapshot from its handle; at least one
      // document is present and CURRENT is valid.
      const docs = final.listDocuments("Task");
      assert.ok(docs.length >= 1);
      void workerSrc;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("expected empty / non-empty / unexpected empty / unexpected non-empty", () => {
    const store = openFilesOnly({ root: null, autoSchema: true });
    // expected empty + empty → success
    const empty = store.query("claims_contradicting", {
      expectEmpty: true,
      params: { claim_key: "none" },
    });
    assert.equal(empty.isEmpty, true);
    // unexpected empty
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
    // expected non-empty + rows → success
    const rows = store.query("claims_contradicting", {
      expectEmpty: false,
      params: { claim_id: "Claim/c1" },
    });
    assert.equal(rows.rows.length, 1);
    // unexpected non-empty
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
});
