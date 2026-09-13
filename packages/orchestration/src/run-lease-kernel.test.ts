import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, statSync, readFileSync, writeFileSync, chmodSync, renameSync, linkSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
import { type RunId } from '@foreman/event-log';
import { RunLease } from './supervisor.js';
import { makeLiveRunLease } from './supervisor-live-services.js';
const runId = 'kernel-run' as RunId;
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'pel-kernel-'));
    const acquire = () => Effect.runPromise(Effect.gen(function* () { const lease = yield* RunLease; return yield* lease.acquire(runId); }).pipe(Effect.provide(makeLiveRunLease(root))));
    return { root, acquire, directory: join(root, 'runs', runId, '.supervise.lock'), close: () => rmSync(root, { recursive: true, force: true }) };
}
test('RunLease refuses legacy directories with no new protocol marker', async () => {
    const f = fixture();
    try { mkdirSync(f.directory, { recursive: true, mode: 0o700 }); assert.equal((await f.acquire())._tag, 'Busy'); } finally { f.close(); }
});
test('RunLease keeps one protected inode across release and denies simultaneous owners', async () => {
    const f = fixture();
    try {
        const first = await f.acquire(); assert.equal(first._tag, 'Held'); if (first._tag !== 'Held') throw Error('owner');
        const path = join(f.directory, 'owner-v1.lock'), before = statSync(path);
        assert.equal(before.mode & 0o777, 0o600); assert.equal(statSync(f.directory).mode & 0o777, 0o700);
        assert.equal((await f.acquire())._tag, 'Busy'); await Effect.runPromise(first.release()); await Effect.runPromise(first.release());
        const second = await f.acquire(); assert.equal(second._tag, 'Held'); if (second._tag !== 'Held') throw Error('owner');
        assert.equal(statSync(path).ino, before.ino); await Effect.runPromise(second.release());
    } finally { f.close(); }
});
for (const tamper of ['mode', 'marker', 'replacement', 'hardlink', 'symlink'] as const) {
    test(`RunLease refuses ${tamper} changes to its persistent protocol inode`, async () => {
        const f = fixture();
        try {
            const first = await f.acquire(); if (first._tag !== 'Held') throw Error('owner'); await Effect.runPromise(first.release());
            const path = join(f.directory, 'owner-v1.lock');
            if (tamper === 'mode') chmodSync(path, 0o644);
            if (tamper === 'marker') writeFileSync(path, 'untrusted');
            if (tamper === 'replacement') { const bytes = readFileSync(path); renameSync(path, path + '.old'); writeFileSync(path, bytes, { mode: 0o600 }); }
            if (tamper === 'hardlink') linkSync(path, path + '.other');
            if (tamper === 'symlink') { renameSync(path, path + '.old'); symlinkSync(path + '.old', path); }
            assert.equal((await f.acquire())._tag, 'Busy');
        } finally { f.close(); }
    });
}
