import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const writerPath = join(here, "write-atomic-writer.ts");

const TRIALS = 100;
const WRITERS = 4;

function waitForReply(
  child: ChildProcess,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("writer did not reply within 10s")),
      10_000,
    );
    const onMessage = (msg: unknown) => {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
      resolve(msg as { ok: boolean; error?: string });
    };
    const onError = (err: Error) => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
      reject(err);
    };
    const onExit = (code: number | null) => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("error", onError);
      reject(new Error(`writer exited early with code ${code}`));
    };
    child.once("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

test(
  "W2.1: 100 four-writer trials leave a complete sidecar and zero write failures",
  { timeout: 120_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "write-atomic-"));
    const dest = join(dir, "session.ndjson");
    const children: ChildProcess[] = [];
    try {
      for (let i = 0; i < WRITERS; i++) {
        children.push(
          fork(writerPath, [], {
            execArgv: ["--import", "tsx"],
            stdio: ["ignore", "inherit", "inherit", "ipc"],
          }),
        );
      }

      let writeFailures = 0;
      let staleSidecars = 0;
      const failureSamples: string[] = [];

      for (let trial = 0; trial < TRIALS; trial++) {
        const texts = Array.from(
          { length: WRITERS },
          (_, w) => `trial=${trial} writer=${w} ${"x".repeat(256)}\n`,
        );
        const replies = await Promise.all(
          children.map((child, w) => {
            const text = texts[w];
            if (text === undefined) throw new Error("writer text missing");
            const reply = waitForReply(child);
            child.send({ path: dest, text });
            return reply;
          }),
        );

        for (const reply of replies) {
          if (!reply.ok) {
            writeFailures += 1;
            if (failureSamples.length < 5) {
              failureSamples.push(reply.error ?? "unknown");
            }
          }
        }

        let body = "";
        try {
          body = readFileSync(dest, "utf8");
        } catch (e) {
          staleSidecars += 1;
          if (failureSamples.length < 5) {
            failureSamples.push(`missing dest: ${String(e)}`);
          }
          continue;
        }
        if (!texts.includes(body)) {
          staleSidecars += 1;
          if (failureSamples.length < 5) {
            failureSamples.push(`torn dest ${JSON.stringify(body.slice(0, 80))}`);
          }
        }
      }

      const leftovers = readdirSync(dir).filter((name) => name.includes(".tmp"));
      assert.deepEqual(
        leftovers,
        [],
        `temp files left behind: ${leftovers.join(",")}`,
      );
      assert.equal(
        writeFailures,
        0,
        `${writeFailures} write failures in ${TRIALS} four-writer trials` +
          (failureSamples.length > 0 ? `: ${failureSamples.join(" | ")}` : ""),
      );
      assert.equal(
        staleSidecars,
        0,
        `${staleSidecars} stale or torn sidecars in ${TRIALS} four-writer trials` +
          (failureSamples.length > 0 ? `: ${failureSamples.join(" | ")}` : ""),
      );
    } finally {
      for (const child of children) {
        child.kill();
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
