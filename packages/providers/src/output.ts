import { canonicalize, sha256Hex, parseJsonRejectDuplicateKeys, isCoreFailure } from '@foreman/core';
import { createHostRegistry, validateDataSchema } from '@foreman/pel';
import type { JsonValue, PelDataSchemaV1, PelDataValue, Result } from '@foreman/pel';
import type { ProviderFailure } from './errors.js';
export interface OutputSchemaInput {
    readonly id: string;
    readonly content: PelDataSchemaV1;
}
export interface ProviderSchemaSubsetV1 {
    readonly endpointSupported?: boolean;
    readonly supportsAnyOf: boolean;
    readonly supportsOptionalFields: boolean;
    readonly supportsNumericBounds: boolean;
    readonly supportsArrayBounds: boolean;
    readonly weakenings: readonly ('utf8-maxBytes' | 'numeric-bounds' | 'array-bounds')[];
    readonly maxArrayBound?: number;
    readonly maxOptionalFields?: number;
    readonly maxUnions?: number;
 readonly enforceOpenAIComplexity?: boolean;
}
/** Endpoint facts from archived 2026-09-13 *-structured.md captures. Omissions are explicit host-enforced weakenings. */
export function providerSchemaSubset(transportId: string): ProviderSchemaSubsetV1 {
    if (!['openai-responses', 'codex-app-server', 'anthropic-messages', 'claude-code', 'xai-responses', 'grok-acp', 'google-interactions', 'gemini-cli'].includes(transportId))
        return { endpointSupported: false, supportsAnyOf: false, supportsOptionalFields: false, supportsNumericBounds: false, supportsArrayBounds: false, weakenings: [] };
    return { enforceOpenAIComplexity: ['openai-responses','codex-app-server'].includes(transportId), supportsAnyOf: true, supportsOptionalFields: !['openai-responses', 'codex-app-server'].includes(transportId), supportsNumericBounds: !['anthropic-messages', 'claude-code'].includes(transportId), supportsArrayBounds: !['anthropic-messages', 'claude-code'].includes(transportId), weakenings: ['utf8-maxBytes', ...(['anthropic-messages', 'claude-code'].includes(transportId) ? ['numeric-bounds', 'array-bounds'] as const : [])], ...(['xai-responses', 'grok-acp'].includes(transportId) ? { maxArrayBound: 256 } : {}), ...(['anthropic-messages', 'claude-code'].includes(transportId) ? { maxOptionalFields: 24, maxUnions: 16 } : {}) };
}
export interface LoweredProviderSchemaV1 {
    readonly jsonSchema: JsonValue;
    readonly originalSchemaSha256: string;
    readonly wireCodec: 'pel-object-v1' | 'pel-value-envelope-v1';
}
export const BUILTIN_PROVIDER_SCHEMAS: Readonly<Record<string, PelDataSchemaV1>> = Object.freeze({
    'schema:pel-boolean-v1': { type: 'boolean' },
    'schema:pel-source-v1': { type: 'association', additionalKeys: false, fields: [{ key: 'pelSource', required: true, schema: { type: 'string', maxBytes: 1048576 } }] },
});
function failure(tag: 'OutputInvalid' | 'UnsupportedCapability', fieldPath: string): ProviderFailure { return { _tag: tag, retryClass: 'never', message: `Provider schema validation failed at ${fieldPath}`, fieldPath }; }
function attempt<T>(f: () => T): Result<T, ProviderFailure> { try {
    return { ok: true, value: f() };
}
catch (error) {
    return { ok: false, error: error as ProviderFailure };
} }
export function lowerProviderSchema(output: OutputSchemaInput, subset: ProviderSchemaSubsetV1 = providerSchemaSubset('openai-responses'), registry: Readonly<Record<string, PelDataSchemaV1>> = BUILTIN_PROVIDER_SCHEMAS): Result<LoweredProviderSchemaV1, ProviderFailure> {
    return attempt(() => {
        if (subset.endpointSupported === false)
            throw failure('UnsupportedCapability', 'outputSchema.endpoint');
        const digest = sha256Hex(canonicalize(output.content));
        if (!Object.hasOwn(registry, output.id) || sha256Hex(canonicalize(registry[output.id])) !== digest)
            throw failure('UnsupportedCapability', 'outputSchema.id');
        if (!createHostRegistry([], { ['schema:provider-validation-v1']: output.content }).ok)
            throw failure('UnsupportedCapability', 'outputSchema.content');
        let optional = 0, unions = 0;
        const reject = (path: string): never => { throw failure('UnsupportedCapability', path); };
        const lower = (s: PelDataSchemaV1, path: string): JsonValue => {
            switch (s.type) {
                case 'data': return reject(path);
                case 'boolean': return { type: 'boolean' };
                case 'nil': return { type: 'null' };
                case 'string':
                    if (!subset.weakenings.includes('utf8-maxBytes'))
                        return reject(`${path}.maxBytes`);
                    return { type: 'string', ...(s.enum ? { enum: [...s.enum] } : {}) };
                case 'key': return { type: 'string', ...(s.enum ? { enum: [...s.enum] } : {}) };
                case 'number':
                    if (!subset.supportsNumericBounds && !subset.weakenings.includes('numeric-bounds'))
                        return reject(`${path}.minimum`);
                    return { type: s.integer ? 'integer' : 'number', ...(subset.supportsNumericBounds ? { minimum: s.minimum, maximum: s.maximum } : {}) };
                case 'list':
                    if ((!subset.supportsArrayBounds && !subset.weakenings.includes('array-bounds')) || (subset.maxArrayBound !== undefined && s.maxItems > subset.maxArrayBound))
                        return reject(`${path}.maxItems`);
                    return { type: 'array', items: lower(s.items, `${path}.items`), ...(subset.supportsArrayBounds ? { minItems: s.minItems, maxItems: s.maxItems } : {}) };
                case 'pair': return { type: 'object', properties: { [s.key]: lower(s.value, `${path}.${s.key}`) }, required: [s.key], additionalProperties: false };
                case 'association': {
                    const properties: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
                    const required: string[] = [];
                    for (const field of s.fields) {
                        if (!field.required) {
                            optional++;
                            if (!subset.supportsOptionalFields || (subset.maxOptionalFields !== undefined && optional > subset.maxOptionalFields))
                                return reject(`${path}.${field.key}`);
                        }
                        else
                            required.push(field.key);
                        properties[field.key] = lower(field.schema, `${path}.${field.key}`);
                    }
                    return { type: 'object', properties, required, additionalProperties: false };
                }
                case 'union':
                    unions++;
                    if (!subset.supportsAnyOf || (subset.maxUnions !== undefined && unions > subset.maxUnions))
                        return reject(path);
                    return { anyOf: s.variants.map((v, i) => lower(v, `${path}.variants[${i}]`)) };
            }
        };
        if (subset.enforceOpenAIComplexity) checkOpenAIComplexity(output.content);
 const root = lower(output.content, 'outputSchema.content');
        const object = output.content.type === 'association' || output.content.type === 'pair';
        return { jsonSchema: object ? root : { type: 'object', properties: { value: root }, required: ['value'], additionalProperties: false }, originalSchemaSha256: digest, wireCodec: object ? 'pel-object-v1' : 'pel-value-envelope-v1' };
    });
}
export function decodeProviderOutput(raw: string, output: OutputSchemaInput, maxBytes = 8 * 1024 * 1024): Result<PelDataValue, ProviderFailure> {
    return attempt(() => {
        const bad = (path: string): never => { throw failure('OutputInvalid', path); };
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || Buffer.byteLength(raw) > maxBytes)
            return bad('$');
        const parsed = parseJsonRejectDuplicateKeys(raw);
        if (isCoreFailure(parsed))
            return bad(parsed._tag === 'DuplicateJsonKey' ? duplicatePath(raw) : '$');
        const record = (v: unknown, path: string): Record<string, unknown> => { if (v === null || typeof v !== 'object' || Array.isArray(v))
            return bad(path); return v as Record<string, unknown>; };
        const decode = (v: unknown, s: PelDataSchemaV1, path: string): PelDataValue => {
            let result: PelDataValue;
            switch (s.type) {
                case 'data': return bad(path);
                case 'nil':
                    if (v !== null)
                        return bad(path);
                    result = { tag: 'nil' };
                    break;
                case 'boolean':
                    if (typeof v !== 'boolean')
                        return bad(path);
                    result = { tag: 'boolean', value: v };
                    break;
                case 'number':
                    if (typeof v !== 'number' || !Number.isFinite(v) || (s.integer && !Number.isSafeInteger(v)) || v < s.minimum || v > s.maximum)
                        return bad(path);
                    result = { tag: 'number', value: Object.is(v, -0) ? 0 : v };
                    break;
                case 'key':
                    if (typeof v !== 'string')
                        return bad(path);
                    result = { tag: 'key', name: v };
                    break;
                case 'string':
                    if (typeof v !== 'string')
                        return bad(path);
                    result = { tag: 'string', value: v };
                    break;
                case 'list':
                    if (!Array.isArray(v) || v.length < s.minItems || v.length > s.maxItems)
                        return bad(path);
                    result = { tag: 'list', items: v.map((item, i) => decode(item, s.items, `${path}[${i}]`)) };
                    break;
                case 'pair': {
                    const object = record(v, path);
                    if (!Object.hasOwn(object, s.key))
                        return bad(`${path}.${s.key}`);
                    for (const key of Object.keys(object))
                        if (key !== s.key)
                            return bad(`${path}.${key}`);
                    result = { tag: 'pair', key: s.key, value: decode(object[s.key], s.value, `${path}.${s.key}`) };
                    break;
                }
                case 'association': {
                    const object = record(v, path);
                    for (const key of Object.keys(object))
                        if (!s.fields.some(f => f.key === key))
                            return bad(`${path}.${key}`);
                    const items: PelDataValue[] = [];
                    for (const field of s.fields) {
                        if (!Object.hasOwn(object, field.key)) {
                            if (field.required)
                                return bad(`${path}.${field.key}`);
                            continue;
                        }
                        items.push({ tag: 'pair', key: field.key, value: decode(object[field.key], field.schema, `${path}.${field.key}`) });
                    }
                    result = { tag: 'list', items };
                    break;
                }
                case 'union':
                    for (const variant of s.variants) {
                        try {
                            return decode(v, variant, path);
                        }
                        catch { /* A union accepts the first fully host-valid alternative. */ }
                    }
                    return bad(path);
            }
            if (!validateDataSchema(result, s))
                return bad(path);
            return result;
        };
        let value: unknown = parsed;
        if (output.content.type !== 'association' && output.content.type !== 'pair') {
            const envelope = record(parsed, '$');
            if (!Object.hasOwn(envelope, 'value'))
                return bad('$.value');
            for (const key of Object.keys(envelope))
                if (key !== 'value')
                    return bad(`$.${key}`);
            value = envelope.value;
        }
        return decode(value, output.content, '$');
    });
}
export const validateFinal = decodeProviderOutput;
export function decodeProviderResult(raw: string, output: OutputSchemaInput, maxBytes?: number): Result<import('./contract.js').ProviderResultV1, ProviderFailure> {
    const decoded = decodeProviderOutput(raw, output, maxBytes);
    if (!decoded.ok)
        return decoded;
    const json = parseJsonRejectDuplicateKeys(raw);
    if (isCoreFailure(json))
        return { ok: false, error: failure('OutputInvalid', '$') };
    return { ok: true, value: { value: decoded.value, json: json as JsonValue, schemaId: output.id, schemaSha256: sha256Hex(canonicalize(output.content)), byteLength: Buffer.byteLength(raw) } };
}
/** Diagnostic-only scan after the canonical core parser has rejected a duplicate. */
function duplicatePath(raw: string): string {
    const tokens = raw.match(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g) ?? [];
    let position = 0;
    let found: string | undefined;
    function walk(path: string, depth: number): void {
        if (depth > 256 || found !== undefined)
            return;
        const token = tokens[position++];
        if (token === '{') {
            const keys = new Set<string>();
            while (position < tokens.length && tokens[position] !== '}') {
                const key = JSON.parse(tokens[position++]!) as string;
                if (tokens[position++] !== ':')
                    return;
                if (keys.has(key)) {
                    found = `${path}.${key}`;
                    return;
                }
                keys.add(key);
                walk(`${path}.${key}`, depth + 1);
                if (found !== undefined)
                    return;
                if (tokens[position] === ',')
                    position++;
                else
                    break;
            }
            position++;
        }
        else if (token === '[') {
            let index = 0;
            while (position < tokens.length && tokens[position] !== ']') {
                walk(`${path}[${index++}]`, depth + 1);
                if (found !== undefined)
                    return;
                if (tokens[position] === ',')
                    position++;
                else
                    break;
            }
            position++;
        }
    }
    try {
        walk('$', 0);
    }
    catch {
        return '$';
    }
    return found ?? '$';
}
function checkOpenAIComplexity(schema:PelDataSchemaV1):void {
 let properties=0,enums=0,characters=0;
 const reject=():never=>{throw failure('UnsupportedCapability','outputSchema.complexity');};
 const walk=(s:PelDataSchemaV1,depth:number):void=>{
  if(depth>10)reject();
  switch(s.type){
   case 'association':properties+=s.fields.length;for(const f of s.fields){characters+=f.key.length;walk(f.schema,depth+(f.schema.type==='association'||f.schema.type==='pair'||f.schema.type==='list'?1:0));}break;
   case 'pair':properties++;characters+=s.key.length;walk(s.value,depth+(s.value.type==='association'||s.value.type==='pair'||s.value.type==='list'?1:0));break;
   case 'list':walk(s.items,depth+(s.items.type==='association'||s.items.type==='pair'||s.items.type==='list'?1:0));break;
   case 'union':for(const v of s.variants)walk(v,depth);break;
   case 'key':case 'string':if(s.enum){const size=s.enum.reduce((n,v)=>n+v.length,0);enums+=s.enum.length;characters+=size;if(s.enum.length>250&&size>15000)reject();}break;
   default:break;
  }
  if(properties>5000||enums>1000||characters>120000)reject();
 };
 walk(schema,schema.type==='association'||schema.type==='pair'?1:2);
}
