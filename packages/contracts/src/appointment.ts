import { z } from 'zod';

export const insured = z.string().regex(/^\d{5}$/);
export const request = z.strictObject({
  insuredId: insured,
  scheduleId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  countryISO: z.enum(['PE', 'CL']),
});
export const appointment = request.extend({
  appointmentId: z.uuid(),
  status: z.enum(['pending', 'completed']),
  createdAt: z.iso.datetime(),
});
