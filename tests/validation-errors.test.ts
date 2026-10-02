import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { beforeEach, expect, test, vi } from 'vitest';
import { CreateAppointment } from '#application/appointments/use-cases/create';
import { ListAppointments } from '#application/appointments/use-cases/list';
import { InvalidCursor, InvalidPagination } from '#application/appointments/index';
import { httpHandler } from '#infrastructure/http/handler';
import { openapi } from '#infrastructure/http/swagger/openapi';
import { cursorMessage, paginationMessage } from '#infrastructure/http/dto/appointment.dto';
import { http } from './fixtures.js';

const accepted = {
  appointmentId: '10000000-0000-4000-8000-000000000001',
  status: 'pending' as const,
  createdAt: '2026-10-02T00:00:00Z',
  message: 'El agendamiento está en proceso.',
};
const appointments = {
  create: vi.fn(async () => accepted),
  list: vi.fn(async () => ({ items: [] })),
  confirm: vi.fn(),
};
const dispatch = { dispatch: vi.fn(async () => ({ status: 'skipped' as const })) };
const report = vi.fn();
const handle = httpHandler(
  new CreateAppointment(appointments, dispatch, report),
  new ListAppointments(appointments),
  report,
);
const base = { insuredId: '00200', scheduleId: 100, countryISO: 'PE' };
const post = (input: unknown) => http('POST /appointments', JSON.stringify(input));
const get = () => ({
  ...http('GET /appointments/{insuredId}'),
  pathParameters: { insuredId: '00200' },
});
const bodyOf = (result: unknown): unknown =>
  JSON.parse((result as APIGatewayProxyStructuredResultV2).body!);

beforeEach(() => {
  vi.clearAllMocks();
});

test.each([{ insuredId: '00000200', scheduleId: '100', countryISO: 'AR' }, {}])(
  'reports every invalid or missing field without writing or disclosing submitted values',
  async (input) => {
    const result = await handle(post(input));
    expect(result).toMatchObject({ statusCode: 400 });
    expect(bodyOf(result)).toEqual({
      error: {
        code: 'INVALID_REQUEST',
        details: [
          {
            field: 'insuredId',
            message: 'Debe ser un texto de exactamente 5 dígitos; puede incluir ceros iniciales.',
          },
          {
            field: 'scheduleId',
            message: 'Debe ser un número entero entre 1 y 9007199254740991, sin comillas.',
          },
          { field: 'countryISO', message: 'Debe ser PE o CL, en mayúsculas.' },
        ],
      },
    });
    expect(appointments.create).not.toHaveBeenCalled();
    expect(dispatch.dispatch).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  },
);

test.each([
  [{ insuredId: 200 }, 'insuredId'],
  [{ insuredId: '0200' }, 'insuredId'],
  [{ insuredId: 'abcde' }, 'insuredId'],
  [{ scheduleId: '100' }, 'scheduleId'],
  [{ scheduleId: null }, 'scheduleId'],
  [{ scheduleId: 1.5 }, 'scheduleId'],
  [{ scheduleId: 0 }, 'scheduleId'],
  [{ scheduleId: -1 }, 'scheduleId'],
  [{ scheduleId: Number.MAX_SAFE_INTEGER + 1 }, 'scheduleId'],
  [{ countryISO: 'pe' }, 'countryISO'],
  [{ countryISO: 'cl' }, 'countryISO'],
])(
  'rejects invalid types and values without silently correcting them: %j',
  async (override, field) => {
    const result = await handle(post({ ...base, ...override }));
    expect(result).toMatchObject({ statusCode: 400 });
    expect(bodyOf(result)).toEqual({
      error: {
        code: 'INVALID_REQUEST',
        details: [{ field, message: expect.any(String) as unknown }],
      },
    });
    expect(appointments.create).not.toHaveBeenCalled();
  },
);

