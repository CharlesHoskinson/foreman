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

const refused = (code: 'InvalidConfiguration' | 'MissingOperatorInput' | 'UnsafeConfiguration') =>
  ({ status: 'refused', code }) as const;

const operatorStrings = [
  'serviceOwner', 'startupOwner', 'startupPolicy', 'unsealOwner',
  'backupCustodian', 'recoveryOwner',
] as const;

const allFields = Object.keys(valid) as Array<keyof typeof valid>;
const operatorFields = new Set<string>([
  ...operatorStrings, 'recoveryTimeObjectiveSeconds', 'recoveryPointObjectiveSeconds',
]);

test('every missing field is classified by whether it requires operator input', () => {
  for (const field of allFields) {
    const candidate: Record<string, unknown> = { ...valid };
    delete candidate[field];
    assert.deepEqual(
      validateDeploymentPolicy(candidate),
      refused(operatorFields.has(field) ? 'MissingOperatorInput' : 'InvalidConfiguration'),
      field,
    );
  }
});

test('missing required shape takes precedence over missing operator input', () => {
  const candidate: Record<string, unknown> = { ...valid };
  delete candidate.platform;
  delete candidate.serviceOwner;
  assert.deepEqual(validateDeploymentPolicy(candidate), refused('InvalidConfiguration'));
});

test('every supplied field rejects a wrong type before absence checks', () => {
  for (const field of allFields) {
    const candidate: Record<string, unknown> = { ...valid, [field]: null };
    delete candidate[field === 'serviceOwner' ? 'startupOwner' : 'serviceOwner'];
    assert.deepEqual(validateDeploymentPolicy(candidate), refused('InvalidConfiguration'), field);
  }
});

test('operator strings enforce missing, ASCII, trim, and length rules', () => {
  for (const field of operatorStrings) {
    assert.deepEqual(validateDeploymentPolicy({ ...valid, [field]: '' }), refused('MissingOperatorInput'), field);
    assert.deepEqual(validateDeploymentPolicy({ ...valid, [field]: '   ' }), refused('MissingOperatorInput'), field);
    for (const value of [' edge', 'edge ', 'line\nfeed', '\u001f', '\u007f', 'é', 'x'.repeat(257)]) {
      assert.deepEqual(validateDeploymentPolicy({ ...valid, [field]: value }), refused('InvalidConfiguration'), `${field}: ${JSON.stringify(value)}`);
    }
    assert.deepEqual(validateDeploymentPolicy({ ...valid, [field]: 'x'.repeat(256) }), { status: 'valid-policy', platform: 'wsl' }, field);
  }
});

test('recovery objectives enforce exact safe-integer boundaries', () => {
  for (const value of [0, -1]) {
    assert.deepEqual(validateDeploymentPolicy({ ...valid, recoveryTimeObjectiveSeconds: value }), refused('InvalidConfiguration'));
  }
  for (const value of [-1, -2]) {
    assert.deepEqual(validateDeploymentPolicy({ ...valid, recoveryPointObjectiveSeconds: value }), refused('InvalidConfiguration'));
  }
  for (const field of ['recoveryTimeObjectiveSeconds', 'recoveryPointObjectiveSeconds'] as const) {
    for (const value of [1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity]) {
      assert.deepEqual(validateDeploymentPolicy({ ...valid, [field]: value }), refused('InvalidConfiguration'), `${field}: ${value}`);
    }
  }
  assert.deepEqual(validateDeploymentPolicy({ ...valid, recoveryTimeObjectiveSeconds: Number.MAX_SAFE_INTEGER, recoveryPointObjectiveSeconds: Number.MAX_SAFE_INTEGER }), { status: 'valid-policy', platform: 'wsl' });
  assert.deepEqual(validateDeploymentPolicy({ ...valid, recoveryTimeObjectiveSeconds: 1, recoveryPointObjectiveSeconds: 0 }), { status: 'valid-policy', platform: 'wsl' });
});

test('only declared enum values are accepted and unsafe declared values are refused', () => {
  for (const platform of ['windows', '', 1]) {
    assert.deepEqual(validateDeploymentPolicy({ ...valid, platform }), refused('InvalidConfiguration'));
  }
  for (const storageClass of ['windows-mounted', 'synchronized', 'unknown']) {
    assert.deepEqual(validateDeploymentPolicy({ ...valid, storageClass }), refused('UnsafeConfiguration'), storageClass);
  }
  assert.deepEqual(validateDeploymentPolicy({ ...valid, storageClass: 'other' }), refused('InvalidConfiguration'));
  assert.deepEqual(validateDeploymentPolicy({ ...valid, init: 'other' }), refused('UnsafeConfiguration'));
  assert.deepEqual(validateDeploymentPolicy({ ...valid, init: 'sysv' }), refused('InvalidConfiguration'));
  assert.deepEqual(validateDeploymentPolicy({ ...valid, backupDestinationClass: 'other' }), refused('UnsafeConfiguration'));
  assert.deepEqual(validateDeploymentPolicy({ ...valid, backupDestinationClass: 'cloud' }), refused('InvalidConfiguration'));
});

test('each boolean safety gate is identical for WSL and Linux', () => {
  const unsafe = { devMode: true, bootstrapOutsideBao: false, distinctRoles: false } as const;
  for (const platform of ['wsl', 'linux'] as const) {
    for (const [field, value] of Object.entries(unsafe)) {
      assert.deepEqual(validateDeploymentPolicy({ ...valid, platform, [field]: value }), refused('UnsafeConfiguration'), `${platform}: ${field}`);
    }
  }
});

