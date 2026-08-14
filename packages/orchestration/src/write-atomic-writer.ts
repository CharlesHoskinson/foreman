/**
 * Child process for the writeAtomic four-writer trial.
 *
 * node:fs writes are synchronous in one process, so four overlapping writers
 * must be four OS processes. This child waits for an IPC message, writes once,
 * and replies. The parent keeps the process alive across trials so tsx startup
 * is not part of the collision window.
 */

import { writeAtomic } from "./fm-session-main.js";

process.on("message", (msg: unknown) => {
  const body = msg as { readonly path?: unknown; readonly text?: unknown };
  if (typeof body.path !== "string" || typeof body.text !== "string") {
    process.send?.({ ok: false, error: `bad message: ${JSON.stringify(msg)}` });
    return;
  }
  try {
    writeAtomic(body.path, body.text);
    process.send?.({ ok: true });
  } catch (e) {
    process.send?.({ ok: false, error: String(e) });
  }
});
