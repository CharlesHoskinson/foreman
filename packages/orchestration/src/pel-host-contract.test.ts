import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256Hex } from '@foreman/core';
import { decodeCandidateArtifactV1, decodeCandidateRefV1, decodeImplementationReceiptV1, decodeVerificationReceiptV1, decodeReviewReceiptV1, decodePublicationReceiptV1 } from './pel-host-contract.js';
import { pelHash, stablePelReservationId } from './pel-journal.js';

const ref = { artifactId: 'sha256-' + 'a'.repeat(64), byteLength: 2, sha256: 'a'.repeat(64) };
const attempt = { runId: 'host-contract', laneId: 'pel', attemptId: 1 };
const effectBase = { runId: attempt.runId, revisionDigest: 'c'.repeat(64), attempt, requestId: 'request', retryOrdinal: 0 };
const effect = { ...effectBase, effectId: `pel-${pelHash(effectBase)}` };
const identity = { kind: 'api', provider: 'openai', profileId: 'gpt-5.6-sol', transportId: 'openai-responses', credentialProfileRef: 'fixture', endpointRevision: 'v1', responseId: 'response' };
const candidate = { commit: 'b'.repeat(40), tree: 'c'.repeat(40), candidateSha256: sha256Hex('b'.repeat(40)) };
const reservation = { schemaVersion: 1, kind: 'v1', effect, preparationDigest: 'a'.repeat(64), operationDigest: 'b'.repeat(64), authoritySha256: 'c'.repeat(64), reservationId: stablePelReservationId(effect.effectId, 'verify', 'a'.repeat(64)), candidate, contractId: 'contract', contractSha256: 'd'.repeat(64), action: 'verify' };
const reserved = (action: 'implement' | 'verify' | 'audit' | 'publish') => ({ ...reservation, action, reservationId: stablePelReservationId(effect.effectId, action, reservation.preparationDigest) });
const verification = { schemaVersion: 1, kind: 'verification', effect, candidateRef: ref, candidate, gateId: 'candidate-full', gateDigest: 'a'.repeat(64), environmentDigest: 'b'.repeat(64), policyDigest: 'c'.repeat(64), passed: true, reportRef: ref, reservation, observedAt: 100 };
test('M5 candidate evidence rejects path escapes, incoherent deletions and forged content hashes', () => {
    const entry = { path: 'src/main.ts', change: 'present', mode: '100644', gitBlobOid: 'b'.repeat(40), contentSha256: ref.sha256, artifact: ref };
    assert.equal(decodeCandidateArtifactV1(entry).ok, true);
    for (const path of ['../secret', '/tmp/x', 'src/../x', '.git/config', 'src/.GIT/config']) assert.equal(decodeCandidateArtifactV1({ ...entry, path }).ok, false);
    assert.equal(decodeCandidateArtifactV1({ ...entry, contentSha256: 'f'.repeat(64) }).ok, false);
    assert.equal(decodeCandidateArtifactV1({ ...entry, change: 'deleted' }).ok, false);
    assert.equal(decodeCandidateArtifactV1({ path: entry.path, change: 'deleted', mode: null, gitBlobOid: null, contentSha256: null, artifact: null }).ok, true);
});
test('M5 candidate keeps commit identity separate from manifest and diff identity', () => {
    const value = { schemaVersion: 1, repository: { gitCommonDir: '/repo/.git', identitySha256: 'd'.repeat(64) }, workspaceGrantId: 'grant', baseCommit: 'a'.repeat(40), ...candidate, treeDigest: 'e'.repeat(64), diffDigest: ref.sha256, allowedPathsSha256: 'f'.repeat(64), artifactManifestSha256: ref.sha256, manifestRef: ref, diffRef: ref, producingAttempt: attempt, producingEffectId: effect.effectId };
    assert.equal(decodeCandidateRefV1(value).ok, true);
    for (const patch of [{ candidateSha256: ref.sha256 }, { diffDigest: 'b'.repeat(64) }, { artifactManifestSha256: 'b'.repeat(64) }, { approved: true }, { producingAttempt: { ...attempt, attemptId: 0 } }]) assert.equal(decodeCandidateRefV1({ ...value, ...patch }).ok, false);
});
test('M5 verification evidence binds its producing effect, candidate and stable reservation', () => {
    assert.equal(decodeVerificationReceiptV1(verification).ok, true);
    for (const patch of [{ effect: { ...effect, requestId: 'other' } }, { candidate: { ...candidate, commit: 'f'.repeat(40) } }, { passed: 'true' }, { reservation: { ...reservation, reservationId: 'forged' } }, { observedAt: Infinity }]) assert.equal(decodeVerificationReceiptV1({ ...verification, ...patch }).ok, false);
});
test('M5 observed same-vendor review cannot decode as authorizing approval', () => {
    const value = { schemaVersion: 1, kind: 'review', effect, candidateRef: ref, candidate, verificationRef: ref, implementer: { ...identity, provider: 'xai' }, reviewer: identity, policyId: 'independent-review', policyDigest: 'a'.repeat(64), verdict: 'approved', findings: [], reportRef: ref, reservation: reserved('audit'), observedAt: 100 };
    assert.equal(decodeReviewReceiptV1(value).ok, true);
    assert.equal(decodeReviewReceiptV1({ ...value, implementer: { ...identity, profileId: 'different-model' } }).ok, false);
    assert.equal(decodeReviewReceiptV1({ ...value, implementer: identity, verdict: 'unverified' }).ok, true);
    assert.equal(decodeReviewReceiptV1({ ...value, approved: true }).ok, false);
    assert.equal(decodeReviewReceiptV1({ ...value, reservation }).ok, false);
    assert.equal(decodeReviewReceiptV1({ ...value, findings: Array(2) }).ok, false);
    assert.equal(decodeReviewReceiptV1(Object.defineProperty({ ...value }, 'hiddenAuthority', { value: true })).ok, false);
});
test('M5 publication requires the observed exact object and reservation operation', () => {
    const value = { schemaVersion: 1, kind: 'publication', effect, candidateRef: ref, candidate, verificationRef: ref, reviewRef: ref, authorityRef: ref, destinationId: 'reviewed-branch', destinationDigest: 'a'.repeat(64), operationDigest: reservation.operationDigest, observedObject: candidate.commit, reportRef: ref, reservation: reserved('publish'), observedAt: 100 };
    assert.equal(decodePublicationReceiptV1(value).ok, true);
    assert.equal(decodePublicationReceiptV1({ ...value, observedObject: 'f'.repeat(40) }).ok, false);
    assert.equal(decodePublicationReceiptV1({ ...value, operationDigest: pelHash('other') }).ok, false);
    assert.equal(decodePublicationReceiptV1({ ...value, reservation }).ok, false);
});
test('M5 implementation evidence rejects credential material and unknown provenance fields', () => {
    const value = { schemaVersion: 1, kind: 'implementation', effect, candidateRef: ref, providerIdentity: identity, reportRef: ref, reservation: reserved('implement'), beforeManifestRef: ref, afterManifestRef: ref };
    assert.equal(decodeImplementationReceiptV1(value).ok, true);
    assert.equal(decodeImplementationReceiptV1({ ...value, providerIdentity: { ...identity, apiKey: 'secret' } }).ok, false);
    assert.equal(decodeImplementationReceiptV1({ ...value, trusted: true }).ok, false);
    assert.equal(decodeImplementationReceiptV1({ ...value, reservation }).ok, false);
});
