import { mkdir, writeFile } from 'node:fs/promises';
import SwaggerParser from '@apidevtools/swagger-parser';
import { openapi } from '#infrastructure/http/swagger/openapi';

await mkdir('delivery', { recursive: true });
await writeFile('delivery/openapi.json', JSON.stringify(openapi(process.env.API_URL), null, 2));
await SwaggerParser.validate('delivery/openapi.json');
console.log('OpenAPI validated');
