import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalize, sha256Hex } from '@foreman/core';
import type { PelDataSchemaV1 } from '@foreman/pel';
import { decodeProviderOutput, lowerProviderSchema, providerSchemaSubset } from './output.js';
const content: PelDataSchemaV1 = { type: 'association', additionalKeys: false, fields: [{ key: 'Z', required: true, schema: { type: 'nil' } }, { key: 'a', required: true, schema: { type: 'number', integer: true, minimum: 0, maximum: 3 } }] };
const schema = { id: 'test', content };
test('xAI accepted array bounds above its guaranteed threshold retain exact host validation', () => {
    const content: PelDataSchemaV1 = { type: 'list', minItems: 0, maxItems: 1000, items: { type: 'boolean' } };
    const output = { id: 'candidate-path-bound', content };
    for (const transport of ['xai-responses', 'grok-acp']) {
        const subset = providerSchemaSubset(transport);
        const lowered = lowerProviderSchema(output, subset, { [output.id]: content });
        assert.equal(lowered.ok, true);
        if (lowered.ok) assert.equal(JSON.stringify(lowered.value.jsonSchema).includes('"maxItems":1000'), true);
        assert.equal(decodeProviderOutput(JSON.stringify({ value: Array(1000).fill(true) }), output).ok, true);
        assert.equal(decodeProviderOutput(JSON.stringify({ value: Array(1001).fill(true) }), output).ok, false);
        assert.equal(lowerProviderSchema(output, { ...subset, weakenings: ['utf8-maxBytes'] }, { [output.id]: content }).ok, false);
    }
});
test('T-M3-009 canonical schema order and exact closed decoding', () => {
    const a = decodeProviderOutput('{"a":2,"Z":null}', schema);
    const b = decodeProviderOutput('{"Z":null,"a":2}', schema);
    assert.equal(a.ok, true);
    assert.deepEqual(a, b);
    for (const raw of ['{"a":2,"a":1,"Z":null}', '{"a":2,"Z":null,"x":1}', '{"a":2}', '{"a":"2","Z":null}', '{"a":4,"Z":null}', '{"a":9007199254740992,"Z":null}']) {
        const result = decodeProviderOutput(raw, schema);
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.error._tag, 'OutputInvalid');
            assert.ok(result.error.fieldPath);
        }
    }
});
test('T-M3-028 root envelopes, generation envelope, union declaration order and bytes', () => {
    assert.deepEqual(decodeProviderOutput('{"value":true}', { id: 'schema:pel-boolean-v1', content: { type: 'boolean' } }), { ok: true, value: { tag: 'boolean', value: true } });
    assert.equal(decodeProviderOutput('{"value":true,"extra":1}', { id: 'b', content: { type: 'boolean' } }).ok, false);
    const union: PelDataSchemaV1 = { type: 'union', variants: [{ type: 'key', enum: ['Same'] }, { type: 'string', maxBytes: 8 }] };
    assert.deepEqual(decodeProviderOutput('{"value":"Same"}', { id: 'u', content: union }), { ok: true, value: { tag: 'key', name: 'Same' } });
    const source = { id: 'schema:pel-source-v1', content: { type: 'association', additionalKeys: false, fields: [{ key: 'pelSource', required: true, schema: { type: 'string', maxBytes: 4 } }] } as const };
    assert.equal(decodeProviderOutput('{"pelSource":"éé"}', source).ok, true);
    assert.equal(decodeProviderOutput('{"pelSource":"ééé"}', source).ok, false);
});
test('T-M3-009 lowering binds schema digest and fails unsupported subsets before dispatch', () => {
    const subset = providerSchemaSubset('openai-responses');
    const lowered = lowerProviderSchema(schema, subset, { test: content });
    assert.equal(lowered.ok, true);
    if (lowered.ok) {
        assert.equal(lowered.value.originalSchemaSha256, sha256Hex(canonicalize(content)));
        assert.deepEqual(JSON.parse(JSON.stringify(lowered.value.jsonSchema)), { type: 'object', properties: { Z: { type: 'null' }, a: { type: 'integer', minimum: 0, maximum: 3 } }, required: ['Z', 'a'], additionalProperties: false });
    }
    assert.equal(lowerProviderSchema(schema, subset, { test: { type: 'boolean' } }).ok, false);
    assert.equal(lowerProviderSchema({ id: 'data', content: { type: 'data', maxDepth: 2, maxBytes: 10 } }, subset).ok, false);
    assert.equal(lowerProviderSchema({ id: 'optional', content: { type: 'association', fields: [{ key: 'x', required: false, schema: { type: 'boolean' } }], additionalKeys: false } }, subset).ok, false);
    assert.equal(lowerProviderSchema(schema, { ...subset, supportsNumericBounds: false, weakenings: [] }).ok, false);
});
test('T-M3-028 pairs and nested lists retain source key names and bounds', () => {
    const pair = { id: 'pair', content: { type: 'pair', key: 'MixedCase', value: { type: 'list', minItems: 1, maxItems: 2, items: { type: 'key', enum: ['Upper'] } } } as const };
    assert.deepEqual(decodeProviderOutput('{"MixedCase":["Upper"]}', pair), { ok: true, value: { tag: 'pair', key: 'MixedCase', value: { tag: 'list', items: [{ tag: 'key', name: 'Upper' }] } } });
    for (const raw of ['{"mixedcase":["Upper"]}', '{"MixedCase":[]}', '{"MixedCase":["upper"]}', '{"MixedCase":["Upper","Upper","Upper"]}'])
        assert.equal(decodeProviderOutput(raw, pair).ok, false);
    const lowered = lowerProviderSchema(pair, providerSchemaSubset('anthropic-messages'), { pair: pair.content });
    assert.equal(lowered.ok, true);
    if (lowered.ok)
        assert.equal(JSON.stringify(lowered.value.jsonSchema).includes('maxItems'), false);
    const rejected = lowerProviderSchema({ id: 'long-array', content: { type: 'list', minItems: 0, maxItems: 257, items: { type: 'boolean' } } }, providerSchemaSubset('xai-responses'));
    assert.equal(rejected.ok, false);
});
test('T-M3-028 immutable registry is required for custom schema IDs and duplicate diagnostics locate nested keys', () => {
    assert.equal(lowerProviderSchema(schema, providerSchemaSubset('openai-responses')).ok, false);
    assert.equal(lowerProviderSchema({ id: 'schema:pel-boolean-v1', content: { type: 'nil' } }, providerSchemaSubset('openai-responses')).ok, false);
    const nested = { id: 'nested', content: { type: 'association', additionalKeys: false, fields: [{ key: 'items', required: true, schema: { type: 'list', minItems: 0, maxItems: 2, items: { type: 'pair', key: 'x', value: { type: 'boolean' } } } }] } as const };
    const duplicate = decodeProviderOutput('{"items":[{"x":true,"x":false}]}', nested);
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok)
        assert.equal(duplicate.error.fieldPath, '$.items[0].x');
    assert.equal(lowerProviderSchema({ id: 'schema:pel-boolean-v1', content: { type: 'boolean' } }, providerSchemaSubset('unknown-endpoint')).ok, false);
});
