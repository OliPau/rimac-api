import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const eslintRequire = createRequire(require.resolve('eslint/package.json'));
const ajvRequire = createRequire(eslintRequire.resolve('ajv/package.json'));
const ajvPackage = eslintRequire('ajv/package.json') as { version: string };
const uriPackage = ajvRequire('uri-js/package.json') as { name: string; version: string };
assert.equal(ajvPackage.version, '6.15.0');
assert.deepEqual(
  { name: uriPackage.name, version: uriPackage.version },
  { name: 'fast-uri', version: '3.1.8' },
);

interface Validator {
  addSchema(schema: object): void;
  compile(schema: object): (value: unknown) => boolean;
}
const Ajv = eslintRequire('ajv') as new () => Validator;
const uri = ajvRequire('uri-js') as {
  resolve(base: string, relative: string): string;
  normalize(value: string): string;
  parse(value: string): { fragment?: string };
};
assert.equal(
  uri.resolve('https://example.com/a/b', '../schema.json#/definitions/value'),
  'https://example.com/schema.json#/definitions/value',
);
assert.equal(uri.parse('https://example.com/schema#part').fragment, 'part');
for (const separator of ['\u2028', '\u2029']) {
  assert.equal(typeof uri.normalize(`https://example.com/${separator}/../schema`), 'string');
  assert.equal(typeof uri.resolve('https://example.com/a/', `${separator}/../schema`), 'string');
}
const ajv = new Ajv();
ajv.addSchema({
  $id: 'https://example.com/types/value.json',
  definitions: { value: { type: 'integer', minimum: 1 } },
});
const validate = ajv.compile({
  $id: 'https://example.com/api/request.json',
  type: 'object',
  properties: {
    value: { $ref: '../types/value.json#/definitions/value' },
    label: { $ref: '#/definitions/label' },
  },
  required: ['value', 'label'],
  additionalProperties: false,
  definitions: { label: { type: 'string', minLength: 1 } },
});
assert.equal(validate({ value: 1, label: 'ok' }), true);
assert.equal(validate({ value: '1', label: 'ok' }), false);
assert.equal(validate({ value: 0, label: '' }), false);
assert.throws(() => ajv.compile({ type: 'not-a-json-schema-type' }));
console.log('Verified Ajv 6 URI substitution, schema references and Unicode separators');
