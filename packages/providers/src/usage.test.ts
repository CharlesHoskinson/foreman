import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeUsage, checkUsageLimits } from './usage.js';
test('T-M3-020 preserves dated dimensions and unknown costs, bounds stop work', () => {
    const usage = normalizeUsage({ inputTokens: 20, outputTokens: 4, cachedReadTokens: 2, cacheWriteTokens: 3, priceScheduleRef: 'sol-2026-09-13', priceSchedule: { effectiveDate: '2026-09-13', tier: 'standard', currency: 'USD', longContextThreshold: 272000 }, providerCounters: { cacheStorageTokenHours: 8 } });
    assert.equal(usage.ok, true);
    if (!usage.ok)
        return;
    assert.equal(usage.value.costUsd, undefined);
    assert.equal(usage.value.priceSchedule?.effectiveDate, '2026-09-13');
    assert.equal(usage.value.providerCounters.cacheStorageTokenHours, 8);
    const limits = { deadline: 100, maxInputTokens: 20, maxOutputTokens: 10, maxToolCalls: 2 };
    assert.equal(checkUsageLimits(usage.value, limits, { now: 1, toolCalls: 0 }).ok, false);
    assert.equal(checkUsageLimits({ providerCounters: {} }, limits, { now: 100, toolCalls: 0 }).ok, false);
    assert.equal(checkUsageLimits({ providerCounters: {} }, limits, { now: 1, toolCalls: 2 }).ok, false);
    assert.equal(normalizeUsage({ inputTokens: -1, providerCounters: {} }).ok, false);
    assert.equal(normalizeUsage({ costUsd: 'NaN', providerCounters: {} }).ok, false);
});
