import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Effect, Stream, Redacted } from 'effect';
import { createNativeProcessPort } from './native-process.js';
const launch = (script: string) => ({ cmd: [process.execPath, '-e', script], cwd: '/tmp', environment: {}, deadline: Date.now() + 5000, maxOutputBytes: 1024 });
test('ordinary process launcher refuses an unconsumed private Grok snapshot', async () => {
    const result = await Effect.runPromise(Effect.scoped(createNativeProcessPort().open({
        ...launch('process.exit(0)'), grokAuthJson: Redacted.make('private-access-token'),
    })).pipe(Effect.either));
    assert.equal(result._tag, 'Left');
    assert.ok(!JSON.stringify(result).includes('private-access-token'));
});
test('native protocol transport preserves duplex JSON and fragmented UTF-8', async () => {
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { const peer = yield* createNativeProcessPort().open(launch(`process.stdin.on('data',b=>{const v=JSON.parse(b.toString());const out=Buffer.from(JSON.stringify(v)+'\\n');for(const n of out)process.stdout.write(Buffer.from([n]));process.exitCode=0;process.stdin.destroy();});`)); yield* peer.send({ text: 'λ quote " slash \\ dollar $()' }); return yield* Stream.runCollect(peer.events); })));
    assert.deepEqual(Array.from(result).map(value => ({ ...value })), [{ text: 'λ quote " slash \\ dollar $()' }]);
});
test('native protocol rejects duplicate JSON keys and bounded output without leaking payload', async () => {
    for (const script of [`process.stdout.write('{"x":1,"x":2}\\n');`, `process.stdout.write('secret'.repeat(400));`]) {
        const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { const peer = yield* createNativeProcessPort().open(launch(script)); return yield* Stream.runCollect(peer.events); })).pipe(Effect.either));
        assert.equal(result._tag, 'Left');
        if (result._tag === 'Left') {
            assert.equal(result.left._tag, 'MalformedEvent');
            assert.ok(!result.left.message.includes('secret'));
        }
    }
});
test('native protocol never treats a killed or failed child as remote cancellation', async () => {
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () { const peer = yield* createNativeProcessPort().open(launch('process.exit(7)')); return yield* Stream.runCollect(peer.events); })).pipe(Effect.either));
    assert.equal(result._tag, 'Left');
    if (result._tag === 'Left')
        assert.equal(result.left._tag, 'OutcomeUnknown');
});
test('closing a native connection terminates its active event reader within the caller scope', async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () { const peer = yield* createNativeProcessPort().open(launch('process.stdin.resume()')); const reader = yield* Effect.fork(Stream.runDrain(peer.events).pipe(Effect.either)); yield* peer.close(); const result = yield* reader.await.pipe(Effect.timeoutFail({ duration: 1000, onTimeout: () => new Error('event reader leaked') })); assert.equal(result._tag, 'Success'); })));
});
