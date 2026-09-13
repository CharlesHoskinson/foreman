import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Effect } from 'effect';
import { makeLiveRunJournalLayer } from '@foreman/event-log';
import { EndstopLedger, makeLiveEndstopLedgerLayer } from './execution-ledger.js';
import { makeLiveRunLease } from './supervisor-live-services.js';
import { RunLease } from './supervisor.js';
import { makeLivePelArtifactPort, readPelRecords, replayPelRun, decodePelSuspensionV1 } from './pel-journal.js';
import { crashStages, crashRunId, crashContractId } from './pel-recovery-crash-fixture.js';
import { decodeRunResultV1 } from './pel-run-result.js';
let bundleRoot: string, entry: string;
before(async () => {
    bundleRoot = await mkdtemp(join(tmpdir(), 'pel-crash-compiled-'));
    entry = join(bundleRoot, 'recovery-fixture.mjs');
    await build({ entryPoints: [resolve('packages/orchestration/src/pel-recovery-crash-fixture.ts')], outfile: entry, bundle: true, platform: 'node', target: 'node24', format: 'esm', logLevel: 'silent', banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
});
after(async () => { if (bundleRoot) await rm(bundleRoot, { recursive: true, force: true }); });
async function killAtBoundary(root: string, stage: string, ownsLease = false) {
    const child = spawn(process.execPath, [entry, root, ownsLease ? 'owner-start' : 'start', stage], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    try {
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(Error(`Crash fixture did not reach ${stage}: ${stdout}${stderr}`)), 15000);
            child.stdout.on('data', chunk => {
                stdout += chunk;
                if (stdout.includes('\n')) {
                    clearTimeout(timer);
                    try { assert.deepEqual(JSON.parse(stdout.trim()), { ready: stage }); resolve(); } catch (error) { reject(error); }
                }
            });
            void closed.then(() => { clearTimeout(timer); reject(Error(`Crash fixture exited before ${stage}: ${stdout}${stderr}`)); }, reject);
        });
        if (ownsLease) {
            const competing = await Effect.runPromise(Effect.gen(function* () { const lease = yield* RunLease; return yield* lease.acquire(crashRunId); }).pipe(Effect.provide(makeLiveRunLease(root))));
            assert.equal(competing._tag, 'Busy');
        }
        assert.equal(child.kill('SIGKILL'), true);
        const exit = await closed;
        assert.equal(exit.signal, 'SIGKILL');
        assert.equal(stderr, '');
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
}
function resumeWorker(root: string, stage: string, unavailable: boolean, ownsLease = false) {
    const resumed = spawnSync(process.execPath, [entry, root, ownsLease ? 'owner-resume' : 'resume', stage, ...(unavailable ? ['unavailable'] : [])], { encoding: 'utf8', timeout: 20000 });
    assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
    const parsed: unknown = JSON.parse(resumed.stdout), value = parsed as { result?: unknown };
    const decoded = decodeRunResultV1(value.result);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) throw Error('Invalid fixture result');
    return decoded.value;
}
for (const scenario of [...crashStages.map(stage => ({ stage, unavailable: false })), { stage: 'after-external-completion' as const, unavailable: true }]) {
    test(`T-M4-003 T-M4-004 SIGKILL worker at ${scenario.stage}${scenario.unavailable ? ' with unavailable observation' : ''} resumes under the surviving owner`, async () => {
        const root = await mkdtemp(join(tmpdir(), 'pel-crash-state-'));
        const owner = await Effect.runPromise(Effect.gen(function* () { const lease = yield* RunLease; return yield* lease.acquire(crashRunId); }).pipe(Effect.provide(makeLiveRunLease(root))));
        assert.equal(owner._tag, 'Held');
        if (owner._tag !== 'Held') throw Error('Fixture owner busy');
        try {
            await killAtBoundary(root, scenario.stage);
            // This is worker crash recovery. The actual supervisor lease remains held.
            const competing = await Effect.runPromise(Effect.gen(function* () { const lease = yield* RunLease; return yield* lease.acquire(crashRunId); }).pipe(Effect.provide(makeLiveRunLease(root))));
            assert.equal(competing._tag, 'Busy');
            const before = await Effect.runPromise(readPelRecords(crashRunId).pipe(Effect.provide(makeLiveRunJournalLayer(root)))), replay = replayPelRun(before);
            assert.equal(replay.ok, true);
            if (!replay.ok || !replay.value.suspensionRef) throw Error('No durable boundary');
            const bytes = await Effect.runPromise(makeLivePelArtifactPort(root).get(crashRunId, replay.value.suspensionRef, 64 * 1024 * 1024)), boundary = decodePelSuspensionV1(JSON.parse(Buffer.from(bytes).toString()));
            assert.equal(boundary.ok, true);
            if (!boundary.ok) throw Error('Invalid boundary');
            const ledgerBefore = await Effect.runPromise(Effect.gen(function* () { const ledger = yield* EndstopLedger; return yield* ledger.status(crashContractId); }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))));
            assert.equal(ledgerBefore.counts.totalActions, scenario.stage === 'before-reservation' ? 0 : 1);
            assert.equal(replay.value.intents.size, ['before-reservation', 'after-reservation'].includes(scenario.stage) ? 0 : 1);
            assert.equal(replay.value.results.size, scenario.stage === 'during-cleanup' ? 1 : 0);
            const result = resumeWorker(root, scenario.stage, scenario.unavailable), unknown = scenario.stage === 'after-dispatch' || scenario.unavailable;
            assert.equal(result.state, unknown ? 'needs-action' : 'succeeded');
            if (unknown) {
                assert.equal(result.externalOutcome, 'unknown');
                assert.deepEqual(result.usage.counters, boundary.value.committedCounters);
                assert.equal(result.usage.unresolvedEffectIds.length, 1);
                const repeated = resumeWorker(root, scenario.stage, scenario.unavailable);
                assert.deepEqual(repeated.usage.counters, boundary.value.committedCounters);
            } else {
                assert.deepEqual(result.finalValue, { tag: 'number', value: 5 });
                assert.ok(result.usage.counters.reductions >= boundary.value.committedCounters.reductions);
                assert.equal(result.usage.unresolvedEffectIds.length, 0);
            }
            const provider = (await readFile(join(root, 'fake-provider.ndjson'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { state: string });
            assert.equal(provider.filter(event => event.state === 'dispatched').length, 1);
            if (['before-reservation', 'after-reservation', 'after-dispatch', 'during-cleanup'].includes(scenario.stage)) assert.equal(provider.filter(event => event.state === 'observed').length, 0);
            const ledgerAfter = await Effect.runPromise(Effect.gen(function* () { const ledger = yield* EndstopLedger; return yield* ledger.status(crashContractId); }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))));
            assert.equal(ledgerAfter.counts.totalActions, 1);
            const afterRecords = await Effect.runPromise(readPelRecords(crashRunId).pipe(Effect.provide(makeLiveRunJournalLayer(root))));
            assert.equal(afterRecords.filter(event => event.type === 'pel.effect.result.v1').length, unknown ? 0 : 1);
        } finally { await Effect.runPromise(owner.release()); await rm(root, { recursive: true, force: true }); }
    });
}

