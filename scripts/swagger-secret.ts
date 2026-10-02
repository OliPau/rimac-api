import { PutSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { project, stacks } from '../infra/config.js';
import { stackOutputs } from './cloud.js';

const password = process.env.SWAGGER_PASSWORD;
if (!password || password.length < 12 || password.length > 1024) {
  throw new Error('Provide SWAGGER_PASSWORD with 12 to 1024 characters through the environment');
}
const outputs = await stackOutputs(stacks.data);
const client = new SecretsManagerClient({ region: project.region });
await client.send(
  new PutSecretValueCommand({
    SecretId: outputs.get('SwaggerSecret'),
    SecretString: JSON.stringify({ username: 'swagger', password }),
  }),
);
console.log('Swagger credential updated; active instances refresh within 60 seconds');
