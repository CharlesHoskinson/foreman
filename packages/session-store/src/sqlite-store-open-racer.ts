/**
 * Child process for the concurrent SqliteSessionStore.open trial.
 *
 * DatabaseSync is synchronous, so overlapping opens must be OS processes.
 * This child waits for a start message, then opens and closes the same
 * path `times` times and reports how many threw.
 */

import { SqliteSessionStore } from "./sqlite-store.js";

const rawPath = process.argv[2];
const times = Number(process.argv[3] ?? "1");
if (rawPath === undefined || !Number.isSafeInteger(times) || times < 1) {
  process.stderr.write("usage: sqlite-store-open-racer.ts <path> <times>\n");
  process.exit(2);
}
const path: string = rawPath;

function run(): { readonly fails: number; readonly errors: readonly string[] } {
  let fails = 0;
  const errors: string[] = [];
  for (let i = 0; i < times; i++) {
    try {
      const store = SqliteSessionStore.open(path);
      store.close();
    } catch (e) {
      fails += 1;
      if (errors.length < 4) errors.push(String(e));
    }
  }
  return { fails, errors };
}

if (process.send) {
  process.once("message", (msg: unknown) => {
    if ((msg as { type?: string } | null)?.type !== "go") {
      process.send?.({ fails: 1, errors: [`unexpected start: ${JSON.stringify(msg)}`] });
      return;
    }
    process.send?.(run());
  });
} else {
  const result = run();
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(result.fails === 0 ? 0 : 1);
}
