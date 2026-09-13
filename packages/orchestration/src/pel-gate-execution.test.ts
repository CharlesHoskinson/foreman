import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Effect, Layer } from 'effect';
import { ProcessExec, ProcessFailure, liveProcessExec, type RunCapturedOptions } from './queue-services.js';
import { pelHash } from './pel-journal.js';
import { runPelRegisteredGate, decodePelGateExecution } from './pel-gate-execution.js';
import type { PelGateBindingV1 } from './pel-run-contract.js';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pelBytesHash, pelFailure } from './pel-journal.js';

const environment = { PATH: '/usr/bin', LANG: 'C', REGISTERED: 'yes' };
const gate: PelGateBindingV1 = { argv: ['/trusted/check', '--exact', 'literal;$(ignored)'], environmentRefs: ['env:checks'], environmentSha256: pelHash(environment), maxOutputBytes: 1024, timeoutMs: 500 };
const candidate = 'a'.repeat(64);
function fixture(exitCode = 0, observations: readonly string[] = [candidate, candidate]) {
    let observed = 0;
    const calls: RunCapturedOptions[] = [];
    const layer = Layer.succeed(ProcessExec, {
        runCaptured: (options) => Effect.sync(() => { calls.push(options); return { exitCode, stdout: 'host result', stderr: '' }; }),
        runForeground: () => Effect.die('unexpected unbounded execution'),
        runIgnoredStdio: () => Effect.die('unexpected ignored execution'),
    });
    const ports = { resolveEnvironment: (refs: readonly string[]) => Effect.sync(() => { assert.deepEqual(refs, gate.environmentRefs); return environment; }), observeCandidate: () => Effect.sync(() => observations[observed++] ?? candidate) };
    return { calls, layer, ports };
}

test('registered gate uses exact argv, explicit environment, workspace and process bounds', async () => {
    const f = fixture();
    const result = await Effect.runPromise(runPelRegisteredGate(gate, '/admitted/worktree', candidate, f.ports).pipe(Effect.provide(f.layer)));
    assert.equal(result.passed, true); assert.equal(result.exitCode, 0);
    assert.equal(result.environmentDigest, gate.environmentSha256); assert.equal(result.gateDigest, pelHash(gate));
    assert.deepEqual(f.calls, [{ command: gate.argv[0], args: gate.argv.slice(1), cwd: '/admitted/worktree', env: environment, timeoutMs: 500, maxOutputBytes: 1024 }]);
    assert.equal(decodePelGateExecution(result, gate.maxOutputBytes).ok, true);
    for (const changed of [{ ...result, passed: false }, { ...result, stdoutSha256: '0'.repeat(64) }, { ...result, unchecked: true }]) assert.equal(decodePelGateExecution(changed, gate.maxOutputBytes).ok, false);
    assert.equal(decodePelGateExecution(result, 1).ok, false);
});
test('nonzero host check returns ordinary failed evidence', async () => {
    const f = fixture(2);
    const result = await Effect.runPromise(runPelRegisteredGate(gate, '/worktree', candidate, f.ports).pipe(Effect.provide(f.layer)));
    assert.equal(result.passed, false); assert.equal(result.exitCode, 2); assert.equal(result.stdout, 'host result');
});
for (const [name, observations, executions] of [['before', ['b'.repeat(64)], 0], ['during', [candidate, 'b'.repeat(64)], 1]] as const) test(`candidate mutation ${name} gate execution cannot produce verification`, async () => {
    const f = fixture(0, observations);
    const result = await Effect.runPromise(Effect.either(runPelRegisteredGate(gate, '/worktree', candidate, f.ports).pipe(Effect.provide(f.layer))));
    assert.equal(result._tag, 'Left'); if (result._tag === 'Left') assert.equal(result.left.code, 'candidate-changed');
    assert.equal(f.calls.length, executions);
});
test('changed resolved environment rejects execution before spawning', async () => {
    const f = fixture();
    const result = await Effect.runPromise(Effect.either(runPelRegisteredGate(gate, '/worktree', candidate, { ...f.ports, resolveEnvironment: () => Effect.succeed({ PATH: '/changed' }) }).pipe(Effect.provide(f.layer))));
    assert.equal(result._tag, 'Left'); if (result._tag === 'Left') assert.equal(result.left.code, 'binding-mismatch');
    assert.equal(f.calls.length, 0);
});
test('transport interruption and output overflow are typed failures rather than passing checks', async () => {
    for (const reason of ['timeout', 'output_bound', 'spawn_failed'] as const) {
        const f = fixture();
        const failed = Layer.succeed(ProcessExec, { runCaptured: () => Effect.fail(new ProcessFailure(reason)), runForeground: () => Effect.die('unexpected'), runIgnoredStdio: () => Effect.die('unexpected') });
        const result = await Effect.runPromise(Effect.either(runPelRegisteredGate(gate, '/worktree', candidate, f.ports).pipe(Effect.provide(failed))));
        assert.equal(result._tag, 'Left'); if (result._tag === 'Left') assert.equal(result.left.code, 'verification-unavailable');
    }
});
test('live launcher enforces the registered combined output bound', async () => {
    const liveGate: PelGateBindingV1 = { ...gate, argv: [process.execPath, '--version'], environmentRefs: [], environmentSha256: pelHash({}), maxOutputBytes: 1 };
    const result = await Effect.runPromise(Effect.either(runPelRegisteredGate(liveGate, process.cwd(), candidate, { resolveEnvironment: () => Effect.succeed({}), observeCandidate: () => Effect.succeed(candidate) }).pipe(Effect.provide(liveProcessExec))));
    assert.equal(result._tag, 'Left'); if (result._tag === 'Left') assert.equal(result.left.code, 'verification-unavailable');
});
test('a real gate that changes a candidate file cannot return passing evidence', { skip: process.platform !== 'linux' }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pel-gate-mutation-'));
    try {
        const path = join(root, 'candidate.txt'), content = Buffer.from('immutable candidate');
        await writeFile(path, content);
        const liveGate: PelGateBindingV1 = { ...gate, argv: ['/usr/bin/truncate', '--size=0', path], environmentRefs: [], environmentSha256: pelHash({}) };
        const observeCandidate = () => Effect.tryPromise({ try: async () => pelBytesHash(await readFile(path)), catch: () => ({ code: 'candidate-changed' as const, message: 'Candidate file missing.' }) });
        const result = await Effect.runPromise(Effect.either(runPelRegisteredGate(liveGate, root, pelBytesHash(content), { resolveEnvironment: () => Effect.succeed({}), observeCandidate }).pipe(Effect.provide(liveProcessExec))));
        assert.equal(result._tag, 'Left'); if (result._tag === 'Left') assert.equal(result.left.code, 'candidate-changed');
        assert.equal((await readFile(path)).length, 0);
    } finally { await rm(root, { recursive: true, force: true }); }
});
