import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { supervise } from './supervise.js';
import { ByteSink, LiveLauncherLayer } from './services.js';
test('protocol supervision preserves stdin bytes, explicit cwd and replacement environment', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'foreman-protocol-'));
    const chunks: Uint8Array[] = [];
    try {
        const input = Buffer.from('quote " slash \\ dollar $() Unicode λ\n\u0000tail');
        const result = await Effect.runPromise(supervise({ cmd: [process.execPath, '-e', `const chunks=[];process.stdin.on('data',c=>chunks.push(c));process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({cwd:process.cwd(),keys:Object.keys(process.env).sort(),bytes:Buffer.concat(chunks).toString('base64')}));});`], cwd, env: { FOREMAN_TEST: 'exact' }, envMode: 'replace', stdin: input, timeoutSecs: 5, graceSecs: 0, heartbeatIntervalSecs: 1, launcherPid: process.pid, platform: process.platform }).pipe(Effect.provideService(ByteSink, { writeStdout: bytes => Effect.sync(() => { chunks.push(bytes); }), writeStderr: () => Effect.void }), Effect.provide(LiveLauncherLayer)));
        assert.equal(result.exitCode, 0);
        const output = JSON.parse(Buffer.concat(chunks).toString());
        assert.equal(output.cwd, cwd);
        assert.deepEqual(output.keys, ['FOREMAN_TEST']);
        assert.equal(output.bytes, input.toString('base64'));
    }
    finally {
        await rm(cwd, { recursive: true, force: true });
    }
});
