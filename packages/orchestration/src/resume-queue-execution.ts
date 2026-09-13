/** Existing owner routing. Legacy plans remain readable but cannot dispatch. */
import { Effect, type Scope } from 'effect';
import type { RunId } from '@foreman/event-log';
import type { RoundPlanV1 } from './round-contract.js';
import type { PelOwnedRunContextV1, RunFailure, RunResultV1 } from './pel-run-contract.js';
import { pelFailure } from './pel-journal.js';

export interface ActiveLegacyRun {
 readonly code: 'ActiveLegacyRun';
 readonly exitCode: 3;
 readonly runId: RunId;
 readonly originalController: 'unavailable';
 readonly message: string;
}
export function activeLegacyRun(runId: RunId): ActiveLegacyRun {
 return {code:'ActiveLegacyRun',exitCode:3,runId,originalController:'unavailable',
 message:'This runtime cannot dispatch legacy rounds. Retain the original controller and run state. The recorded history does not identify a verified original controller executable.'};
}
export interface RunResumeQueueExecutionInput { readonly plan: RoundPlanV1 }
export interface PelResumeQueueExecutionInput {
 readonly kind: 'pel'; readonly runId: RunId;
 readonly owner: PelOwnedRunContextV1['owner'];
 readonly resume: (owner:PelOwnedRunContextV1['owner']) => Effect.Effect<RunResultV1,RunFailure,Scope.Scope>;
}
export function runResumeQueueExecution(input:PelResumeQueueExecutionInput):Effect.Effect<RunResultV1,RunFailure,Scope.Scope>;
export function runResumeQueueExecution(input:RunResumeQueueExecutionInput):Effect.Effect<never,ActiveLegacyRun>;
export function runResumeQueueExecution(input:PelResumeQueueExecutionInput|RunResumeQueueExecutionInput):Effect.Effect<RunResultV1,RunFailure|ActiveLegacyRun,Scope.Scope> {
 if ('kind' in input) return input.owner.runId===input.runId ? input.resume(input.owner) : Effect.fail(pelFailure('owner-busy','Pel recovery requires the already-held owner.'));
 return Effect.fail(activeLegacyRun(input.plan.runId));
}
