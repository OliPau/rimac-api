import { z } from 'zod';
import { request, acceptance, appointment } from '#infrastructure/shared/appointment.schema';
import { validationDetails } from '../helpers/validation.js';
import { cursorMessage, paginationMessage } from '../dto/appointment.dto.js';

export function openapi(server = '/') {
  return {
    openapi: '3.1.0',
    info: {
      title: 'RIMAC Appointments',
      version: '1.0.0',
      description:
        'API pública de demostración. Utilizar únicamente datos ficticios. Try it out ejecuta solicitudes reales; POST crea citas. La credencial de Swagger protege solamente la documentación.',
    },
    servers: [{ url: server }],
    paths: {
      '/appointments': {
        post: {
          operationId: 'createAppointment',
          summary: 'Registrar una cita de forma asíncrona',
          description:
            '202 confirma persistencia durable, no procesamiento completado. Los duplicados de negocio comparten appointmentId. Idempotency-Key dura 24 horas; repetir la misma entrada conserva la aceptación original pending. Cambiar la entrada con la misma clave devuelve 409. Consultar GET para conocer el estado actual. Los tres campos son obligatorios y no se normalizan ni convierten automáticamente. scheduleId referencia un espacio de atención previamente seleccionado; esta demo no consulta catálogos de horarios ni asegurados. Los errores 400 incluyen error.details con el campo y la regla incumplida.',
          parameters: [
            {
              in: 'header',
              name: 'Idempotency-Key',
              required: false,
              schema: { type: 'string', minLength: 1, maxLength: 128 },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: z.toJSONSchema(request),
                examples: {
                  peru: {
                    summary: 'Cita ficticia en Perú',
                    value: { insuredId: '00123', scheduleId: 100, countryISO: 'PE' },
                  },
                  chile: {
                    summary: 'Cita ficticia en Chile',
                    value: { insuredId: '00456', scheduleId: 200, countryISO: 'CL' },
                  },
                },
              },
            },
          },
          responses: {
            '202': {
              description: 'Durably accepted',
              content: { 'application/json': { schema: z.toJSONSchema(acceptance) } },
            },
            '400': { $ref: '#/components/responses/InvalidPost' },
            '409': errorResponse('Clave usada con otra entrada', ['IDEMPOTENCY_CONFLICT']),
            '413': errorResponse('El cuerpo supera 4096 bytes', ['PAYLOAD_TOO_LARGE']),
            '429': { description: 'Traffic limit exceeded' },
            '503': { $ref: '#/components/responses/Unavailable' },
          },
        },
      },
      '/appointments/{insuredId}': {
        get: {
          operationId: 'listAppointments',
          summary: 'Consultar citas y su estado actual',
          description:
            'Reenviar cursor sin modificar con el mismo asegurado para obtener la siguiente página. Estados: pending y completed. No se garantiza un orden cronológico.',
          parameters: [
            {
              in: 'path',
              name: 'insuredId',
              required: true,
              schema: { type: 'string', pattern: '^\\d{5}$' },
              example: '00123',
            },
            {
              in: 'query',
              name: 'limit',
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            },
            { in: 'query', name: 'cursor', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Current appointments, or an empty items array',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items'],
                    properties: {
                      items: { type: 'array', items: z.toJSONSchema(appointment) },
                      cursor: { type: 'string' },
                    },
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/InvalidQuery' },
            '429': { description: 'Traffic limit exceeded' },
            '503': { $ref: '#/components/responses/Unavailable' },
          },
        },
      },
    },
    components: {
      schemas: {
        ValidationDetails: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['field', 'message'],
            properties: {
              field: {
                type: 'string',
                description:
                  'Campo inválido, body para la estructura del cuerpo o query para parámetros no admitidos.',
              },
              message: {
                type: 'string',
                description: 'Regla incumplida, sin reproducir el valor recibido.',
              },
            },
          },
        },
      },
      responses: {
        InvalidPost: validationResponse(
          'JSON, campos o Idempotency-Key inválidos',
          ['INVALID_JSON', 'INVALID_REQUEST'],
          {
            invalidFields: {
              summary: 'Identificador largo, número enviado como texto y país no admitido',
              description:
                'Entrada rechazada: {"insuredId":"00000200","scheduleId":"100","countryISO":"AR"}. No se recortan ceros ni se convierte el texto.',
              value: invalidRequestExample({
                insuredId: '00000200',
                scheduleId: '100',
                countryISO: 'AR',
              }),
            },
            missingFields: {
              summary: 'Campos obligatorios ausentes: cuerpo {}',
              value: invalidRequestExample({}),
            },
            invalidJson: {
              summary: 'El cuerpo no es JSON válido',
              value: {
                error: {
                  code: 'INVALID_JSON',
                  details: [{ field: 'body', message: 'Debe contener un documento JSON válido.' }],
                },
              },
            },
          },
        ),
        InvalidQuery: validationResponse(
          'Asegurado, parámetros o cursor inválidos',
          ['INVALID_REQUEST', 'INVALID_CURSOR'],
          {
            invalidLimit: {
              summary: 'limit fuera del rango permitido',
              value: {
                error: {
                  code: 'INVALID_REQUEST',
                  details: [{ field: 'limit', message: paginationMessage }],
                },
              },
            },
            invalidCursor: {
              summary: 'Cursor inválido o correspondiente a otro asegurado',
              value: {
                error: {
                  code: 'INVALID_CURSOR',
                  details: [{ field: 'cursor', message: cursorMessage }],
                },
              },
            },
          },
        ),
        Unavailable: errorResponse(
          'Almacenamiento temporalmente no disponible. Reintentar con la misma entrada y clave.',
          ['SERVICE_UNAVAILABLE'],
        ),
      },
    },
  };
}

function invalidRequestExample(input: unknown) {
  return {
    error: {
      code: 'INVALID_REQUEST',
      details: validationDetails('body', request.safeParse(input).error),
    },
  };
}

function validationResponse(
  description: string,
  codes: string[],
  examples: Record<string, unknown>,
) {
  const response = errorResponse(description, codes, {
    details: { $ref: '#/components/schemas/ValidationDetails' },
  });
  return {
    ...response,
    content: {
      'application/json': {
        ...response.content['application/json'],
        examples,
      },
    },
  };
}

function errorResponse(description: string, codes: string[], fields: Record<string, unknown> = {}) {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', ...Object.keys(fields)],
              properties: { code: { type: 'string', enum: codes }, ...fields },
            },
          },
        },
      },
    },
  };
}
