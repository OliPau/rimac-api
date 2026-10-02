import { InvalidCursor } from '#application/appointments/index';
import { z } from 'zod';

export function decodeCursor(cursor: string, insuredId: string) {
  try {
    const bytes = Buffer.from(cursor, 'base64url');
    if (!cursor || cursor.length > 2048 || bytes.toString('base64url') !== cursor) {
      throw new InvalidCursor();
    }
    const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      !('insuredId' in decoded) ||
      !('appointmentId' in decoded) ||
      decoded.insuredId !== insuredId ||
      typeof decoded.appointmentId !== 'string' ||
      !z.uuid().safeParse(decoded.appointmentId).success
    ) {
      throw new InvalidCursor();
    }
    return { insuredId, appointmentId: decoded.appointmentId };
  } catch {
    throw new InvalidCursor('Invalid pagination cursor');
  }
}

export function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}
