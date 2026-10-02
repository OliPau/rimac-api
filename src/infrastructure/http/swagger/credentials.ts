import { createHash, timingSafeEqual } from 'node:crypto';
import { GetSecretValueCommand, type SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';

const credential = z.object({
  username: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[^:\r\n]+$/),
  password: z.string().min(1).max(1024),
});
export type Credentials = z.infer<typeof credential>;
const cacheMilliseconds = 60_000;

export function secretCredentials(client: SecretsManagerClient, secretId: string) {
  let cached: { value: Credentials; expires: number } | undefined;
  return async (): Promise<Credentials> => {
    if (cached && Date.now() < cached.expires) {
      return cached.value;
    }
    const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!result.SecretString) {
      throw new Error('InvalidSwaggerSecret');
    }
    const value = credential.parse(JSON.parse(result.SecretString));
    cached = { value, expires: Date.now() + cacheMilliseconds };
    return value;
  };
}

export function authorized(header: string | undefined, expected: Credentials): boolean {
  if (!header || header.length > 4096) {
    return false;
  }
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header);
  if (!match?.[1]) {
    return false;
  }
  const decoded = Buffer.from(match[1], 'base64');
  if (decoded.toString('base64') !== match[1]) {
    return false;
  }
  const hash = (value: Buffer | string): Buffer => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(decoded), hash(`${expected.username}:${expected.password}`));
}
