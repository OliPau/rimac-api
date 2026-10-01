import { z } from 'zod';

export const insured = z.string().regex(/^\d{5}$/);
export const request = z.strictObject({
  insuredId: insured,
  scheduleId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  countryISO: z.enum(['PE', 'CL']),
});
export const idempotencyKey = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\x21-\x7e]+$/);
export const event = request.extend({
  version: z.literal(1),
  type: z.enum(['appointment.requested', 'appointment.completed']),
  eventId: z.uuid(),
  appointmentId: z.uuid(),
  correlationId: z.uuid(),
  occurredAt: z.iso.datetime(),
});
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
export const appointment = request.extend({
  appointmentId: z.uuid(),
  status: z.enum(['pending', 'completed']),
  createdAt: z.iso.datetime(),
});
