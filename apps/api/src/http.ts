import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { idempotencyKey, insured, query, request } from '@rimac/contracts';
import { Conflict, InvalidCursor, type Appointments } from '@rimac/core';
import type { Create } from '../../../packages/core/src/create.js';

function response(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function httpHandler(
  create: Create,
  appointments: Appointments,
  report: (name: string) => void,
) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    try {
      if (event.routeKey === 'POST /appointments') {
        let body: unknown;
        try {
          const raw = event.isBase64Encoded
            ? Buffer.from(event.body ?? '', 'base64').toString()
            : (event.body ?? '');
          if (Buffer.byteLength(raw) > 4096)
            return response(413, { error: { code: 'PAYLOAD_TOO_LARGE' } });
          body = JSON.parse(raw);
        } catch {
          return response(400, { error: { code: 'INVALID_JSON' } });
        }
        const input = request.safeParse(body);
        const header = Object.entries(event.headers).find(
          ([name]) => name.toLowerCase() === 'idempotency-key',
        )?.[1];
        const key = idempotencyKey.optional().safeParse(header);
        if (!input.success || !key.success)
          return response(400, { error: { code: 'INVALID_REQUEST' } });
        return response(202, await create.execute(input.data, key.data));
      }
      if (event.routeKey === 'GET /appointments/{insuredId}') {
        const id = insured.safeParse(event.pathParameters?.insuredId);
        const page = query.safeParse(event.queryStringParameters ?? {});
        if (!id.success || !page.success)
          return response(400, { error: { code: 'INVALID_REQUEST' } });
        return response(200, await appointments.list(id.data, page.data.limit, page.data.cursor));
      }
      return response(404, { error: { code: 'NOT_FOUND' } });
    } catch (error) {
      if (error instanceof Conflict)
        return response(409, { error: { code: 'IDEMPOTENCY_CONFLICT' } });
      if (error instanceof InvalidCursor)
        return response(400, { error: { code: 'INVALID_CURSOR' } });
      report(error instanceof Error ? error.name : 'UnknownError');
      return response(503, { error: { code: 'SERVICE_UNAVAILABLE' } });
    }
  };
}
