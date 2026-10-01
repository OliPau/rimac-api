import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import type { Acceptance, Event } from '@rimac/core';

export interface Tables {
  appointments: string;
  keys: string;
  outbox: string;
}

export type Writes = NonNullable<TransactWriteCommandInput['TransactItems']>;
const idempotencyLifetimeSeconds = 24 * 60 * 60;

export function appointmentWrites(tables: Tables, event: Event, now: number): Writes {
  const { insuredId, scheduleId, countryISO, appointmentId, occurredAt } = event;
  return [
    {
      Put: {
        TableName: tables.appointments,
        Item: {
          insuredId,
          scheduleId,
          countryISO,
          appointmentId,
          status: 'pending',
          createdAt: occurredAt,
        },
        ConditionExpression: 'attribute_not_exists(appointmentId)',
      },
    },
    {
      Put: {
        TableName: tables.outbox,
        Item: {
          id: appointmentId,
          event,
          state: 'pending',
          dueAt: now,
          pendingSince: Date.parse(occurredAt),
          attempts: 0,
        },
        ConditionExpression: 'attribute_not_exists(id)',
      },
    },
  ];
}

export function keyWrite(
  table: string,
  id: string,
  fingerprint: string,
  accepted: Acceptance,
  now: number,
): Writes[number] {
  return {
    Put: {
      TableName: table,
      Item: { id, fingerprint, acceptance: accepted, expiresAt: now + idempotencyLifetimeSeconds },
      ConditionExpression: 'attribute_not_exists(id) OR expiresAt <= :now',
      ExpressionAttributeValues: { ':now': now },
    },
  };
}
