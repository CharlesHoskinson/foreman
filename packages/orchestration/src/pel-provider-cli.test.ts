import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Effect } from 'effect';
import { commandExitCode, runProviderCli } from './pel-provider-cli.js';
test('T-M3-026 maps every reachable provider command outcome', () => {
    for (const [outcome, code] of [['success', 0], ['failed', 1], ['invalid', 2]] as const)
        assert.equal(commandExitCode('list', outcome), code);
    for (const [outcome, code] of [['success', 0], ['failed', 1], ['invalid', 2], ['needs-action', 3], ['cancelled', 4]] as const)
        assert.equal(commandExitCode('qualify', outcome), code);
});
test('provider list succeeds with twelve visible unqualified cells and performs no workload', async () => { let calls = 0; let stdout = ''; const result = await Effect.runPromise(runProviderCli(['providers', 'list', '--json'], { input: { read: () => Effect.die('unexpected input') }, output: { stdout: s => Effect.sync(() => { stdout += s; }), stderr: () => Effect.void }, context: { defaultSnapshotPath: '/unused' }, providers: { qualify: () => { calls++; return Effect.die('unexpected workload'); } } })); assert.equal(result.exitCode, 0); assert.equal(calls, 0); assert.equal(JSON.parse(stdout).cells.length, 12); });
test('provider commands reject missing explicit qualification account/binding and duplicate flags', async () => {
    for (const argv of [['providers', 'qualify', '--profile', 'gpt-6-astra', '--transport', 'openai-responses', '--limits', 'limits.json'], ['providers', 'list', '--json', '--json']]) {
        let output = '';
        const result = await Effect.runPromise(runProviderCli(argv, { input: { read: () => Effect.die('unexpected input') }, output: { stdout: s => Effect.sync(() => { output += s; }), stderr: s => Effect.sync(() => { output += s; }) }, context: { defaultSnapshotPath: '/unused' } }));
        assert.equal(result.exitCode, 2);
        assert.ok(output.length > 0);
    }
});
