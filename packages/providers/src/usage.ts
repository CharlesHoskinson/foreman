/** Absent accounting fields mean unknown, never zero. */
export interface ProviderUsageV1 {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cachedReadTokens?: number;
    readonly cacheWriteTokens?: number;
    readonly costUsd?: string;
    readonly priceScheduleRef?: string;
    readonly priceSchedule?: PriceScheduleV1;
    readonly providerCounters: Readonly<Record<string, number | string>>;
}
export interface PriceScheduleV1 {
    readonly effectiveDate: string;
    readonly tier: string;
    readonly currency: 'USD';
    readonly longContextThreshold?: number;
    readonly cacheReadRateRef?: string;
    readonly cacheWriteRateRef?: string;
}
import type { Result } from '@foreman/pel';
import type { ProviderFailure } from './errors.js';
export function normalizeUsage(input: ProviderUsageV1): Result<ProviderUsageV1, ProviderFailure> {
    const fail = (fieldPath: string): Result<never, ProviderFailure> => ({ ok: false, error: { _tag: 'MalformedEvent', retryClass: 'never', message: `Invalid accounting dimension at ${fieldPath}`, fieldPath } });
    for (const key of ['inputTokens', 'outputTokens', 'cachedReadTokens', 'cacheWriteTokens'] as const) {
        const v = input[key];
        if (v !== undefined && (!Number.isSafeInteger(v) || v < 0))
            return fail(`usage.${key}`);
    }
    if (input.costUsd !== undefined && (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input.costUsd) || !Number.isFinite(Number(input.costUsd))))
        return fail('usage.costUsd');
    for (const [key, value] of Object.entries(input.providerCounters))
        if (typeof value === 'number' && (!Number.isFinite(value) || value < 0))
            return fail(`usage.providerCounters.${key}`);
    if (input.priceSchedule && (!/^\d{4}-\d{2}-\d{2}$/.test(input.priceSchedule.effectiveDate) || !input.priceSchedule.tier || input.priceSchedule.currency !== 'USD' || (input.priceSchedule.longContextThreshold !== undefined && (!Number.isSafeInteger(input.priceSchedule.longContextThreshold) || input.priceSchedule.longContextThreshold < 0))))
        return fail('usage.priceSchedule');
    return { ok: true, value: structuredClone(input) };
}
/** This pure observation does not reserve funds, retry, or own the host deadline. */
export function checkUsageLimits(usage: ProviderUsageV1, limits: {
    readonly deadline: number;
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly maxToolCalls: number;
    readonly maxCostUsd?: string;
}, observed: {
    readonly now: number;
    readonly toolCalls: number;
}): Result<void, ProviderFailure> {
    const field = observed.now >= limits.deadline ? 'deadline' : (usage.inputTokens !== undefined && usage.inputTokens >= limits.maxInputTokens) ? 'maxInputTokens' : (usage.outputTokens !== undefined && usage.outputTokens >= limits.maxOutputTokens) ? 'maxOutputTokens' : observed.toolCalls >= limits.maxToolCalls ? 'maxToolCalls' : usage.costUsd !== undefined && limits.maxCostUsd !== undefined && Number(usage.costUsd) >= Number(limits.maxCostUsd) ? 'maxCostUsd' : undefined;
    return field ? { ok: false, error: { _tag: 'OutputIncomplete', retryClass: 'never', message: `Admitted provider limit exhausted: ${field}`, fieldPath: `limits.${field}`, usage } } : { ok: true, value: undefined };
}
