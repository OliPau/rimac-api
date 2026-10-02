import { z } from 'zod';

const insuredMessage = 'Debe ser un texto de exactamente 5 dígitos; puede incluir ceros iniciales.';
const scheduleMessage = `Debe ser un número entero entre 1 y ${Number.MAX_SAFE_INTEGER}, sin comillas.`;
const countryMessage = 'Debe ser PE o CL, en mayúsculas.';

export const insured = z
  .string({ error: insuredMessage })
  .regex(/^\d{5}$/, insuredMessage)
  .describe(
    'Código del asegurado de exactamente 5 dígitos, como "00200". No se recorta ni se rellena con ceros.',
  );
export const request = z.strictObject(
  {
    insuredId: insured,
    scheduleId: z
      .number({ error: scheduleMessage })
      .int(scheduleMessage)
      .positive(scheduleMessage)
      .max(Number.MAX_SAFE_INTEGER, scheduleMessage)
      .describe(
        'Identificador del espacio de atención seleccionado: centro, especialidad, médico y fecha/hora. Esta demo no consulta un catálogo ni valida su disponibilidad. Debe enviarse como número, sin conversión automática de texto.',
      ),
    countryISO: z
      .enum(['PE', 'CL'], { error: countryMessage })
      .describe('País de atención: PE o CL, en mayúsculas. No se normaliza automáticamente.'),
  },
  { error: 'Debe ser un objeto JSON con únicamente insuredId, scheduleId y countryISO.' },
);
export const appointment = request.extend({
  appointmentId: z.uuid(),
  status: z.enum(['pending', 'completed']),
  createdAt: z.iso.datetime(),
});

export const acceptance = z.strictObject({
  appointmentId: z.uuid(),
  status: z.literal('pending'),
  message: z.string(),
  createdAt: z.iso.datetime(),
});
