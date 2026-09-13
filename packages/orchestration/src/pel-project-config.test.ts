import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashAuthoringContent, checkPel, canonicalAuthoringJson } from '@foreman/pel';
import { createDefaultAuthoringSnapshotV1 } from './pel-host-descriptors.js';
import { strictEndstopLimits } from './execution-contract.js';
import { decodePelProjectAuthorityV1 } from './pel-project-authority.js';
import { decodeForemanProjectV1, configurePelSnapshot, deriveExecutionBinding } from './pel-project-config.js';
import type { AttemptIdentity } from '@foreman/event-log';

export function projectFixture() {
  const snapshot = createDefaultAuthoringSnapshotV1();
  const repository = { gitCommonDir: '/tmp/repository/.git', identitySha256: 'a'.repeat(64) };
  const ref = { artifactId: 'input-1', byteLength: 2, sha256: 'a'.repeat(64) };
  return {
    schemaVersion: 1, projectId: 'project-1', repository, stateRoot: '/tmp/state',
    authorityRefs: [{ kind: 'v1', authoritySha256: ref.sha256, authorityRef: ref }],
    executionContractTemplate: ref, authoringSnapshot: ref, runtimeHandlerVersion: '1',
    limits: { execution: strictEndstopLimits, pel: snapshot.limits, maxConcurrentEffects: 2,
      maxInputTokens: 1000, maxOutputTokens: 1000, maxToolCalls: 0, maxOutputBytes: 65536,
      maxCostUsd: 1, cancellationObservationMs: 100, maxReplayReductions: 100000 },
    requiredMilestones: [], workspaces: { poolRoot: '/tmp/pool', immutableBase: 'a'.repeat(40),
      maxWorktrees: 2, maxRaceContenders: 2, grants: [{ grantId: 'workspace-1', repository,
        worktreeId: 'worktree-1', canonicalRoot: '/tmp/pool/worktree-1', directoryIdentity: '1:2',
        immutableBase: 'a'.repeat(40), writablePaths: ['src'] }] },
    gates: {}, destinations: {}, roleBindings: {}, taskActions: {}, nlConditionProfile: null,
    dependencyMode: 'ordered', resultContract: { schemaId: 'schema:pel-data-v1',
      schemaSha256: hashAuthoringContent(snapshot.registry.dataSchemas['schema:pel-data-v1']), classification: 'generic' },
  };
}
test('T-M4-001 configuration rejects unknown fields, foreign grants and unbounded dispatch', () => {
  const p = projectFixture();
  assert.equal(decodeForemanProjectV1(p).ok, true);
  for (const invalid of [ { ...p, deadline: 1 }, { ...p, limits: { ...p.limits, maxCostUsd: Infinity } },
    { ...p, workspaces: { ...p.workspaces, grants: [{ ...p.workspaces.grants[0], repository: { ...p.repository, identitySha256: 'b'.repeat(64) } }] } },
    { ...p, workspaces: { ...p.workspaces, maxRaceContenders: 3 } },
    { ...p, taskActions: { work: 'publish' } }, { ...p, stateRoot: '/tmp/../etc' } ]) {
    assert.equal(decodeForemanProjectV1(invalid).ok, false);
  }
});
test('publication scope can defer candidate authority while preserving its exact destination', () => {
  const p = projectFixture();
  const destination = { operation: 'publish', repositoryIdentitySha256: p.repository.identitySha256, remoteIdentity: '/tmp/remote.git', ref: 'refs/heads/reviewed', expectedOldObject: { kind: 'absent' }, authorityRef: null };
  const config = { ...p, destinations: { reviewed: destination } };
  const scope = { schemaVersion: 1, repository: p.repository, stateRoot: p.stateRoot, workspaceGrants: p.workspaces.grants, taskActions: {}, gates: {}, destinations: config.destinations };
  assert.equal(decodeForemanProjectV1(config).ok, true);
  assert.equal(decodePelProjectAuthorityV1(scope).ok, true);
  for (const patch of [{ authorityRef: undefined }, { authorityRef: {} }, { operation: 'integrate' }, { ref: 'unqualified-ref' }, { repositoryIdentitySha256: 'b'.repeat(64) }]) {
    const destinations = { reviewed: { ...destination, ...patch } };
    assert.equal(decodeForemanProjectV1({ ...config, destinations }).ok, false);
    assert.equal(decodePelProjectAuthorityV1({ ...scope, destinations }).ok, false);
  }
});
test('T-M4-001 binding requires registered authority, unchanged checked context and reachable handlers', () => {
  const decoded = decodeForemanProjectV1(projectFixture()); if (!decoded.ok) throw Error('project');
  const p = {...decoded.value, requiredMilestones: ['checks' as const]}, configured = configurePelSnapshot(createDefaultAuthoringSnapshotV1(), p); if (!configured.ok) throw Error('snapshot');
  const checked = checkPel({source: Buffer.from('(fm/checkpoint :name "saved")'), snapshot: configured.value}); if (checked.tag !== 'ok') throw Error('check');
  const contract = { schemaVersion: 1 as const, contractId: 'contract-1', packageId: 'package-1', objectiveSha256: 'a'.repeat(64), acceptanceSha256: 'a'.repeat(64), baseCommit: p.workspaces.immutableBase, allowedPathsSha256: 'a'.repeat(64), dependencyContractIds: [], authorizationSha256: 'a'.repeat(64), createdAt: '2026-01-01T00:00:00Z', deadlineAt: '2026-01-01T02:00:00Z', limits: strictEndstopLimits, requiredMilestones: ['checks' as const] };
  const artifact = (v: unknown) => ({ artifactId: 'input', byteLength: Buffer.byteLength(canonicalAuthoringJson(v)), sha256: hashAuthoringContent(v) });
  const identity = { attempt: {runId: 'run-1', laneId: 'pel', attemptId: 1} as AttemptIdentity,
    evidenceKind: 'test-fixture' as const, runtimeVersion: '1', ownerLeaseRef: 'lease:run-1',
    artifacts: {source: {artifactId: 'source', byteLength: checked.checked.source.length, sha256: checked.checked.sourceDigest}, snapshot: artifact(checked.checked.snapshot), registry: artifact(checked.checked.snapshot.registry), configuration: artifact(p)} };
  const authority = { binding: p.authorityRefs[0]!, contract, executionDeadline:Date.parse(contract.deadlineAt), workspaceGrants: p.workspaces.grants, allowedTaskActions: {}, availableHandlers: new Set(['fm/checkpoint']) };
  const now = Date.parse('2026-01-01T00:00:00Z');
  const admitted = deriveExecutionBinding(p, checked.checked, authority, identity, now);
  assert.equal(admitted.ok, true, JSON.stringify(admitted));
  assert.equal(deriveExecutionBinding(p, checked.checked, {...authority, availableHandlers: new Set()}, identity, now).ok, false);
  assert.equal(deriveExecutionBinding(p, checked.checked, {...authority, workspaceGrants: []}, identity, now).ok, false);
  assert.equal(deriveExecutionBinding(p, checked.checked, authority, {...identity, artifacts: {...identity.artifacts, source: {...identity.artifacts.source, sha256: 'b'.repeat(64)}}}, now).ok, false);
  assert.equal(deriveExecutionBinding(p, checked.checked, authority, identity, now + strictEndstopLimits.wallTimeMs).ok, false);
});
test('T-M4-001 check and run share effective configuration and reject expanded limits or schemas', () => {
  const decoded = decodeForemanProjectV1(projectFixture());
  assert.equal(decoded.ok, true); if (!decoded.ok) return;
  const base = createDefaultAuthoringSnapshotV1();
  const effective = configurePelSnapshot(base, decoded.value);
  assert.equal(effective.ok, true);
  if (effective.ok) assert.deepEqual(effective.value.roleBindings, {});
  assert.equal(configurePelSnapshot(base, { ...decoded.value, resultContract: { ...decoded.value.resultContract, schemaSha256: 'b'.repeat(64) } }).ok, false);
  assert.equal(configurePelSnapshot(base, { ...decoded.value, limits: { ...decoded.value.limits, pel: { ...base.limits, maxReductions: base.limits.maxReductions + 1 } } }).ok, false);
});
test('M6 research index bindings are optional and reject paths, duplicate metadata, and unknown fields',()=>{const p=projectFixture(),ref={artifactId:'sha256-'+ 'b'.repeat(64),sha256:'b'.repeat(64),byteLength:100};assert.equal(decodeForemanProjectV1({...p,researchBundles:{'bundle:release-sources':ref}}).ok,true);for(const researchBundles of [{'/tmp/source':ref},{'bundle:release-sources':{...ref,readRoots:[]}},{'bundle:release-sources':{...ref,sha256:'changed'}}])assert.equal(decodeForemanProjectV1({...p,researchBundles}).ok,false);});

test('M6 plan effect bounds remain independent from paid ledger actions',()=>{
 const p=projectFixture(),limits={...p.limits.execution,totalActions:6},decoded=decodeForemanProjectV1({...p,limits:{...p.limits,execution:limits}});assert.ok(decoded.ok);if(!decoded.ok)return;
 const base=createDefaultAuthoringSnapshotV1(),configured=configurePelSnapshot(base,decoded.value);assert.ok(configured.ok);if(!configured.ok)return;
 const checked=checkPel({source:Buffer.from('(do '+Array.from({length:7},(_,i)=>`(fm/checkpoint :name "checkpoint-${i}")`).join(' ')+')'),snapshot:configured.value});
 assert.equal(checked.tag,'ok');assert.equal(configured.value.policy.maxEffects,base.policy.maxEffects);assert.equal(decoded.value.limits.execution.totalActions,6);
});
