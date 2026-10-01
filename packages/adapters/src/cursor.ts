import { InvalidCursor } from '@rimac/core';

export function decodeCursor(cursor: string, insuredId: string) {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      !('insuredId' in decoded) ||
      !('appointmentId' in decoded) ||
      decoded.insuredId !== insuredId ||
      typeof decoded.appointmentId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(decoded.appointmentId)
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
