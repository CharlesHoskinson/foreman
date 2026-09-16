# OpenBao deployment policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans after Task 0 acceptance. Follow the current task authority.

**Goal:** Validate declared production deployment policy without host or service effects.

**Architecture:** One pure TypeScript validator returns a closed result. Observed readiness remains a separate task.

**Tech Stack:** Node.js 24, strict TypeScript, node:test, existing tsx test loader.

## Global Constraints

- WSL and Linux are both production targets.
- OpenBao is the sole durable authority for managed credentials and lifecycle state.
- Keep credential material out of PEL, model prompts, logs, receipts, command arguments, and the Obsidian vault.
- Preserve concurrent native-login changes. Coordinate ownership before editing shared files.
- Do not install services, interrupt hosts, import accounts, refresh tokens, revoke accounts, or publish during planning.
- Do not make commits without separate authorization.
- No new dependencies, environment reads, filesystem calls, subprocesses, network calls, token acquisition, or installed runtime writes.

## Task 1A: Pure deployment policy

**Files:** Create only `packages/orchestration/src/openbao-deployment.ts` and `packages/orchestration/src/openbao-deployment.test.ts`.

**Interfaces:** Export `DeploymentPolicy`, `PolicyFailure`, `PolicyResult`, and `validateDeploymentPolicy(input: unknown): PolicyResult`.
Copy their exact declarations from the Deployment policy and readiness section of the production contracts.
Consume no other product module. Later readiness code consumes this validator but must independently observe host and backend facts.

- [ ] Add this failing contract test to the named test file.

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeploymentPolicy } from './openbao-deployment.js';
const valid = {
  platform: 'wsl', devMode: false, endpoint: 'https://bao.example',
  caSha256: 'a'.repeat(64), storageClass: 'linux-local', init: 'systemd',
  bootstrapOutsideBao: true, distinctRoles: true, serviceOwner: 'service-operator',
  startupOwner: 'host-operator', startupPolicy: 'approved host startup procedure',
  unsealOwner: 'unseal-operator', backupCustodian: 'backup-operator',
  backupDestinationClass: 'protected-off-host', recoveryOwner: 'recovery-operator',
  recoveryTimeObjectiveSeconds: 600, recoveryPointObjectiveSeconds: 60,
} as const;
test('valid policy is not readiness', () => {
  assert.deepEqual(validateDeploymentPolicy(valid), { status: 'valid-policy', platform: 'wsl' });
  assert.deepEqual(validateDeploymentPolicy({ ...valid, platform: 'linux' }), { status: 'valid-policy', platform: 'linux' });
});
test('unsafe policy refuses without echoing inputs', () => {
  assert.deepEqual(validateDeploymentPolicy({ ...valid, devMode: true }), { status: 'refused', code: 'UnsafeConfiguration' });
});
test('operator objectives are required', () => {
  const { recoveryTimeObjectiveSeconds: omitted, ...missing } = valid;
  assert.deepEqual(validateDeploymentPolicy(missing), { status: 'refused', code: 'MissingOperatorInput' });
});
```

- [ ] Run `node --import tsx --test packages/orchestration/src/openbao-deployment.test.ts`.
  Require failure from the absent module or missing function, not unrelated environment failure.
- [ ] Implement the exact contract with ordinary TypeScript functions.
  Return only the declared fields. Copy the platform value into the successful result.
  Reject arrays, null, extra fields, wrong types, invalid enums, noncanonical HTTPS origins, and invalid digest strings.
  Validate supplied fields before testing absence. Treat absent operator fields as `MissingOperatorInput`.
  Treat missing non-operator fields as `InvalidConfiguration`. Treat empty operator strings as `MissingOperatorInput`.
  Treat supplied malformed operator strings and invalid numeric objectives as `InvalidConfiguration`.
  Enforce the remaining safety predicates only after shape and operator checks.
- [ ] Expand table-driven tests for each field and boundary.
  Cover both platforms, all unsafe enum values, bootstrap cycles, shared roles, empty owners, omitted objectives, zero RTO, and negative RPO.
  Cover maximum safe integers, overflow, NaN, Infinity, credential-bearing URLs, URL paths, whitespace, uppercase digest, and unknown canary fields.
  Confirm input immutability using frozen input and repeated calls.
  Cover getters that throw, revoked proxies, symbol fields, prototype inheritance, whitespace-only owners, and edge spaces.
  Require closed `InvalidConfiguration` for hostile object access. Never include the thrown canary in output.
  Assert exact failure objects and no serialization of canary strings.
  A valid declaration must never produce a readiness or authentication claim.
- [ ] Run the focused test command and `npm run typecheck`.
- [ ] Run `git diff --check -- packages/orchestration/src/openbao-deployment.ts packages/orchestration/src/openbao-deployment.test.ts`.
- [ ] Report changed paths, initial failure, final test evidence, and limitations in `.superpowers/sdd/production-task-1a-report.md`.

## Acceptance and handoff

Independent review must compare every safety predicate with a failing negative control.
No policy test qualifies a real host, service, effective ACL, CA, or backup.
Operator identities and recovery objectives remain required live inputs. Synthetic fixture values do not select actual operators or objectives.
Task 1B requires observed platform and service evidence plus scheduled host interruption authority.
Do not run the root build because it overwrites concurrently owned runtime output.
