/** Decode registered project data before creating a run or reserving host work. */
import { isAbsolute, normalize } from 'node:path';
import { buildEffectiveAuthoringSnapshotV1, createAuthoringSnapshotV1, hashAuthoringContent, isCheckedProgramV1, type AuthoringSnapshotV1, type CheckedProgramV1, type Result } from '@foreman/pel';
import { decodeProviderControls } from '@foreman/providers';
import { decodeExecutionContractV1, executionContractSha256, isExecutionContractFailure, executionMilestones, type ExecutionContractV1 } from './execution-contract.js';
import { decodePelArtifactRefV1, decodePelAuthorityBindingV1, decodePelRepositoryIdentityV1,
  decodePelResultContractV1, decodePelRunLimitsV1, decodePelWorkspaceGrantV1,
  decodeExecutionBindingV1, type ExecutionBindingV1, type PelAuthorityBindingV1, type PelWorkspaceGrantV1,
  type ForemanProjectV1, type PelContractDecodeFailureV1 } from './pel-run-contract.js';

type Decoded<T> = Result<T, PelContractDecodeFailureV1>;
const bad = (fieldPath: string): Decoded<never> => ({ ok: false, error: { code: 'invalid-contract', fieldPath } });
function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = Object.getPrototypeOf(value);
  return (p === Object.prototype || p === null) && Reflect.ownKeys(value).every(k => typeof k === 'string' && 'value' in Object.getOwnPropertyDescriptor(value, k)!);
}
const exact = (v: Record<string, unknown>, required: readonly string[]) => required.length === Object.keys(v).length && required.every(k => Object.hasOwn(v, k));
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.isWellFormed() && Buffer.byteLength(v) <= 4096 && !/[\u0000-\u001f\u007f]/.test(v);
const path = (v: unknown): v is string => text(v) && isAbsolute(v) && normalize(v) === v;
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const oid = (v: unknown): v is string => typeof v === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v);
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const array = (v: unknown): v is unknown[] => Array.isArray(v) && v.length <= 10000 && Object.keys(v).length === v.length;
const strings = (v: unknown): v is string[] => array(v) && v.every(text) && new Set(v).size === v.length;
const map = (v: unknown): v is Record<string, unknown> => record(v) && Object.keys(v).length <= 1000 && Object.keys(v).every(text);
function selection(v: unknown, predicate = false): boolean {
  return record(v) && exact(v, ['profileId', 'transportId', 'controls', 'credentialProfileRef', ...(predicate ? ['outputSchemaId'] : [])]) &&
    text(v.profileId) && text(v.transportId) && text(v.credentialProfileRef) && decodeProviderControls(v.controls).ok &&
    (!predicate || v.outputSchemaId === 'schema:pel-boolean-v1');
}
export function decodeForemanProjectV1(value: unknown): Decoded<ForemanProjectV1> {
  const fields = ['schemaVersion', 'projectId', 'repository', 'stateRoot', 'authorityRefs', 'executionContractTemplate', 'authoringSnapshot', 'runtimeHandlerVersion', 'limits', 'requiredMilestones', 'workspaces', 'gates', 'destinations', 'roleBindings', 'taskActions', 'nlConditionProfile', 'dependencyMode', 'resultContract'];
  if (!record(value) || !exact(value, [...fields,...(Object.hasOwn(value,'researchBundles')?['researchBundles']:[])]) || value.schemaVersion !== 1 || !text(value.projectId) || !decodePelRepositoryIdentityV1(value.repository).ok || !path(value.stateRoot) || !text(value.runtimeHandlerVersion)) return bad('project');
  const repository = decodePelRepositoryIdentityV1(value.repository); if (!repository.ok) return repository;
  if (!array(value.authorityRefs) || !value.authorityRefs.length || !value.authorityRefs.every(a => decodePelAuthorityBindingV1(a).ok) || !decodePelArtifactRefV1(value.executionContractTemplate).ok || !decodePelArtifactRefV1(value.authoringSnapshot).ok) return bad('project.authority');
  const authorities = value.authorityRefs.map(a => hashAuthoringContent(a));
  if (new Set(authorities).size !== authorities.length) return bad('project.authority');
  const limits = decodePelRunLimitsV1(value.limits, true); if (!limits.ok) return limits;
  if (!strings(value.requiredMilestones) || !value.requiredMilestones.every(m => (executionMilestones as readonly string[]).includes(m))) return bad('project.requiredMilestones');
  const w = value.workspaces;
  if (!record(w) || !exact(w, ['poolRoot', 'immutableBase', 'grants', 'maxWorktrees', 'maxRaceContenders']) || !path(w.poolRoot) || !oid(w.immutableBase) || !positive(w.maxWorktrees) || w.maxWorktrees > 1000 || !positive(w.maxRaceContenders) || w.maxRaceContenders > w.maxWorktrees || !array(w.grants) || !w.grants.length || w.grants.length > w.maxWorktrees) return bad('project.workspaces');
  const grants = new Set<string>(), roots = new Set<string>();
  for (const grant of w.grants) {
    const g = decodePelWorkspaceGrantV1(grant);
    if (!g.ok || hashAuthoringContent(g.value.repository) !== hashAuthoringContent(repository.value) || g.value.immutableBase !== w.immutableBase || grants.has(g.value.grantId) || roots.has(g.value.canonicalRoot)) return bad('project.workspaces.grants');
    grants.add(g.value.grantId); roots.add(g.value.canonicalRoot);
  }
  if (!map(value.gates)) return bad('project.gates');
  for (const gate of Object.values(value.gates)) {
    if (!record(gate) || !exact(gate, ['argv', 'environmentRefs', 'environmentSha256', 'maxOutputBytes', 'timeoutMs']) || !array(gate.argv) || !gate.argv.length || !gate.argv.every(text) || !strings(gate.environmentRefs) || !digest(gate.environmentSha256) || !positive(gate.maxOutputBytes) || gate.maxOutputBytes > limits.value.maxOutputBytes || !positive(gate.timeoutMs) || gate.timeoutMs > limits.value.execution.wallTimeMs) return bad('project.gates');
  }
  if (!map(value.destinations)) return bad('project.destinations');
  for (const d of Object.values(value.destinations)) {
    if (!record(d) || !exact(d, ['operation', 'repositoryIdentitySha256', 'remoteIdentity', 'ref', 'expectedOldObject', 'authorityRef']) || !['integrate', 'publish'].includes(d.operation as string) || d.repositoryIdentitySha256 !== repository.value.identitySha256 || !text(d.remoteIdentity) || !text(d.ref) || !d.ref.startsWith('refs/') || !(d.authorityRef === null ? d.operation === 'publish' : decodePelArtifactRefV1(d.authorityRef).ok) || !record(d.expectedOldObject)) return bad('project.destinations');
    const old = d.expectedOldObject;
    if (!(old.kind === 'absent' && exact(old, ['kind'])) && !(old.kind === 'exact' && exact(old, ['kind', 'oid']) && oid(old.oid))) return bad('project.destinations.expectedOldObject');
  }
  if(value.researchBundles!==undefined&&(!map(value.researchBundles)||Object.keys(value.researchBundles).length>64||!Object.entries(value.researchBundles).every(([id,ref])=>{const decoded=decodePelArtifactRefV1(ref);return /^bundle:[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id)&&Buffer.byteLength(id)<=256&&decoded.ok&&decoded.value.artifactId===`sha256-${decoded.value.sha256}`&&decoded.value.byteLength<=1048576;})))return bad('project.researchBundles');
  if (!map(value.roleBindings) || !Object.entries(value.roleBindings).every(([key, v]) => key.startsWith('role:') && selection(v)) || !map(value.taskActions) || !Object.values(value.taskActions).every(a => a === 'implement' || a === 'correct')) return bad('project.roles');
  if ((value.nlConditionProfile !== null && !selection(value.nlConditionProfile, true)) || !['ordered', 'automatic'].includes(value.dependencyMode as string) || !decodePelResultContractV1(value.resultContract).ok) return bad('project.options');
  return { ok: true, value: structuredClone(value) as unknown as ForemanProjectV1 };
}

