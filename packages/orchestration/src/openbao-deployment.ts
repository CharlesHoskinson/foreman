export interface DeploymentPolicy {
  readonly platform: 'wsl' | 'linux';
  readonly devMode: boolean;
  readonly endpoint: string;
  readonly caSha256: string;
  readonly storageClass: 'linux-local' | 'windows-mounted' | 'synchronized' | 'unknown';
  readonly init: 'systemd' | 'other';
  readonly bootstrapOutsideBao: boolean;
  readonly distinctRoles: boolean;
  readonly serviceOwner: string;
  readonly startupOwner: string;
  readonly startupPolicy: string;
  readonly unsealOwner: string;
  readonly backupCustodian: string;
  readonly backupDestinationClass: 'protected-off-host' | 'other';
  readonly recoveryOwner: string;
  readonly recoveryTimeObjectiveSeconds: number;
  readonly recoveryPointObjectiveSeconds: number;
}

export type PolicyFailure = 'InvalidConfiguration' | 'MissingOperatorInput' | 'UnsafeConfiguration';
export type PolicyResult = { readonly status: 'valid-policy'; readonly platform: 'wsl' | 'linux' } |
  { readonly status: 'refused'; readonly code: PolicyFailure };

const fields = [
  'platform', 'devMode', 'endpoint', 'caSha256', 'storageClass', 'init',
  'bootstrapOutsideBao', 'distinctRoles', 'serviceOwner', 'startupOwner',
  'startupPolicy', 'unsealOwner', 'backupCustodian', 'backupDestinationClass',
  'recoveryOwner', 'recoveryTimeObjectiveSeconds', 'recoveryPointObjectiveSeconds',
] as const satisfies ReadonlyArray<keyof DeploymentPolicy>;

const fieldSet: ReadonlySet<string> = new Set(fields);
const operatorStrings = [
  'serviceOwner', 'startupOwner', 'startupPolicy', 'unsealOwner',
  'backupCustodian', 'recoveryOwner',
] as const satisfies ReadonlyArray<keyof DeploymentPolicy>;

const invalid = (): PolicyResult => ({ status: 'refused', code: 'InvalidConfiguration' });
const missing = (): PolicyResult => ({ status: 'refused', code: 'MissingOperatorInput' });
const unsafe = (): PolicyResult => ({ status: 'refused', code: 'UnsafeConfiguration' });

function isCanonicalHttpsOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' &&
      parsed.username === '' && parsed.password === '' &&
      value === parsed.origin;
  } catch {
    return false;
  }
}

function isOperatorString(value: string): boolean {
  return value.length <= 256 && value === value.trim() && /^[\x20-\x7e]+$/.test(value);
}

function validateBoundary(input: unknown): PolicyResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return invalid();
  if (Object.getPrototypeOf(input) !== Object.prototype) return invalid();

  const keys = Reflect.ownKeys(input);
  if (keys.some((key) => typeof key !== 'string' || !fieldSet.has(key))) return invalid();

  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const key of keys) {
    const descriptor = descriptors[key as string];
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) return invalid();
  }

  const has = (field: keyof DeploymentPolicy): boolean => descriptors[field] !== undefined;
  const value = (field: keyof DeploymentPolicy): unknown => descriptors[field]?.value;

  if (has('platform') && value('platform') !== 'wsl' && value('platform') !== 'linux') return invalid();
  for (const field of ['devMode', 'bootstrapOutsideBao', 'distinctRoles'] as const) {
    if (has(field) && typeof value(field) !== 'boolean') return invalid();
  }
  if (has('endpoint') && (typeof value('endpoint') !== 'string' || !isCanonicalHttpsOrigin(value('endpoint') as string))) return invalid();
  if (has('caSha256') && (typeof value('caSha256') !== 'string' ||
      (value('caSha256') as string).length !== 64 || !/^[0-9a-f]{64}$/.test(value('caSha256') as string))) return invalid();
  if (has('storageClass') && !['linux-local', 'windows-mounted', 'synchronized', 'unknown'].includes(value('storageClass') as string)) return invalid();
  if (has('init') && !['systemd', 'other'].includes(value('init') as string)) return invalid();
  if (has('backupDestinationClass') && !['protected-off-host', 'other'].includes(value('backupDestinationClass') as string)) return invalid();

  for (const field of operatorStrings) {
    if (!has(field)) continue;
    const supplied = value(field);
    if (typeof supplied !== 'string') return invalid();
    if (supplied.trim() !== '' && !isOperatorString(supplied)) return invalid();
  }
  for (const field of ['recoveryTimeObjectiveSeconds', 'recoveryPointObjectiveSeconds'] as const) {
    if (has(field) && (typeof value(field) !== 'number' || !Number.isSafeInteger(value(field)))) return invalid();
  }
  if (has('recoveryTimeObjectiveSeconds') && (value('recoveryTimeObjectiveSeconds') as number) <= 0) return invalid();
  if (has('recoveryPointObjectiveSeconds') && (value('recoveryPointObjectiveSeconds') as number) < 0) return invalid();

  const operatorFieldSet: ReadonlySet<string> = new Set([
    ...operatorStrings, 'recoveryTimeObjectiveSeconds', 'recoveryPointObjectiveSeconds',
  ]);
  if (fields.some((field) => !operatorFieldSet.has(field) && !has(field))) return invalid();
  if (operatorStrings.some((field) => !has(field) || (value(field) as string).trim() === '') ||
      !has('recoveryTimeObjectiveSeconds') || !has('recoveryPointObjectiveSeconds')) return missing();

  const policy = Object.fromEntries(fields.map((field) => [field, value(field)])) as unknown as DeploymentPolicy;
  if (policy.devMode || policy.storageClass !== 'linux-local' || policy.init !== 'systemd' ||
      !policy.bootstrapOutsideBao || !policy.distinctRoles ||
      policy.backupDestinationClass !== 'protected-off-host') return unsafe();

  return { status: 'valid-policy', platform: policy.platform };
}

export function validateDeploymentPolicy(input: unknown): PolicyResult {
  try {
    return validateBoundary(input);
  } catch {
    return invalid();
  }
}