test.each([null, [], 'private-value', { ...base, 'private-extra-field': 'private-value' }])(
  'explains an invalid body without reflecting it: %j',
  async (input) => {
    const result = await handle(post(input));
    expect(bodyOf(result)).toEqual({
      error: {
        code: 'INVALID_REQUEST',
        details: [
          {
            field: 'body',
            message: 'Debe ser un objeto JSON con únicamente insuredId, scheduleId y countryISO.',
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('private');
  },
);

test('explains invalid JSON without exposing the input or parser details', async () => {
  const result = await handle(http('POST /appointments', '{private-malformed-json'));
  expect(bodyOf(result)).toEqual({
    error: {
      code: 'INVALID_JSON',
      details: [{ field: 'body', message: 'Debe contener un documento JSON válido.' }],
    },
  });
});

test('deduplicates header violations and aggregates them with body errors', async () => {
  const result = await handle({
    ...post({ ...base, countryISO: 'AR' }),
    headers: { 'Idempotency-Key': '' },
  });
  expect(bodyOf(result)).toEqual({
    error: {
      code: 'INVALID_REQUEST',
      details: [
        { field: 'countryISO', message: 'Debe ser PE o CL, en mayúsculas.' },
        {
          field: 'Idempotency-Key',
          message: 'Debe contener entre 1 y 128 caracteres ASCII visibles, sin espacios.',
        },
      ],
    },
  });
});

test('explains path, pagination and unknown query parameters', async () => {
  const result = await handle({
    ...get(),
    pathParameters: { insuredId: '00000200' },
    queryStringParameters: { limit: '101', 'private-query': 'private-value' },
  });
  expect(bodyOf(result)).toEqual({
    error: {
      code: 'INVALID_REQUEST',
      details: [
        {
          field: 'insuredId',
          message: 'Debe ser un texto de exactamente 5 dígitos; puede incluir ceros iniciales.',
        },
        { field: 'limit', message: paginationMessage },
        { field: 'query', message: 'Solo se permiten los parámetros limit y cursor.' },
      ],
    },
  });
  expect(appointments.list).not.toHaveBeenCalled();
});

test('preserves error codes and gives actionable cursor and pagination guidance', async () => {
  appointments.list.mockRejectedValueOnce(new InvalidCursor());
  expect(bodyOf(await handle(get()))).toEqual({
    error: { code: 'INVALID_CURSOR', details: [{ field: 'cursor', message: cursorMessage }] },
  });
  appointments.list.mockRejectedValueOnce(new InvalidPagination());
  expect(bodyOf(await handle(get()))).toEqual({
    error: { code: 'INVALID_REQUEST', details: [{ field: 'limit', message: paginationMessage }] },
  });
});

test('keeps internal errors opaque and successful requests unchanged', async () => {
  appointments.create.mockRejectedValueOnce(new Error('private database detail'));
  expect(bodyOf(await handle(post(base)))).toEqual({ error: { code: 'SERVICE_UNAVAILABLE' } });
  for (const countryISO of ['PE', 'CL']) {
    expect(bodyOf(await handle(post({ ...base, countryISO })))).toEqual(accepted);
    expect(appointments.create).toHaveBeenLastCalledWith({ ...base, countryISO }, undefined);
  }
});

test('documents the exact validation responses produced by the HTTP adapter', async () => {
  const document = openapi();
  const response = document.components.responses.InvalidPost.content['application/json'];
  expect(response.examples.invalidFields).toMatchObject({
    value: bodyOf(
      await handle(post({ insuredId: '00000200', scheduleId: '100', countryISO: 'AR' })),
    ),
  });
  expect(response.examples.missingFields).toMatchObject({ value: bodyOf(await handle(post({}))) });
  expect(response.schema.properties.error.required).toContain('details');
  expect(
    document.paths['/appointments'].post.requestBody.content['application/json'].schema.properties
      ?.scheduleId,
  ).toMatchObject({ description: expect.stringContaining('no consulta un catálogo') as unknown });
});