/** The same effective builder serves check, plan, fresh execution and recovery. */
export function configurePelSnapshot(base: AuthoringSnapshotV1, project: ForemanProjectV1): Decoded<AuthoringSnapshotV1> {
  const valid = decodeForemanProjectV1(project); if (!valid.ok) return valid;
  const schema = base.registry.dataSchemas[project.resultContract.schemaId];
  if (!schema || hashAuthoringContent(schema) !== project.resultContract.schemaSha256) return bad('project.resultContract');
  // A configured project's role map replaces authoring defaults. Its admission policy stays fixed.
  const selectedBase = createAuthoringSnapshotV1({...base, roleBindings: {}});
  if (!selectedBase.ok) return bad('project.snapshot');
  const configured = buildEffectiveAuthoringSnapshotV1(selectedBase.value, {
    roleBindings: project.roleBindings, nlConditionProfile: project.nlConditionProfile,
    dependencyMode: project.dependencyMode, resultContract: project.resultContract.schemaId,
    narrowingLimits: project.limits.pel,
    narrowingBudgets: { maxEffects: base.policy.maxEffects, maxElapsedMs: Math.min(base.policy.maxElapsedMs, project.limits.execution.wallTimeMs) },
  });
  return configured.ok ? configured : bad('project.selection');
}

