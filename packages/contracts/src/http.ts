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
    .pipe(z.number().int().min(1).max(100))
    .default(20),
  cursor: z.string().min(1).max(2048).optional(),
});
export const acceptance = z.strictObject({
  appointmentId: z.uuid(),
  status: z.literal('pending'),
  message: z.string(),
  createdAt: z.iso.datetime(),
});
