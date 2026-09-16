import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, lstat, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Redacted } from "effect";
import { makeSyntheticOpenBaoCredentialStore } from "../packages/providers/src/testing.js";
import type { CredentialStoreFailure } from "../packages/providers/src/credential-store.js";
import { makePilotClient, type PilotFailure } from "../packages/orchestration/src/openbao-pilot.js";
import { assertNoReportLeaks, cleanFailure, confirmListenerClosed, observeChild, request, waitReady, type ChildExit } from "./openbao-pilot/lifecycle.js";
import { implementationEvidence } from "./openbao-pilot/provenance.js";
import { bindBinaryReceipt, snapshotBinary } from "./openbao-pilot/binary-receipt.js";
import { deletionSemantics } from "./openbao-pilot/deletion-semantics.js";
export { observeChild } from "./openbao-pilot/lifecycle.js";
export const getPilotImplementationEvidence = () => implementationEvidence(import.meta.url);

const providers = ["codex", "grok", "claude", "agy"] as const;
const accounts = ["account-a", "account.2"] as const;
const deadline = () => Date.now() + 5_000;

export interface PilotInput { readonly binary: string; readonly binarySha256: string; readonly receiptSha256: string; readonly outputDirectory: string }
export interface PilotOutcome { readonly id: `P${string}`; readonly status: "passed" | "failed" | "not-run"; readonly passed: boolean; readonly durationMs: number; readonly assertions: readonly string[]; readonly peer: "openbao-2.6.2" | "task-1-http-fixture" | "compiled-fake-worker" | "report-validator" }
/** Scenario completion only. Full evidence validation remains a separate P11 gate. */
export function pilotOutcomesComplete(outcomes: readonly Pick<PilotOutcome, "id" | "status" | "passed">[]): boolean {
  const required = new Set(["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11"]);
  return outcomes.length === required.size && outcomes.every(outcome => outcome.status === "passed" && outcome.passed === true && required.delete(outcome.id));
}
export interface PilotReport {
  readonly schemaVersion: 1; readonly provenance: "synthetic"; readonly liveAccountsQualified: false;
  readonly sourceRevision: string; readonly implementationHashes: Readonly<Record<string, string>>;
  readonly sourceDirty: boolean;
  readonly buildEnvironment: { readonly nodeVersion: string; readonly nodeSha256: string };
  readonly runtimeEnvironment: { readonly nodeVersion: string; readonly nodeSha256: string };
  readonly bundleInputHashes: Readonly<Record<string, string>>; readonly dependencyHashes: Readonly<Record<string, string>>;
  readonly bundleInputs: readonly string[];
  readonly evidenceMode: "compiled" | "source"; readonly executableSha256: string;
  readonly dependencies: { readonly effect: string; readonly esbuild: string };
  readonly binaryProvenance: Record<string, unknown>; readonly processExitStatus: number | null;
  readonly processExit: ChildExit | null;
  readonly cleanup: { readonly childExited: boolean; readonly listenerClosed: boolean; readonly temporaryDirectoryRemoved: boolean };
  readonly pilotComplete: boolean; readonly outcomes: readonly PilotOutcome[];
}
export interface PilotRunFailure { readonly _tag: "PilotRunFailure"; readonly code: string }

async function freePort(): Promise<number> { const server = createServer(); await new Promise<void>((ok, no) => server.once("error", no).listen(0, "127.0.0.1", ok)); const address = server.address(); if (!address || typeof address === "string") throw new Error("port"); const port = address.port; await new Promise<void>((ok, no) => server.close(e => e ? no(e) : ok())); return port; }
function outcome(id: PilotOutcome["id"], started: number, passed: boolean, assertions: string[], peer: PilotOutcome["peer"]): PilotOutcome { return { id, status: passed ? "passed" : "failed", passed, durationMs: Date.now() - started, assertions, peer }; }

export interface PilotOptions {
  readonly timeoutMs?: number;
  /** Trusted in-process synthetic test instrumentation. Runs before provenance checks. */
  readonly onPhase?: (event: { readonly phase: "acquired" | "launched"; readonly runtime: string; readonly pid?: number }) => Effect.Effect<void>;
}