/** Facts resolved from existing ledger and host registrations, never from model output. */
export interface PelValidatedAuthorityV1 {
  readonly binding: PelAuthorityBindingV1;
  readonly contract: ExecutionContractV1;
  readonly executionDeadline: number;
  readonly workspaceGrants: readonly PelWorkspaceGrantV1[];
  readonly allowedTaskActions: ForemanProjectV1['taskActions'];
  readonly availableHandlers: ReadonlySet<string>;
}
export interface PelRunIdentityV1 {
  readonly attempt: ExecutionBindingV1['attempt'];
  readonly evidenceKind: ExecutionBindingV1['evidenceKind'];
  readonly runtimeVersion: string;
  readonly ownerLeaseRef: string;
  readonly artifacts: ExecutionBindingV1['artifacts'];
}
/** Reuse the original execution contract. Run limits can only narrow its allowance. */
export function deriveExecutionBinding(project: ForemanProjectV1, checked: CheckedProgramV1, authority: PelValidatedAuthorityV1, identity: PelRunIdentityV1, now: number): Decoded<{ binding: ExecutionBindingV1; contract: ExecutionContractV1 }> {
  const valid = decodeForemanProjectV1(project); if (!valid.ok) return valid;
  const contract = decodeExecutionContractV1(authority.contract);
  if (isExecutionContractFailure(contract) || !isCheckedProgramV1(checked) || !Number.isSafeInteger(now) || !Number.isSafeInteger(authority.executionDeadline) || authority.executionDeadline > Date.parse(contract.deadlineAt) || now < Date.parse(contract.createdAt) || now >= authority.executionDeadline) return bad('admission.contract');
  if (!project.authorityRefs.some(ref => hashAuthoringContent(ref) === hashAuthoringContent(authority.binding)) || contract.authorizationSha256 !== authority.binding.authoritySha256 || contract.baseCommit !== project.workspaces.immutableBase) return bad('admission.authority');
  for (const key of Object.keys(contract.limits) as (keyof ExecutionContractV1['limits'])[]) if (project.limits.execution[key] > contract.limits[key]) return bad(`admission.limits.${key}`);
  if (!contract.requiredMilestones.every(m => project.requiredMilestones.includes(m))) return bad('admission.requiredMilestones');
  for (const grant of project.workspaces.grants) {
    const original = authority.workspaceGrants.find(g => g.grantId === grant.grantId);
    if (!original || hashAuthoringContent({...grant, writablePaths: []}) !== hashAuthoringContent({...original, writablePaths: []}) || !grant.writablePaths.every(p => original.writablePaths.includes(p))) return bad('admission.workspaces');
  }
  if (!Object.entries(project.taskActions).every(([id, action]) => authority.allowedTaskActions[id] === action)) return bad('admission.taskActions');
  const effective = configurePelSnapshot(checked.snapshot, project);
  if (!effective.ok || effective.value.snapshotDigest !== checked.snapshot.snapshotDigest) return bad('admission.snapshot');
  const reachable = new Set([...checked.analysis.effects.map(e => e.registryId), ...checked.analysis.dynamicRegions.flatMap(r => r.possibleRegistryIds)]);
  for (const handler of reachable) if (!authority.availableHandlers.has(handler)) return bad(`admission.handler.${handler}`);
  const refs = identity.artifacts;
  if (refs.source.sha256 !== checked.sourceDigest || refs.source.byteLength !== checked.source.byteLength || refs.snapshot.sha256 !== hashAuthoringContent(checked.snapshot) || refs.registry.sha256 !== hashAuthoringContent(checked.snapshot.registry) || refs.configuration.sha256 !== hashAuthoringContent(project)) return bad('admission.artifacts');
  const binding: ExecutionBindingV1 = {
    schemaVersion: 1, evidenceKind: identity.evidenceKind, runId: identity.attempt.runId, attempt: identity.attempt,
    contractId: contract.contractId, contractSha256: executionContractSha256(contract), authority: authority.binding,
    authoritySha256: authority.binding.authoritySha256, checkedProgramDigest: checked.bindingDigest,
    revisionDigest: checked.sourceDigest, sourceDigest: checked.sourceDigest, snapshotDigest: checked.snapshot.snapshotDigest,
    registryDigest: checked.snapshot.registryDigest, configurationDigest: hashAuthoringContent(project),
    runtimeVersion: identity.runtimeVersion, languageProfileId: checked.languageProfile.id,
    languageProfileDigest: checked.languageProfile.digest, runtimeHandlerVersion: project.runtimeHandlerVersion,
    stateRoot: project.stateRoot, ownerLeaseRef: identity.ownerLeaseRef, repository: project.repository,
    artifacts: refs, options: checked.snapshot.options, optionsDigest: checked.optionsDigest,
    resultContract: project.resultContract, limits: {...project.limits, deadline: Math.min(authority.executionDeadline, now + project.limits.execution.wallTimeMs)},
    requiredMilestones: project.requiredMilestones,
  };
  const decoded = decodeExecutionBindingV1(binding);
  return decoded.ok ? {ok: true, value: {binding: decoded.value, contract}} : decoded;
}
