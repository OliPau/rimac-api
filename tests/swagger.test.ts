import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, test, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Logger } from '@aws-lambda-powertools/logger';
import { authorized, secretCredentials } from '#infrastructure/http/swagger/credentials';
import { swaggerHandler } from '#infrastructure/http/swagger/handler';
import { swaggerAssets } from '#infrastructure/http/swagger/assets';
import { openapi } from '#infrastructure/http/swagger/openapi';
import { context, http } from './fixtures.js';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));

const credentials = { username: 'test-reader', password: randomBytes(24).toString('hex') };
const basic = (value: string) => `Basic ${Buffer.from(value).toString('base64')}`;
const authorization = basic(`${credentials.username}:${credentials.password}`);
const event = (rawPath = '/swagger/', header: string | undefined = authorization) => ({
  ...http('GET /swagger/{proxy+}'),
  rawPath,
  headers: { Authorization: header },
  requestContext: {
    ...http('').requestContext,
    http: { ...http('').requestContext.http, method: 'GET' },
  },
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test('compares complete credentials and rejects malformed or excessive Basic headers', () => {
  expect(authorized(authorization, credentials)).toBe(true);
  expect(authorized(authorization.replace('Basic', 'basic'), credentials)).toBe(true);
  for (const header of [
    undefined,
    '',
    'x'.repeat(4097),
    'Bearer value',
    'Basic !!!',
    'Basic dTpw=',
    'Basic YR==',
    basic('user:wrong'),
    basic(credentials.username),
    basic(`${credentials.username}:${credentials.password}:extra`),
  ]) {
    expect(authorized(header, credentials)).toBe(false);
  }
});

test('protects every documentation asset and rejects unknown paths and methods', async () => {
  const load = vi.fn(async () => 'content');
  const report = vi.fn();
  const handle = swaggerHandler(async () => credentials, load, report);
  expect(await handle(event('/swagger', ''))).toMatchObject({
    statusCode: 308,
    headers: { location: '/swagger/' },
  });
  for (const asset of swaggerAssets) {
    const anonymous = await handle(event(asset.route, ''));
    expect(anonymous).toMatchObject({
      statusCode: 401,
      headers: {
        'www-authenticate': 'Basic realm="Swagger", charset="UTF-8"',
        'cache-control': 'no-store',
      },
    });
    expect(anonymous.body).not.toContain('content');
    expect(await handle(event(asset.route))).toMatchObject({
      statusCode: 200,
      body: 'content',
      headers: { 'content-type': asset.type, 'x-frame-options': 'DENY' },
    });
  }
  expect(load).toHaveBeenCalledTimes(swaggerAssets.length);
  expect(await handle({ ...event(), headers: {} })).toMatchObject({ statusCode: 401 });
  expect(await handle(event('/swagger/../../.env'))).toMatchObject({ statusCode: 404 });
  const wrongMethod = event();
  wrongMethod.requestContext.http.method = 'POST';
  expect(await handle(wrongMethod)).toMatchObject({ statusCode: 404 });
  expect(report).not.toHaveBeenCalled();
});

test('fails closed on credential or asset errors and reports names without sensitive details', async () => {
  const report = vi.fn();
  const unavailable = swaggerHandler(
    async () => {
      throw new Error('private secret details');
    },
    async () => 'private asset',
    report,
  );
  expect(await unavailable(event())).toMatchObject({
    statusCode: 503,
    body: 'Documentation temporarily unavailable',
  });
  const missingAsset = swaggerHandler(
    async () => credentials,
    vi.fn().mockRejectedValue('private asset details'),
    report,
  );
  expect(await missingAsset(event())).toMatchObject({ statusCode: 503 });
  expect(report.mock.calls).toEqual([['Error'], ['UnknownError']]);
});

test('caches for at most 60 seconds, rotates credentials and never serves stale credentials on failure', async () => {
  vi.useFakeTimers();
  const client = new SecretsManagerClient({ region: 'us-east-1' });
  const mock = mockClient(client);
  try {
    mock.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify(credentials) });
    const get = secretCredentials(client, 'secret-id');
    expect(await get()).toEqual(credentials);
    vi.advanceTimersByTime(59_999);
    expect(await get()).toEqual(credentials);
    expect(mock.commandCalls(GetSecretValueCommand)).toHaveLength(1);
    vi.advanceTimersByTime(1);
    mock.on(GetSecretValueCommand).rejects(new Error('unavailable'));
    await expect(get()).rejects.toThrow('unavailable');
    const rotated = { ...credentials, password: randomBytes(24).toString('hex') };
    mock.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify(rotated) });
    expect(await get()).toEqual(rotated);
    expect(authorized(authorization, rotated)).toBe(false);
    vi.advanceTimersByTime(60_000);
    for (const result of [
      {},
      { SecretString: '{' },
      { SecretString: '{}' },
      { SecretString: JSON.stringify({ username: 'bad:name', password: credentials.password }) },
    ]) {
      mock.on(GetSecretValueCommand).resolves(result);
      await expect(get()).rejects.toThrow();
    }
    expect(mock.commandCalls(GetSecretValueCommand)[0]?.args[0].input).toEqual({
      SecretId: 'secret-id',
    });
  } finally {
    mock.restore();
    client.destroy();
  }
});

test('composes the real Lambda, reads only manifest files and logs sanitized failures', async () => {
  vi.resetModules();
  vi.stubEnv('SWAGGER_SECRET_ARN', 'swagger-secret');
  const mock = mockClient(SecretsManagerClient);
  const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  vi.mocked(readFile).mockResolvedValue('asset');
  try {
    mock.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify(credentials) });
    const { handler } = await import('../src/handlers/swagger.js');
    expect(await handler(event(), context)).toMatchObject({ statusCode: 200, body: 'asset' });
    expect(readFile).toHaveBeenCalledWith('static/swagger/index.html', 'utf8');
    vi.mocked(readFile).mockRejectedValue(new Error('private details'));
    expect(await handler(event(), context)).toMatchObject({ statusCode: 503 });
    expect(log).toHaveBeenCalledWith('SwaggerFailed', { errorName: 'Error' });
  } finally {
    mock.restore();
  }
});

test('uses the same OpenAPI contract for local export and the deployed same-origin API', () => {
  expect(openapi().servers).toEqual([{ url: '/' }]);
  expect(openapi('https://example.com').servers).toEqual([{ url: 'https://example.com' }]);
  expect(Object.keys(openapi().paths)).toEqual(['/appointments', '/appointments/{insuredId}']);
});

test('keeps the spec authenticated and omits documentation credentials from Try it out', async () => {
  const bundle = vi.fn();
  vi.stubGlobal('SwaggerUIBundle', bundle);
  vi.stubGlobal('location', {
    href: 'https://example.com/swagger/',
    origin: 'https://example.com',
  });
  const { requestInterceptor } = await import('#infrastructure/http/swagger/initializer');
  expect(bundle).toHaveBeenCalledWith(
    expect.objectContaining({
      validatorUrl: null,
      queryConfigEnabled: false,
      persistAuthorization: false,
      supportedSubmitMethods: ['get', 'post'],
    }),
  );
  for (const url of [
    '/swagger/openapi.json',
    '/appointments',
    'https://external.example/swagger/openapi.json',
  ]) {
    const result = requestInterceptor({
      url,
      headers: { Authorization: 'private', authorization: 'private', Accept: 'application/json' },
    });
    expect(result.headers).toEqual({ Accept: 'application/json' });
    expect(result.credentials).toBe(url === '/swagger/openapi.json' ? 'same-origin' : 'omit');
  }
});
