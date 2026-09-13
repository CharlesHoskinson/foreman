import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Effect, Layer } from 'effect';
import type { RunId } from '@foreman/event-log';
import * as supervisor from './supervisor.js';
import { runResumeQueueExecution } from './resume-queue-execution.js';
import { WorktreeRestore } from './resume-worktree-restore.js';
import { RunJournal } from '@foreman/event-log';
import { RunDiscovery, RunLease, TypedJournalReader, sweepOneRun, type SupervisorServices } from './supervisor.js';
import type { RunResultV1 } from './pel-run-contract.js';
const runId = 'pel-supervisor' as RunId;
const result = { schemaVersion: 1, runId, state: 'succeeded', externalOutcome: 'none', updatedAt: 1 } as RunResultV1;
const config = { resumeMaxAttempts: 2, dryRun: false };
test('Pel supervisor holds one lease and calls no restore, queue, or second budget reservation', async () => {
    assert.equal(typeof supervisor.PelSupervisorRecovery, 'function');
    let acquired = 0, released = 0, resumed = 0;
    const run = sweepOneRun(runId, config).pipe(Effect.provideService(RunLease, { acquire: () => Effect.sync(() => { acquired++; return { _tag: 'Held' as const, release: () => Effect.sync(() => { released++; }) }; }) }), Effect.provideService(TypedJournalReader, { readRun: () => Effect.succeed({ _tag: 'Ok' as const, records: [{ physicalLine: 1, event: { seq: 1, ts: '2026-09-13T00:00:00Z', type: 'pel.run.v1', lane: 'pel', payload: {} } }] }) }), Effect.provideService(supervisor.PelSupervisorRecovery, { recover: (_run, owner) => Effect.gen(function* () { assert.equal(owner.runId, runId); yield* owner.release(); assert.equal(released, 0); resumed++; return result; }) }), Effect.provideService(WorktreeRestore, { inspect: () => Effect.die('unexpected restore'), restore: () => Effect.die('unexpected restore') }), Effect.provideService(RunJournal, { allocate: () => Effect.die('unexpected allocate'), append: () => Effect.die('unexpected append'), transact: () => Effect.die('unexpected transaction'), reserveResumeAttempt: () => Effect.die('unexpected supervisor reservation') }));
    const output = await Effect.runPromise(run as Effect.Effect<supervisor.SupervisorRunResultV1>);
    assert.equal(output._tag, 'PelSwept');
    assert.equal(acquired, 1);
    assert.equal(released, 1);
    assert.equal(resumed, 1);
});
test('tagged Pel resume path uses held ownership without legacy services', async () => {
    const owner = { runId, release: () => Effect.void };
    const output = await Effect.runPromise(Effect.scoped(runResumeQueueExecution({ kind: 'pel', runId, owner, resume: () => Effect.succeed(result) })));
    assert.equal(output, result);
});

import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLiveSupervisorServices, makeLiveRunLease } from './supervisor-live-services.js';
test('live supervisor composes optional Pel recovery with canonical root and existing kernel owner', async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'pel-supervisor-live-')), root = join(temporary, 'state'), alias = join(temporary, 'alias');
    mkdirSync(root); symlinkSync(root, alias);
    let calls = 0;
    try {
        const layer = makeLiveSupervisorServices({ stateRoot: alias, pelRecovery: canonicalRoot => {
            assert.equal(canonicalRoot, root);
            return Layer.succeed(supervisor.PelSupervisorRecovery, { recover: (_id, owner) => Effect.gen(function* () {
                assert.equal(owner.runId, runId); calls++;
                const competing = yield* Effect.gen(function* () { const leases = yield* RunLease; return yield* leases.acquire(runId); }).pipe(Effect.provide(makeLiveRunLease(root)));
                assert.equal(competing._tag, 'Busy');
                return result;
            }) });
        } });
        const output = await Effect.runPromise(Effect.gen(function* () {
            const journal = yield* RunJournal;
            yield* journal.append(runId, { type: 'pel.run.v1', lane: 'pel', payload: {} });
            return yield* sweepOneRun(runId, config);
        }).pipe(Effect.provide(layer)));
        assert.equal(output._tag, 'PelSwept'); assert.equal(calls, 1);
        const released = await Effect.runPromise(Effect.gen(function* () { const leases = yield* RunLease; return yield* leases.acquire(runId); }).pipe(Effect.provide(makeLiveRunLease(root))));
        assert.equal(released._tag, 'Held'); if (released._tag === 'Held') await Effect.runPromise(released.release());
    } finally { rmSync(temporary, { recursive: true, force: true }); }
});
