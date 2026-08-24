import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  SessionStoreError,
  SqliteSessionStore,
  openFilesOnlyStore,
  projectionKey,
  upsertRecord,
  type SessionStore,
  type EntityRef,
} from "./index.js";

const PROJECT_ID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_PROJECT_ID = "123e4567-e89b-42d3-a456-426614174001";

type Harness = {
  readonly name: string;
  readonly open: (
    root: string,
    options?: { readonly readOnly?: boolean },
  ) => SessionStore;
};

const HARNESSES: readonly Harness[] = [
  {
    name: "sqlite",
    open: (root, options) =>
      SqliteSessionStore.open(join(root, "session.db"), options),
  },
  {
    name: "files-only",
    open: (root, options) =>
      openFilesOnlyStore({ dir: join(root, "session"), ...options }),
  },
];

describe("project-bound SessionStore metadata", () => {
  for (const harness of HARNESSES) {
    it(`${harness.name} binds once without changing entity rows or counters`, () => {
      const root = mkdtempSync(join(tmpdir(), `fm-project-bind-${harness.name}-`));
      try {
        let store = harness.open(root);
        const fact = store.addFact({
          statement: "existing fact",
          evidence: null,
          established_ts: "2026-08-24T00:00:00Z",
          session_id: null,
        });
        const beforeSnapshot = store.snapshot();
        const beforeNext = store.peekNextId("fact");
        assert.equal(store.projectId(), null);

        store.bindProject(PROJECT_ID);
        assert.equal(store.projectId(), PROJECT_ID);
        assert.deepEqual(store.snapshot(), beforeSnapshot);
        assert.equal(store.peekNextId("fact"), beforeNext);
        const projected = store.listOutbox(100).find(
          (entry) => entry.record.kind === "fact" && entry.record.id === fact.id,
        );
        assert.ok(projected);
        assert.equal(projected.record.project_id, PROJECT_ID);
        assert.equal(
          projected.record.key,
          `${PROJECT_ID}:fact:${fact.id}`,
        );

        store.bindProject(PROJECT_ID);
        assert.throws(
          () => store.bindProject(OTHER_PROJECT_ID),
          (error: unknown) =>
            error instanceof SessionStoreError &&
            error.failure.reason === "identity_conflict",
        );
        store.close();

        store = harness.open(root);
        assert.equal(store.projectId(), PROJECT_ID);
        store.close();

        const readOnly = harness.open(root, { readOnly: true });
        try {
          assert.equal(readOnly.projectId(), PROJECT_ID);
          assert.throws(
            () => readOnly.bindProject(PROJECT_ID),
            (error: unknown) =>
              error instanceof SessionStoreError &&
              error.failure.reason === "invalid_argument",
          );
        } finally {
          readOnly.close();
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

it("projection identities include project_id while legacy keys stay stable", () => {
  const ref: EntityRef = {
    project_id: PROJECT_ID,
    kind: "fact",
    id: 7,
    score: 1,
  };
  assert.equal(ref.project_id, PROJECT_ID);
  assert.equal(projectionKey("fact", 7), "fact:7");
  assert.equal(
    projectionKey("fact", 7, PROJECT_ID),
    `${PROJECT_ID}:fact:7`,
  );
  assert.deepEqual(
    upsertRecord("fact", 7, { statement: "bounded" }, PROJECT_ID),
    {
      project_id: PROJECT_ID,
      key: `${PROJECT_ID}:fact:7`,
      kind: "fact",
      id: 7,
      mutation: "upsert",
      text: "bounded",
    },
  );
});
