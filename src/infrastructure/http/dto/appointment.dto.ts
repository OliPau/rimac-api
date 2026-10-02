import { pagination } from '#application/appointments/use-cases/list';
import { z } from 'zod';

export const idempotencyKey = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\x21-\x7e]+$/);
export const query = z.strictObject({
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(pagination.maximumLimit))
    .default(pagination.defaultLimit),
  cursor: z.string().min(1).max(2048).optional(),
});
