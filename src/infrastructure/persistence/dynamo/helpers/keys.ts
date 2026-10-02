import { createHash } from 'node:crypto';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { acceptance } from '#infrastructure/shared/appointment.schema';
import { Conflict } from '#application/appointments/index';

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function readAcceptance(
  client: DynamoDBDocumentClient,
  table: string,
  id: string,
  fingerprint: string,
  now: number,
) {
  const saved = await client.send(
    new GetCommand({
      TableName: table,
      Key: { id },
      ConsistentRead: true,
    }),
  );
  if (!saved.Item || !(Number(saved.Item.expiresAt) > now)) {
    return undefined;
  }
  if (saved.Item.fingerprint !== fingerprint) {
    throw new Conflict('Idempotency key already used');
  }
  return acceptance.parse(saved.Item.acceptance);
}
