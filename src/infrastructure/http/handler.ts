import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  idempotencyKey,
  query,
  cursorMessage,
  paginationMessage,
} from '#infrastructure/http/dto/appointment.dto';
import { insured, request } from '#infrastructure/shared/appointment.schema';
import { Conflict, InvalidCursor, InvalidPagination } from '#application/appointments/index';
import type { ListAppointments } from '#application/appointments/use-cases/list';
import type { CreateAppointment } from '#application/appointments/use-cases/create';

import { response } from './helpers/response.js';
import { validationDetails } from './helpers/validation.js';

const maximumBodyBytes = 4 * 1024;

export function httpHandler(
  create: CreateAppointment,
  list: ListAppointments,
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
          if (Buffer.byteLength(raw) > maximumBodyBytes) {
            return response(413, { error: { code: 'PAYLOAD_TOO_LARGE' } });
          }
          body = JSON.parse(raw);
        } catch {
          return response(400, {
            error: {
              code: 'INVALID_JSON',
              details: [{ field: 'body', message: 'Debe contener un documento JSON válido.' }],
            },
          });
        }
        const input = request.safeParse(body);
        const header = Object.entries(event.headers).find(
          ([name]) => name.toLowerCase() === 'idempotency-key',
        )?.[1];
        const key = idempotencyKey.optional().safeParse(header);
        if (!input.success || !key.success) {
          return response(400, {
            error: {
              code: 'INVALID_REQUEST',
              details: [
                ...validationDetails('body', input.error),
                ...validationDetails('Idempotency-Key', key.error),
              ],
            },
          });
        }
        return response(
          202,
          await create.execute({
            ...input.data,
            ...(key.data === undefined ? {} : { idempotencyKey: key.data }),
          }),
        );
      }
      if (event.routeKey === 'GET /appointments/{insuredId}') {
        const id = insured.safeParse(event.pathParameters?.insuredId);
        const page = query.safeParse(event.queryStringParameters ?? {});
        if (!id.success || !page.success) {
          return response(400, {
            error: {
              code: 'INVALID_REQUEST',
              details: [
                ...validationDetails('insuredId', id.error),
                ...validationDetails('query', page.error),
              ],
            },
          });
        }
        return response(
          200,
          await list.execute({
            insuredId: id.data,
            limit: page.data.limit,
            ...(page.data.cursor === undefined ? {} : { cursor: page.data.cursor }),
          }),
        );
      }
      return response(404, { error: { code: 'NOT_FOUND' } });
    } catch (error) {
      if (error instanceof Conflict) {
        return response(409, { error: { code: 'IDEMPOTENCY_CONFLICT' } });
      }
      if (error instanceof InvalidCursor) {
        return response(400, {
          error: { code: 'INVALID_CURSOR', details: [{ field: 'cursor', message: cursorMessage }] },
        });
      }
      if (error instanceof InvalidPagination) {
        return response(400, {
          error: {
            code: 'INVALID_REQUEST',
            details: [{ field: 'limit', message: paginationMessage }],
          },
        });
      }
      report(error instanceof Error ? error.name : 'UnknownError');
      return response(503, { error: { code: 'SERVICE_UNAVAILABLE' } });
    }
  };
}
