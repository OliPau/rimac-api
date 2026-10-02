import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';
import { project, stacks } from '../infra/config.js';
import { stackOutputs } from './cloud.js';

const outputs = await stackOutputs(stacks.data);
const client = new SecretsManagerClient({ region: project.region });
const SecretId = outputs.get('SwaggerSecret');
const passwordSchema = z.string().min(12).max(1024);
let password = process.env.SWAGGER_PASSWORD;
if (password === undefined) {
  const current = await client.send(new GetSecretValueCommand({ SecretId }));
  let decoded: unknown;
  try {
    decoded = JSON.parse(current.SecretString ?? '{}');
  } catch {
    throw new Error('The current Swagger secret must contain valid JSON');
  }
  const stored = z.object({ password: passwordSchema }).safeParse(decoded);
  if (!stored.success) {
    throw new Error('The current Swagger secret must contain a valid password');
  }
  password = stored.data.password;
}
if (!passwordSchema.safeParse(password).success) {
  throw new Error('Provide SWAGGER_PASSWORD with 12 to 1024 characters through the environment');
}
await client.send(
  new PutSecretValueCommand({
    SecretId,
    SecretString: JSON.stringify({ username: 'admin', password }),
  }),
);
console.log('Swagger user set to admin; active instances refresh within 60 seconds');
