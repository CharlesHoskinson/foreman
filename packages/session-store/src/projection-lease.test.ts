import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { SqliteProjectionLeasePort } from "./index.js";

const PROJECT = "123e4567-e89b-42d3-a456-426614174000";

describe("SqliteProjectionLeasePort", () => {
  it("retains monotonic fencing tokens across release and reopen", async () => {
    const root = mkdtempSync(join(tmpdir(), "foreman-lease-"));
    const databasePath = join(root, "projection-leases.sqlite");
    let now = 1_000;
    try {
      const firstPort = new SqliteProjectionLeasePort({
        databasePath,
        ownerId: "worker-one",
        ttlMs: 100,
        now: () => now,
      });
      const first = await firstPort.acquire(PROJECT);
      assert.equal(first.fencingToken, 1);
      assert.equal(await first.isCurrent(), true);
      await first.release();
      assert.equal(await first.isCurrent(), false);
      firstPort.close();

      const reopened = new SqliteProjectionLeasePort({
        databasePath,
        ownerId: "worker-two",
        ttlMs: 100,
        now: () => now,
      });
      const second = await reopened.acquire(PROJECT);
      assert.equal(second.fencingToken, 2);
      await second.release();
      reopened.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a live holder and fences it after expiry takeover", async () => {
    const root = mkdtempSync(join(tmpdir(), "foreman-lease-"));
    const databasePath = join(root, "projection-leases.sqlite");
    let now = 5_000;
    const firstPort = new SqliteProjectionLeasePort({
      databasePath,
      ownerId: "worker-one",
      ttlMs: 100,
      now: () => now,
    });
    const secondPort = new SqliteProjectionLeasePort({
      databasePath,
      ownerId: "worker-two",
      ttlMs: 100,
      now: () => now,
    });
    try {
      const first = await firstPort.acquire(PROJECT);
      await assert.rejects(secondPort.acquire(PROJECT), /already held/);
      now = 5_101;
      const second = await secondPort.acquire(PROJECT);
      assert.equal(second.fencingToken, first.fencingToken + 1);
      assert.equal(await first.isCurrent(), false);
      assert.equal(await second.isCurrent(), true);
      await first.release();
      assert.equal(await second.isCurrent(), true);
    } finally {
      firstPort.close();
      secondPort.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("renews only the current exact owner and token", async () => {
    const root = mkdtempSync(join(tmpdir(), "foreman-lease-"));
    let now = 8_000;
    const port = new SqliteProjectionLeasePort({
      databasePath: join(root, "projection-leases.sqlite"),
      ownerId: "worker-one",
      ttlMs: 100,
      now: () => now,
    });
    try {
      const lease = await port.acquire(PROJECT);
      now = 8_050;
      assert.equal(await lease.isCurrent(), true);
      now = 8_149;
      assert.equal(await lease.isCurrent(), true);
      now = 8_250;
      assert.equal(await lease.isCurrent(), false);
    } finally {
      port.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses invalid project, owner, TTL, and database path inputs", () => {
    assert.throws(
      () =>
        new SqliteProjectionLeasePort({
          databasePath: "relative.sqlite",
          ownerId: "worker",
        }),
      /database path/,
    );
    assert.throws(
      () =>
        new SqliteProjectionLeasePort({
          databasePath: join(tmpdir(), "projection-leases.sqlite"),
          ownerId: "bad\nowner",
        }),
      /owner/,
    );
  });
});
