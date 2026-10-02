import { readFile } from 'node:fs/promises';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { secretCredentials } from '#infrastructure/http/swagger/credentials';
import { swaggerHandler } from '#infrastructure/http/swagger/handler';
import { env, logger } from './config.js';

const client = new SecretsManagerClient({ maxAttempts: 2 });
export const handleSwagger = swaggerHandler(
  secretCredentials(client, env('SWAGGER_SECRET_ARN')),
  (entry) => readFile(entry.file, 'utf8'),
  (errorName) => logger.error('SwaggerFailed', { errorName }),
);
