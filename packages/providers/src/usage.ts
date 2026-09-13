/** Absent accounting fields mean unknown, never zero. */
export interface ProviderUsageV1 {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly costUsd?: string;
  readonly priceScheduleRef?: string;
  readonly providerCounters: Readonly<Record<string, number | string>>;
}
