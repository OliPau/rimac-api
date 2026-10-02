import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import SwaggerParser from '@apidevtools/swagger-parser';
import { request, acceptance, appointment } from '#infrastructure/shared/appointment.schema';

const document = {
  openapi: '3.1.0',
  info: {
    title: 'RIMAC Appointments',
    version: '1.0.0',
    description: 'Public evaluation API for fictitious data.',
  },
  servers: [{ url: process.env.API_URL ?? 'https://example.execute-api.us-east-1.amazonaws.com' }],
  paths: {
    '/appointments': {
      post: {
        operationId: 'createAppointment',
        summary: 'Accept an appointment for asynchronous processing',
        description:
          'Business duplicates share an appointmentId. Idempotency-Key lasts 24 hours; repeated POST responses preserve the original pending acceptance.',
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
          content: { 'application/json': { schema: z.toJSONSchema(request) } },
        },
        responses: {
          '202': {
            description: 'Durably accepted',
            content: { 'application/json': { schema: z.toJSONSchema(acceptance) } },
          },
          '400': { $ref: '#/components/responses/Invalid' },
          '409': { description: 'Idempotency key already used with different input' },
          '413': { description: 'Body exceeds 4096 bytes' },
          '429': { description: 'Traffic limit exceeded' },
          '503': { $ref: '#/components/responses/Unavailable' },
        },
      },
    },
    '/appointments/{insuredId}': {
      get: {
        operationId: 'listAppointments',
        summary: 'List current appointment states',
        parameters: [
          {
            in: 'path',
            name: 'insuredId',
            required: true,
            schema: { type: 'string', pattern: '^\\d{5}$' },
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
          '400': { $ref: '#/components/responses/Invalid' },
          '429': { description: 'Traffic limit exceeded' },
          '503': { $ref: '#/components/responses/Unavailable' },
        },
      },
    },
  },
  components: {
    responses: {
      Invalid: { description: 'Invalid JSON, input or pagination cursor' },
      Unavailable: {
        description: 'Storage temporarily unavailable; retry with the same input and key',
      },
    },
  },
};
await mkdir('delivery', { recursive: true });
await writeFile('delivery/openapi.json', JSON.stringify(document, null, 2));
await SwaggerParser.validate('delivery/openapi.json');
console.log('OpenAPI validated');
