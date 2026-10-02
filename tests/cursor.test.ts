import { expect, test } from 'vitest';
import { decodeCursor, encodeCursor } from '#infrastructure/persistence/dynamo/helpers/cursor';
import { event } from './fixtures.js';

const key = { insuredId: event.insuredId, appointmentId: event.appointmentId };

test('continues accepting existing canonical cursors', () => {
  expect(decodeCursor(encodeCursor(key), event.insuredId)).toEqual(key);
});

test.each([
  '',
  'x'.repeat(2049),
  '!',
  'e30=',
  'e30\n',
  'e31',
  Buffer.from('{').toString('base64url'),
  encodeCursor({ ...key, appointmentId: '-'.repeat(36) }),
  encodeCursor({ ...key, appointmentId: 'a'.repeat(36) }),
  encodeCursor({ ...key, appointmentId: '10000000-0000-4000-0000-000000000002' }),
  encodeCursor({ ...key, insuredId: '99999' }),
  `${encodeCursor(key)}!`,
  `${encodeCursor(key)}=`,
  Buffer.from([0xff]).toString('base64url'),
])('rejects malformed cursor %s', (cursor) => {
  expect(() => decodeCursor(cursor, event.insuredId)).toThrow('Invalid pagination cursor');
});