test('distinct authority roles do not require five unique owner labels', () => {
  for (const platform of ['wsl', 'linux'] as const) {
    assert.deepEqual(
      validateDeploymentPolicy({ ...valid, platform, unsealOwner: valid.serviceOwner }),
      { status: 'valid-policy', platform },
    );
  }
});

test('boolean safety gates reject truthy and falsy substitutes as malformed', () => {
  for (const field of ['devMode', 'bootstrapOutsideBao', 'distinctRoles'] as const) {
    for (const value of [0, 1, '', 'true']) {
      assert.deepEqual(validateDeploymentPolicy({ ...valid, [field]: value }), refused('InvalidConfiguration'), `${field}: ${value}`);
    }
  }
});

test('endpoint must be a canonical credential-free HTTPS origin', () => {
  const malformed = [
    'http://bao.example', 'https://user@bao.example', 'https://user:secret@bao.example',
    'https://bao.example/', 'https://bao.example/path', 'https://bao.example?query',
    'https://bao.example#fragment', ' https://bao.example', 'https://bao.example ',
    'HTTPS://bao.example', 'https://BAO.example', 'https://bao.example:443',
    'https://bao.example//', 'not a URL', '',
  ];
  for (const endpoint of malformed) {
    assert.deepEqual(validateDeploymentPolicy({ ...valid, endpoint }), refused('InvalidConfiguration'), endpoint);
  }
  assert.deepEqual(validateDeploymentPolicy({ ...valid, endpoint: 'https://bao.example:8200' }), { status: 'valid-policy', platform: 'wsl' });
});

test('CA digest is exactly lowercase hexadecimal', () => {
  for (const caSha256 of ['a'.repeat(63), 'a'.repeat(65), `${'a'.repeat(64)}\n`, 'A'.repeat(64), 'g'.repeat(64), ` ${'a'.repeat(64)}`]) {
    assert.deepEqual(validateDeploymentPolicy({ ...valid, caSha256 }), refused('InvalidConfiguration'), caSha256);
  }
  assert.deepEqual(validateDeploymentPolicy({ ...valid, caSha256: '0123456789abcdef'.repeat(4) }), { status: 'valid-policy', platform: 'wsl' });
});

test('supplied invalid objective ranges take precedence over missing operator input', () => {
  for (const [field, invalidValue] of [
    ['recoveryTimeObjectiveSeconds', 0],
    ['recoveryPointObjectiveSeconds', -1],
  ] as const) {
    const candidate: Record<string, unknown> = { ...valid, [field]: invalidValue };
    delete candidate.serviceOwner;
    assert.deepEqual(validateDeploymentPolicy(candidate), refused('InvalidConfiguration'), field);
  }
});

test('rejects non-objects, arrays, unknown keys, symbols, inherited properties, and exotic prototypes', () => {
  for (const input of [null, undefined, true, 1, 'policy', [], new Date(), Object.create(null)]) {
    assert.deepEqual(validateDeploymentPolicy(input), refused('InvalidConfiguration'));
  }
  assert.deepEqual(validateDeploymentPolicy({ ...valid, canarySecret: 'DO_NOT_ECHO' }), refused('InvalidConfiguration'));
  assert.deepEqual(validateDeploymentPolicy({ ...valid, [Symbol('canary')]: 'DO_NOT_ECHO' }), refused('InvalidConfiguration'));
  const inherited = Object.create({ platform: 'wsl' }) as Record<string, unknown>;
  Object.assign(inherited, valid);
  delete inherited.platform;
  assert.deepEqual(validateDeploymentPolicy(inherited), refused('InvalidConfiguration'));
});

test('rejects accessors without evaluating them or echoing canaries', () => {
  let evaluated = false;
  const candidate = { ...valid } as Record<string, unknown>;
  Object.defineProperty(candidate, 'endpoint', {
    enumerable: true,
    get() { evaluated = true; throw new Error('ACCESSOR_CANARY'); },
  });
  const result = validateDeploymentPolicy(candidate);
  assert.equal(evaluated, false);
  assert.deepEqual(result, refused('InvalidConfiguration'));
  assert.equal(JSON.stringify(result).includes('ACCESSOR_CANARY'), false);
});

test('hostile proxies fail closed without echoing thrown values', () => {
  const hostile = [
    new Proxy(valid, { ownKeys() { throw new Error('OWN_KEYS_CANARY'); } }),
    new Proxy(valid, { getOwnPropertyDescriptor() { throw new Error('DESCRIPTOR_CANARY'); } }),
    new Proxy(valid, { getPrototypeOf() { throw new Error('PROTOTYPE_CANARY'); } }),
    Proxy.revocable({ ...valid }, {}).proxy,
  ];
  Proxy.revocable({}, {}).revoke();
  const revoked = Proxy.revocable({ ...valid }, {});
  revoked.revoke();
  hostile[3] = revoked.proxy;
  for (const input of hostile) {
    const result = validateDeploymentPolicy(input);
    assert.deepEqual(result, refused('InvalidConfiguration'));
    assert.equal(JSON.stringify(result).includes('CANARY'), false);
  }
});

test('validation neither mutates input nor changes between repeated calls', () => {
  const frozen = Object.freeze({ ...valid });
  const before = JSON.stringify(frozen);
  const first = validateDeploymentPolicy(frozen);
  const second = validateDeploymentPolicy(frozen);
  assert.deepEqual(first, { status: 'valid-policy', platform: 'wsl' });
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(frozen), before);
  assert.deepEqual(Object.keys(first).sort(), ['platform', 'status']);
  assert.equal('ready' in first || 'authenticated' in first || 'qualified' in first, false);
});
