import { createHash, randomUUID } from 'node:crypto';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { appointment, acceptance } from '@rimac/contracts';
import { Conflict, InvalidCursor, type Appointments, type Event, type Request } from '@rimac/core';

export interface Tables {
  appointments: string;
  keys: string;
  outbox: string;
}

export function fingerprint(input: Request): string {
  return createHash('sha256')
    .update(JSON.stringify([input.insuredId, input.countryISO, input.scheduleId]))
    .digest('hex');
}

function identifier(hash: string): string {
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export class DynamoAppointments implements Appointments {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tables: Tables,
    private readonly now: () => number = Date.now,
  ) {}

  async create(input: Request, key?: string) {
    const hash = fingerprint(input);
    const appointmentId = identifier(hash);
    const itemKey = { insuredId: input.insuredId, appointmentId };
    const keyHash = key ? createHash('sha256').update(key).digest('hex') : undefined;

    for (let attempt = 0; attempt < 8; attempt++) {
      const seconds = Math.floor(this.now() / 1000);
      if (keyHash) {
        const saved = await this.client.send(
          new GetCommand({
            TableName: this.tables.keys,
            Key: { id: keyHash },
            ConsistentRead: true,
          }),
        );
        if (saved.Item && Number(saved.Item.expiresAt) > seconds) {
          if (saved.Item.fingerprint !== hash) {
            throw new Conflict('Idempotency key already used');
          }
          return acceptance.parse(saved.Item.acceptance);
        }
      }

      const existing = await this.client.send(
        new GetCommand({
          TableName: this.tables.appointments,
          Key: itemKey,
          ConsistentRead: true,
        }),
      );
      const createdAt = existing.Item
        ? appointment.parse(existing.Item).createdAt
        : new Date(this.now()).toISOString();
      const accepted = acceptance.parse({
        appointmentId,
        status: 'pending',
        createdAt,
        message: 'El agendamiento está en proceso.',
      });
      const writes: NonNullable<TransactWriteCommandInput['TransactItems']> = [];

      if (!existing.Item) {
        const event: Event = {
          ...input,
          version: 1,
          type: 'appointment.requested',
          eventId: randomUUID(),
          appointmentId,
          correlationId: randomUUID(),
          occurredAt: createdAt,
        };
        writes.push(
          {
            Put: {
              TableName: this.tables.appointments,
              Item: { ...input, appointmentId, status: 'pending', createdAt },
              ConditionExpression: 'attribute_not_exists(appointmentId)',
            },
          },
          {
            Put: {
              TableName: this.tables.outbox,
              Item: { id: appointmentId, event, state: 'pending', dueAt: seconds, attempts: 0 },
              ConditionExpression: 'attribute_not_exists(id)',
            },
          },
        );
      }
      if (keyHash) {
        writes.push({
          Put: {
            TableName: this.tables.keys,
            Item: {
              id: keyHash,
              fingerprint: hash,
              acceptance: accepted,
              expiresAt: seconds + 86400,
            },
            ConditionExpression: 'attribute_not_exists(id) OR expiresAt <= :now',
            ExpressionAttributeValues: { ':now': seconds },
          },
        });
      }
      if (writes.length === 0) {
        return accepted;
      }

      try {
        await this.client.send(new TransactWriteCommand({ TransactItems: writes }));
        return accepted;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.name !== 'TransactionCanceledException' ||
          attempt === 7
        ) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt + Math.random() * 20));
      }
    }
    throw new Error('Unreachable transaction state');
  }

  async list(insuredId: string, limit: number, cursor?: string) {
    let start: { insuredId: string; appointmentId: string } | undefined;
    if (cursor) {
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
        start = { insuredId, appointmentId: decoded.appointmentId };
      } catch {
        throw new InvalidCursor('Invalid pagination cursor');
      }
    }
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tables.appointments,
        KeyConditionExpression: 'insuredId = :id',
        ExpressionAttributeValues: { ':id': insuredId },
        ConsistentRead: true,
        Limit: limit,
        ...(start ? { ExclusiveStartKey: start } : {}),
      }),
    );
    return {
      items: (result.Items ?? []).map((item) => appointment.parse(item)),
      ...(result.LastEvaluatedKey
        ? { cursor: Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url') }
        : {}),
    };
  }

  async confirm(event: Event): Promise<void> {
    if (event.type !== 'appointment.completed') {
      throw new Error('Unexpected confirmation type');
    }
    await this.client.send(
      new UpdateCommand({
        TableName: this.tables.appointments,
        Key: { insuredId: event.insuredId, appointmentId: event.appointmentId },
        UpdateExpression: 'SET #status = :completed',
        ConditionExpression:
          'countryISO = :country AND scheduleId = :schedule AND (#status = :pending OR #status = :completed)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':completed': 'completed',
          ':pending': 'pending',
          ':country': event.countryISO,
          ':schedule': event.scheduleId,
        },
      }),
    );
  }
}
