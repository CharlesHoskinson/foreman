import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Effect, Either } from 'effect';
import { readFileSync } from 'node:fs';
import { decodeRoundPlanV1 } from './round-contract.js';
import { runResumeQueueExecution } from './resume-queue-execution.js';

test('legacy RoundPlan dispatch refuses before requesting any mutable service', async () => {
 const decoded = decodeRoundPlanV1(JSON.parse(readFileSync(new URL('./fixtures/pel-migration/implement-verify-review/round-v1.json', import.meta.url),'utf8')));
 assert.ok('runId' in decoded); if (!('runId' in decoded)) return;
 const result = await Effect.runPromise(Effect.either(runResumeQueueExecution({plan:decoded})));
 assert.ok(Either.isLeft(result));
 assert.equal(result.left.code, 'ActiveLegacyRun');
 assert.equal(result.left.originalController, 'unavailable');
 assert.match(result.left.message, /original controller/);
});
