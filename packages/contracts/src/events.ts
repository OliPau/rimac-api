import { z } from 'zod';
import { request } from './appointment.js';

export const event = request.extend({
  version: z.literal(1),
  type: z.enum(['appointment.requested', 'appointment.completed']),
  eventId: z.uuid(),
  appointmentId: z.uuid(),
  correlationId: z.uuid(),
  occurredAt: z.iso.datetime(),
});