test('T-M4-004 a killed owning process releases its kernel lease for a new owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pel-owner-crash-'));
    try {
        await killAtBoundary(root, 'after-dispatch', true);
        const result = resumeWorker(root, 'after-dispatch', false, true);
        assert.equal(result.state, 'needs-action');
        assert.equal(result.externalOutcome, 'unknown');
        const provider = (await readFile(join(root, 'fake-provider.ndjson'), 'utf8')).trim().split('\n');
        assert.equal(provider.length, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
});

for (const stage of crashStages.filter(stage => stage !== 'after-dispatch')) {
    test(`T-M4-004 owning process SIGKILL at ${stage} permits safe durable restart`, async () => {
        const root = await mkdtemp(join(tmpdir(), 'pel-owner-crash-'));
        try {
            await killAtBoundary(root, stage, true);
            const result = resumeWorker(root, stage, false, true);
            assert.equal(result.state, 'succeeded');
            assert.deepEqual(result.finalValue, { tag: 'number', value: 5 });
            const provider = (await readFile(join(root, 'fake-provider.ndjson'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { state: string });
            assert.equal(provider.filter(event => event.state === 'dispatched').length, 1);
            const state = await Effect.runPromise(Effect.gen(function* () { const ledger = yield* EndstopLedger; return yield* ledger.status(crashContractId); }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))));
            assert.equal(state.counts.totalActions, 1);
        } finally { await rm(root, { recursive: true, force: true }); }
    });
}
