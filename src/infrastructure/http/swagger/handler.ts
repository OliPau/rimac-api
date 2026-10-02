import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { authorized, type Credentials } from './credentials.js';
import { swaggerAssets, type SwaggerAsset } from './assets.js';

const headers = {
  'cache-control': 'no-store',
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
};

export function swaggerHandler(
  credentials: () => Promise<Credentials>,
  asset: (entry: SwaggerAsset) => Promise<string>,
  report: (name: string) => void,
) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const response = (statusCode: number, body: string) => ({
      statusCode,
      headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' },
      body,
    });
    if (event.rawPath === '/swagger') {
      return { ...response(308, ''), headers: { ...headers, location: '/swagger/' } };
    }
    try {
      const authorization = Object.entries(event.headers).find(
        ([name]) => name.toLowerCase() === 'authorization',
      )?.[1];
      if (!authorized(authorization, await credentials())) {
        return {
          ...response(401, 'Authentication required'),
          headers: { ...headers, 'www-authenticate': 'Basic realm="Swagger", charset="UTF-8"' },
        };
      }
      const entry = swaggerAssets.find(({ route }) => route === event.rawPath);
      if (!entry || event.requestContext.http.method !== 'GET') {
        return response(404, 'Not found');
      }
      return {
        statusCode: 200,
        headers: { ...headers, 'content-type': entry.type },
        body: await asset(entry),
      };
    } catch (error) {
      report(error instanceof Error ? error.name : 'UnknownError');
      return response(503, 'Documentation temporarily unavailable');
    }
  };
}