async function execute(input: PilotInput, runtime: string, signal: AbortSignal, options: PilotOptions): Promise<PilotReport> {
  const runEffect = <A, E>(effect: Effect.Effect<A, E>) => { signal.throwIfAborted(); return Effect.runPromise(effect, { signal }); };
  const runExit = <A, E>(effect: Effect.Effect<A, E>) => runEffect(Effect.exit(effect));
  const api = (origin: string, token: string, path: string, method = "GET", body?: unknown) => request(origin, signal, token, path, method, body);
  signal.throwIfAborted();
  if (options.onPhase) await runEffect(options.onPhase({ phase: "acquired", runtime }));
  const binary = resolve(input.binary); const outputDirectory = resolve(input.outputDirectory);
  const bound = await runEffect(Effect.either(bindBinaryReceipt({ ...input, binary })));
  if (bound._tag === "Left") throw bound.left;
  const snapshot = await runEffect(Effect.either(snapshotBinary(binary, input.binarySha256, runtime)));
  if (snapshot._tag === "Left") throw snapshot.left;
  const executable = snapshot.right;
  const binaryProvenance = { ...bound.right, sourceExecutable: binary, executable, launchBinding: "owned-private-digest-matched-snapshot", executedImageSha256: input.binarySha256 };
  signal.throwIfAborted();
  // Every ancestor is checked: an existing symlink must never redirect output.
  const ancestors: string[] = []; for (let path = outputDirectory; path !== dirname(path); path = dirname(path)) ancestors.unshift(path);
  for (const path of ancestors) {
    try { const info = await lstat(path); if (info.isSymbolicLink() || !info.isDirectory()) throw cleanFailure("UnsafeOutput"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await mkdir(path, { mode: 0o700 }); }
    signal.throwIfAborted();
  }
  const outputInfo = await lstat(outputDirectory);
  if ((outputInfo.mode & 0o077) !== 0 || outputInfo.uid !== process.getuid?.()) throw cleanFailure("UnsafeOutput");
  const rootToken = `root-token-${randomBytes(24).toString("hex")}`; const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
  let brokerCanary = "";
  const deletionCanaries: string[] = [];
  let child: ChildProcess | undefined; let owned: ReturnType<typeof observeChild> | undefined; let listenerClosed = false; const outcomes: PilotOutcome[] = []; const material = new Map<string, { accessToken: string; refreshToken: string }>();
  const add = async (id: PilotOutcome["id"], peer: PilotOutcome["peer"], fn: () => Promise<string[]>) => { signal.throwIfAborted(); const start = Date.now(); try { const labels = await fn(); signal.throwIfAborted(); outcomes.push(outcome(id, start, true, labels, peer)); } catch { signal.throwIfAborted(); outcomes.push(outcome(id, start, false, ["sanitized-assertion-failure"], peer)); } };
  const notRun = (id: PilotOutcome["id"], peer: PilotOutcome["peer"], reason: string) => outcomes.push({ id, status: "not-run", passed: false, durationMs: 0, assertions: [reason], peer });
  try {
    signal.throwIfAborted();
    child = spawn(executable, ["server", "-dev", "-dev-no-store-token", `-dev-listen-address=127.0.0.1:${port}`], { cwd: runtime, env: { HOME: runtime, PATH: "/usr/bin:/bin", LANG: "C", BAO_DEV_ROOT_TOKEN_ID: rootToken, BAO_LOG_LEVEL: "error", NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1", HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "" }, stdio: ["ignore", "pipe", "pipe"] });
    owned = observeChild(child);
    for (const stream of [child.stdout!, child.stderr!]) stream.resume();
    if (options.onPhase) await runEffect(options.onPhase({ phase: "launched", runtime, ...(child.pid === undefined ? {} : { pid: child.pid }) }));
    await waitReady(origin, owned, signal);
    if ((await api(origin, rootToken, "/v1/sys/mounts/foreman-pilot", "POST", { type: "kv", options: { version: "2" } })).status >= 300) throw new Error("mount");
    const rootStore = makeSyntheticOpenBaoCredentialStore({ endpoint: origin, mount: "foreman-pilot", token: () => Effect.succeed(Redacted.make(rootToken)) });
    for (const provider of providers) for (const account of accounts) { const key = `${provider}:${account}`; material.set(key, { accessToken: `foreman-synthetic-access-${randomBytes(18).toString("hex")}`, refreshToken: `foreman-synthetic-refresh-${randomBytes(18).toString("hex")}` }); }
    await add("P01", "openbao-2.6.2", async () => { for (const provider of providers) for (const account of accounts) { const ref = `bao:${provider}:${account}`; const expected = material.get(`${provider}:${account}`)!; await runEffect(rootStore.write(ref, Redacted.make(expected), 0, deadline())); const read = await runEffect(rootStore.read(ref, deadline())); const actual = Redacted.value(read.material); if (read.provider !== provider || read.account !== account || read.version !== 1 || actual.accessToken !== expected.accessToken || actual.refreshToken !== expected.refreshToken) throw new Error("identity"); } return ["eight-record-exact-roundtrip", "exact-material-match", "real-kv-v2"]; });
    const policy = `path \"foreman-pilot/data/providers/codex/account-a\" { capabilities = [\"read\"] }`;
    if ((await api(origin, rootToken, "/v1/sys/policies/acl/foreman-pilot-read", "PUT", { policy })).status >= 300) throw new Error("policy");
    const tokenResponse = await api(origin, rootToken, "/v1/auth/token/create", "POST", { policies: ["foreman-pilot-read"], renewable: false, ttl: "5m" }); const brokerToken = tokenResponse.value?.auth?.client_token; if (typeof brokerToken !== "string") throw new Error("token");
    brokerCanary = brokerToken;
    const broker = makePilotClient({ origin, token: Redacted.make(brokerToken) });
    const failureCode = async (effect: Effect.Effect<unknown, PilotFailure | CredentialStoreFailure>) => { const exit = await runExit(effect); signal.throwIfAborted(); return exit._tag === "Failure" && exit.cause._tag === "Fail" ? exit.cause.error.code : undefined; };
    await add("P02", "openbao-2.6.2", async () => { for (const ref of ["bao:grok:account-a", "bao:codex:account.2"]) if (await failureCode(broker.read(ref, deadline())) !== "Denied") throw new Error("acl"); return ["cross-provider-denied", "other-account-denied"]; });
    await add("P03", "openbao-2.6.2", async () => { const ref = "bao:agy:account-a"; const next = Redacted.make(material.get("agy:account-a")!); const exits = await runEffect(Effect.all([Effect.exit(rootStore.write(ref, next, 1, deadline())), Effect.exit(rootStore.write(ref, next, 1, deadline()))], { concurrency: 2 })); const successes = exits.filter(x => x._tag === "Success"); const failures = exits.filter(x => x._tag === "Failure"); const code = failures[0]?.cause._tag === "Fail" ? failures[0].cause.error.code : undefined; if (successes.length !== 1 || failures.length !== 1 || code !== "Conflict") throw new Error("cas"); return ["single-cas-winner", "single-cas-conflict"]; });
    notRun("P04", "task-1-http-fixture", "deferred-to-task-3b");
    await add("P06", "openbao-2.6.2", async () => { await runEffect(broker.read("bao:codex:account-a", deadline())); const revoke = await api(origin, brokerToken, "/v1/auth/token/revoke-self", "POST", {}); if (revoke.status >= 300) throw new Error("revoke"); if (await failureCode(broker.read("bao:codex:account-a", deadline())) !== "Denied") throw new Error("read"); return ["pre-revocation-read-succeeded", "broker-token-revoked", "subsequent-read-denied"]; });
    notRun("P07", "compiled-fake-worker", "deferred-to-task-3b");
    notRun("P08", "task-1-http-fixture", "deferred-to-task-3b");
    await add("P10", "openbao-2.6.2", async () => { const ref = "bao:claude:account-a"; const before = await runEffect(rootStore.read(ref, deadline())); const beforeMaterial = Redacted.value(before.material); const code = await failureCode(rootStore.write(ref, Redacted.make(material.get("claude:account-a")!), 0, deadline())); const after = await runEffect(rootStore.read(ref, deadline())); const afterMaterial = Redacted.value(after.material); if (code !== "Conflict" || before.version !== after.version || JSON.stringify(beforeMaterial) !== JSON.stringify(afterMaterial)) throw new Error("create-only"); return ["duplicate-import-conflict", "existing-version-and-bytes-unchanged", ...await runEffect(deletionSemantics(rootStore, value => deletionCanaries.push(value)))]; });
    notRun("P09", "openbao-2.6.2", "completion-cleanup-measured-cancellation-control-deferred-to-task-3b");
    await add("P05", "openbao-2.6.2", async () => {
      const sealed = await api(origin, rootToken, "/v1/sys/seal", "POST", {});
      if (sealed.status >= 300 || await failureCode(rootStore.read("bao:agy:account-a", deadline())) !== "Unavailable") throw new Error("sealed-read");
      const closedPort = await freePort();
      if (!await confirmListenerClosed(closedPort, signal)) throw new Error("closed-port");
      const unavailable = makeSyntheticOpenBaoCredentialStore({ endpoint: `http://127.0.0.1:${closedPort}`, mount: "foreman-pilot", token: () => Effect.succeed(Redacted.make(rootToken)) });
      if (await failureCode(unavailable.read("bao:agy:account-a", deadline())) !== "Unavailable") throw new Error("unavailable-read");
      return ["server-sealed", "sealed-response-unavailable", "closed-endpoint-unavailable"];
    });
  } finally { if (owned) await owned.stop(); }
  signal.throwIfAborted();
  listenerClosed = await confirmListenerClosed(port, signal);
  signal.throwIfAborted();
  await rm(runtime, { recursive: true, force: true });
  const removed = await stat(runtime).then(() => false, () => true);
  const evidence = await implementationEvidence(import.meta.url, signal);
  signal.throwIfAborted();
  notRun("P11", "report-validator", "full-evidence-validation-deferred-to-task-3b");
  const reportBase: Omit<PilotReport, "outcomes"> = { schemaVersion: 1, provenance: "synthetic", liveAccountsQualified: false, pilotComplete: pilotOutcomesComplete(outcomes), ...evidence, binaryProvenance, processExit: owned?.result ?? null, processExitStatus: owned?.result?.code ?? null, cleanup: { childExited: owned?.result !== undefined && !owned.result.spawnFailed, listenerClosed, temporaryDirectoryRemoved: removed } };
  const report: PilotReport = { ...reportBase, outcomes: [...outcomes].sort((a,b) => Number(a.id.slice(1)) - Number(b.id.slice(1))) }; const reportPath = join(outputDirectory, "openbao-pilot-report.json"); const serialized = `${JSON.stringify(report, null, 2)}\n`; assertNoReportLeaks(serialized, [rootToken, brokerCanary, ...deletionCanaries, ...[...material.values()].flatMap(x => [x.accessToken, x.refreshToken])]); signal.throwIfAborted(); await writeFile(reportPath, serialized, { mode: 0o600, flag: "wx", signal }); signal.throwIfAborted(); return report;
}

export function runOpenBaoPilot(input: PilotInput): Effect.Effect<PilotReport, PilotRunFailure> {
  return runOpenBaoPilotWithOptions(input, {});
}

// Hooks can pause execution, but cannot replace provenance or production validation.
export function runOpenBaoPilotWithOptions(input: PilotInput, options: PilotOptions): Effect.Effect<PilotReport, PilotRunFailure> {
  const sanitize = (error: unknown): PilotRunFailure => {
    const codes = ["InvalidProvenance", "SnapshotIOFailed", "SpawnFailed", "ServerExited", "ServerTimeout", "CleanupFailed", "UnsafeOutput", "ReportLeak", "OverallTimeout"];
    if (typeof error === "object" && error !== null && "_tag" in error && error._tag === "PilotRunFailure" && "code" in error && typeof error.code === "string" && codes.includes(error.code)) return cleanFailure(error.code);
    return cleanFailure("PilotFailed");
  };
  const fixture = Effect.acquireUseRelease(
    Effect.tryPromise({ try: () => mkdtemp(join(tmpdir(), "foreman-openbao-pilot-")), catch: sanitize }),
    runtime => joinedExecution(input, runtime, options, sanitize),
    runtime => Effect.tryPromise({ try: () => rm(runtime, { recursive: true, force: true }), catch: () => cleanFailure("CleanupFailed") }).pipe(Effect.orDie),
  );
  return fixture.pipe(Effect.timeoutFail({ duration: Math.max(1, Math.min(options.timeoutMs ?? 120_000, 120_000)), onTimeout: () => cleanFailure("OverallTimeout") }));
}

function joinedExecution(input: PilotInput, runtime: string, options: PilotOptions, sanitize: (error: unknown) => PilotRunFailure) {
  return Effect.async<PilotReport, PilotRunFailure>(resume => {
    const controller = new AbortController();
    const execution = execute(input, runtime, controller.signal, options);
    void execution.then(
      value => resume(Effect.succeed(value)),
      error => resume(Effect.fail(sanitize(error))),
    );
    return Effect.promise(async () => { controller.abort(); await execution.catch(error => { if (sanitize(error).code === "CleanupFailed") throw cleanFailure("CleanupFailed"); }); });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [binary, binarySha256, receiptSha256, outputDirectory] = process.argv.slice(2); if (!binary || !binarySha256 || !receiptSha256 || !outputDirectory) process.exit(64);
  Effect.runPromise(runOpenBaoPilot({ binary, binarySha256, receiptSha256, outputDirectory })).then(report => { process.stdout.write(`${JSON.stringify({ report: join(resolve(outputDirectory), "openbao-pilot-report.json"), passed: report.pilotComplete })}\n`); if (!report.pilotComplete) process.exitCode = 1; }, () => { process.stderr.write("openbao pilot failed\n"); process.exitCode = 1; });
}
