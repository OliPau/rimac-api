import { createHash } from 'node:crypto';
import type { Request } from '#domain/appointments/appointment';

export function identity(input: Request) {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([input.insuredId, input.countryISO, input.scheduleId]))
    .digest('hex');
  const hash = fingerprint;
  const appointmentId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return { fingerprint, appointmentId };
}
