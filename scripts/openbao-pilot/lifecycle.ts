import type { ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { request as httpRequest, type ClientRequest } from "node:http";
import { Effect } from "effect";

export const cleanFailure = (code: string) => ({ _tag: "PilotRunFailure" as const, code });
export interface ChildExit { readonly code: number | null; readonly signal: NodeJS.Signals | null; readonly spawnFailed: boolean }

export function assertNoReportLeaks(serialized: string, canaries: readonly string[]): void {
  if (canaries.filter(Boolean).some(canary => serialized.includes(canary))) throw cleanFailure("ReportLeak");
}

export async function waitReady(origin: string, owned: { readonly result: ChildExit | undefined }, signal: AbortSignal, timeoutMs = 10000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    signal.throwIfAborted();
    if (owned.result) throw cleanFailure(owned.result.spawnFailed ? "SpawnFailed" : "ServerExited");
    try { if ((await request(origin, signal, "", "/v1/sys/health", "GET", undefined, Math.min(300, until - Date.now()))).status === 200) return; }
    catch { signal.throwIfAborted(); }
    await Effect.runPromise(Effect.sleep(Math.max(1, Math.min(50, until - Date.now()))), { signal });
  }
  throw cleanFailure("ServerTimeout");
}

/** Install synchronously at spawn: one observation handles all exit/error/close races. */
export function observeChild(child: ChildProcess) {
  let result: ChildExit | undefined;
  let failed = false;
  let resolveExit!: (exit: ChildExit) => void;
  const exited = new Promise<ChildExit>(resolve => { resolveExit = resolve; });
  const finish = (code: number | null, signal: NodeJS.Signals | null) => {
    if (result) return;
    result = { code, signal, spawnFailed: failed }; resolveExit(result);
  };
  child.on("error", () => { failed = true; if (child.pid === undefined) finish(null, null); });
  child.once("exit", finish);
  child.once("close", finish);
  if (child.exitCode !== null || child.signalCode !== null) finish(child.exitCode, child.signalCode);
  const within = async (milliseconds: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([exited, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), milliseconds); })]); }
    finally { if (timer) clearTimeout(timer); }
  };
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    if (result) return;
    child.kill("SIGTERM");
    if (await within(2000)) return;
    child.kill("SIGKILL");
    if (!await within(2000)) throw cleanFailure("CleanupFailed");
  })();
  return { child, exited, stop, get result() { return result; } };
}

export async function confirmListenerClosed(port: number, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  return new Promise<boolean>(resolve => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (closed: boolean) => { clearTimeout(timer); signal.removeEventListener("abort", abort); socket.destroy(); resolve(closed); };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(false), 300);
    signal.addEventListener("abort", abort, { once: true });
    socket.once("connect", () => finish(false));
    socket.once("error", (error: NodeJS.ErrnoException) => finish(error.code === "ECONNREFUSED"));
  }).then(closed => { signal.throwIfAborted(); return closed; });
}

/** The timer and abort subscription live exactly as long as the request/body. */
export async function request(origin: string, signal: AbortSignal, token: string, path: string, method = "GET", body?: unknown, timeoutMs = 5000): Promise<{ status: number; value: any }> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let url: URL; let payload: string | undefined; let req: ClientRequest;
    try {
      url = new URL(origin); if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.origin !== origin || !path.startsWith("/")) throw 0;
      payload = body === undefined ? undefined : JSON.stringify(body);
      req = httpRequest({ hostname: "127.0.0.1", port: url.port, path, method, agent: false, headers: { "x-vault-token": token, ...(body === undefined ? {} : { "content-type": "application/json" }) } });
    }
    catch { reject(cleanFailure("InvalidInput")); return; }
    let finished = false;
    const finish = (code?: string, response?: { status: number; value: any }) => {
      if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener("abort", abort); req.destroy();
      if (code) reject(cleanFailure(code)); else resolve(response!);
    };
    const abort = () => finish("Cancelled");
    const timer = setTimeout(() => finish("Timeout"), Math.max(1, Math.min(timeoutMs, 5000)));
    signal.addEventListener("abort", abort, { once: true });
    req.once("error", () => finish("Unavailable"));
    req.once("response", response => {
      const chunks: Buffer[] = []; let length = 0;
      response.on("data", (chunk: Buffer) => { length += chunk.length; if (length > 65536) finish("ResponseTooLarge"); else chunks.push(chunk); });
      response.once("error", () => finish("Unavailable"));
      response.once("aborted", () => finish("Unavailable"));
      response.once("end", () => { let value: any; try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* Never expose response bytes in errors. */ } finish(undefined, { status: response.statusCode ?? 0, value }); });
    });
    try { if (signal.aborted) abort(); else req.end(payload); } catch { finish("InvalidInput"); }
  });
}
