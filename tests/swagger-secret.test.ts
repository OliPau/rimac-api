import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

vi.mock('../scripts/cloud.js', () => ({
  stackOutputs: vi.fn(async () => ({ get: () => 'swagger-secret' })),
}));
const mock = mockClient(SecretsManagerClient);
const password = randomBytes(24).toString('hex');
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('SWAGGER_PASSWORD', undefined);
  mock.reset();
  mock
    .on(GetSecretValueCommand)
    .resolves({ SecretString: JSON.stringify({ username: 'swagger', password }) });
  mock.on(PutSecretValueCommand).resolves({});
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test('changes the username to admin without changing or printing the existing password', async () => {
  await import('../scripts/swagger-secret.js');
  expect(mock.commandCalls(PutSecretValueCommand)[0]?.args[0].input).toEqual({
    SecretId: 'swagger-secret',
    SecretString: JSON.stringify({ username: 'admin', password }),
  });
  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(password);
});

test('sets an explicitly provided password without reading the old secret', async () => {
  const replacement = randomBytes(24).toString('hex');
  vi.stubEnv('SWAGGER_PASSWORD', replacement);
  await import('../scripts/swagger-secret.js');
  expect(mock.commandCalls(GetSecretValueCommand)).toHaveLength(0);
  expect(mock.commandCalls(PutSecretValueCommand)[0]?.args[0].input.SecretString).toBe(
    JSON.stringify({ username: 'admin', password: replacement }),
  );
});

test.each(['', 'short', 'x'.repeat(1025)])(
  'rejects an invalid replacement without modifying the secret',
  async (replacement) => {
    vi.stubEnv('SWAGGER_PASSWORD', replacement);
    await expect(import('../scripts/swagger-secret.js')).rejects.toThrow(
      'Provide SWAGGER_PASSWORD',
    );
    expect(mock.commandCalls(PutSecretValueCommand)).toHaveLength(0);
  },
);

test.each([undefined, '{}', 'private-invalid-json'])(
  'rejects invalid stored credentials without exposing their contents',
  async (SecretString) => {
    mock.on(GetSecretValueCommand).resolves(SecretString === undefined ? {} : { SecretString });
    await expect(import('../scripts/swagger-secret.js')).rejects.toThrow(
      'The current Swagger secret must',
    );
    expect(mock.commandCalls(PutSecretValueCommand)).toHaveLength(0);
  },
);
