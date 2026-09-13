/** Derive candidate ownership from existing immutable child records and race decisions. */
import { Effect } from 'effect';
import type { PelDataValue } from '@foreman/pel';
import type { HostContextV1, PelChildStateV1 } from './pel-run-contract.js';
import { readPelRecords, replayPelRun, decodePelChildStateV1, decodePelRaceDecisionV1, pelFailure, pelHash } from './pel-journal.js';
import { readPelArtifactJson } from './pel-recovery.js';
import { pelHostField } from './pel-host-evidence.js';

export function readPelCandidateScopes(context: HostContextV1) {
    return Effect.gen(function* () {
        const replay = replayPelRun(yield* readPelRecords(context.binding.runId));
        if (!replay.ok) return yield* Effect.fail(replay.error);
        const children = new Map<string, PelChildStateV1>(), owners = new Map<string, string>(), winners = new Map<string, number>();
        for (const record of replay.value.records) {
            if (record.type === 'pel.child-suspension.v1') {
                const decoded = decodePelChildStateV1(yield* readPelArtifactJson(context.binding.runId, record.data.childRef));
                if (!decoded.ok) return yield* Effect.fail(decoded.error);
                const child = decoded.value, previous = children.get(child.childInvocationId);
                if (previous && (pelHash(previous.workspaceGrant) !== pelHash(child.workspaceGrant) || previous.parentRequestId !== child.parentRequestId || previous.childKind !== child.childKind || previous.index !== child.index)) return yield* Effect.fail(pelFailure('journal-corrupt', 'The durable candidate child identity changed.'));
                children.set(child.childInvocationId, child);
                for (const pending of child.pending) {
                    const prior = owners.get(pending.effect.requestId);
                    if (prior && prior !== child.childInvocationId) return yield* Effect.fail(pelFailure('journal-corrupt', 'A request has competing durable child owners.'));
                    owners.set(pending.effect.requestId, child.childInvocationId);
                }
            } else if (record.type === 'pel.race.decision.v1') {
                const decoded = decodePelRaceDecisionV1(yield* readPelArtifactJson(context.binding.runId, record.data.decisionRef));
                if (!decoded.ok) return yield* Effect.fail(decoded.error);
                const prior = winners.get(decoded.value.parentRequestId);
                if (prior !== undefined && prior !== decoded.value.winnerIndex) return yield* Effect.fail(pelFailure('journal-corrupt', 'A durable race selected competing winners.'));
                winners.set(decoded.value.parentRequestId, decoded.value.winnerIndex);
            }
        }
        const lineage = (childId: string | undefined) => {
            const result: PelChildStateV1[] = [], seen = new Set<string>();
            while (childId) {
                const child = children.get(childId);
                if (!child || seen.has(childId)) return null;
                seen.add(childId); result.push(child); childId = owners.get(child.parentRequestId);
            }
            return result;
        };
        return { children, owners, winners, lineage };
    });
}
/** A nested race result retains its selected ordinary value. */
export function pelCandidateDelivery(value: PelDataValue): PelDataValue | null {
    for (let depth = 0; depth < 16; depth++) {
        if (pelHostField(value, 'candidate')?.tag === 'string') return value;
        const winner = pelHostField(value, 'winner-index'), next = pelHostField(value, 'value'), losers = pelHostField(value, 'losers');
        if (winner?.tag !== 'number' || !next || losers?.tag !== 'list') return null;
        value = next;
    }
    return null;
}

/** Divide the original allocation at each enclosing race. Atomic admission still caps the run. */
export function pelTaskRaceBudget(context: HostContextV1) {
    return Effect.gen(function* () {
        const scopes = yield* readPelCandidateScopes(context), lineage = scopes.lineage(context.childInvocationId);
        if (!lineage) return yield* Effect.fail(pelFailure('binding-mismatch', 'The task race allocation has no durable ancestry.'));
        let divisor = 1;
        for (const child of lineage) if (child.childKind === 'race') {
            const count = [...scopes.children.values()].filter(sibling => sibling.parentRequestId === child.parentRequestId && sibling.childKind === 'race').length;
            if (count < 1 || count > context.project.workspaces.maxRaceContenders || !Number.isSafeInteger(divisor * count)) return yield* Effect.fail(pelFailure('binding-mismatch', 'The durable race allocation is invalid.'));
            divisor *= count;
        }
        const limits = context.binding.limits;
        let cost = limits.maxCostUsd / divisor;
        if (divisor > 1 && cost > 0) { const bits = new DataView(new ArrayBuffer(8)); bits.setFloat64(0, cost); bits.setBigUint64(0, bits.getBigUint64(0) - 1n); cost = bits.getFloat64(0); }
        return { maxInputTokens: Math.floor(limits.maxInputTokens / divisor), maxOutputTokens: Math.floor(limits.maxOutputTokens / divisor), maxCostUsd: cost };
    });
}
