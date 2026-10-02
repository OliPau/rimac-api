import { pagination } from '#application/appointments/use-cases/list';
import { z } from 'zod';

const keyMessage = 'Debe contener entre 1 y 128 caracteres ASCII visibles, sin espacios.';
export const paginationMessage = `Debe ser un entero entre 1 y ${pagination.maximumLimit}.`;
export const cursorMessage =
  'Debe ser un cursor válido de una página anterior del mismo asegurado, sin modificar.';

export const idempotencyKey = z
  .string({ error: keyMessage })
  .min(1, keyMessage)
  .max(128, keyMessage)
  .regex(/^[\x21-\x7e]+$/, keyMessage);
export const query = z.strictObject(
  {
    limit: z
      .string({ error: paginationMessage })
      .regex(/^\d+$/, paginationMessage)
      .transform(Number)
      .pipe(
        z
          .number({ error: paginationMessage })
          .int(paginationMessage)
          .min(1, paginationMessage)
          .max(pagination.maximumLimit, paginationMessage),
      )
      .default(pagination.defaultLimit),
    cursor: z.string({ error: cursorMessage }).optional(),
  },
  { error: 'Solo se permiten los parámetros limit y cursor.' },
);
