import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { appointment } from '@rimac/contracts';
import type { Appointments, Event, Request } from '@rimac/core';
import { accept, identity, requested } from '@rimac/core/appointment';
import { decodeCursor, encodeCursor } from './cursor.js';
import { hashKey, readAcceptance } from './keys.js';
import { appointmentWrites, keyWrite, type Tables } from './writes.js';

const transactionAttempts = 8;
const transactionRetryBaseMs = 10;
const transactionRetryJitterMs = 20;

export class DynamoAppointments implements Appointments {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tables: Tables,
    private readonly now: () => number = Date.now,
  ) {}

  async create(input: Request, key?: string) {
    const { fingerprint, appointmentId } = identity(input);
    const itemKey = { insuredId: input.insuredId, appointmentId };
    const keyHash = key ? hashKey(key) : undefined;
    for (let attempt = 0; ; attempt++) {
      const seconds = Math.floor(this.now() / 1000);
      const saved = keyHash
        ? await readAcceptance(this.client, this.tables.keys, keyHash, fingerprint, seconds)
        : undefined;
      if (saved) {
        return saved;
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
      const accepted = accept(appointmentId, createdAt);
      const writes = existing.Item
        ? []
        : appointmentWrites(
            this.tables,
            requested(input, accepted, randomUUID(), randomUUID()),
            seconds,
          );
      if (keyHash) {
        writes.push(keyWrite(this.tables.keys, keyHash, fingerprint, accepted, seconds));
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
          attempt === transactionAttempts - 1
        ) {
          throw error;
        }
        await delay(
          transactionRetryBaseMs * 2 ** attempt + Math.random() * transactionRetryJitterMs,
        );
      }
    }
  }

  async list(insuredId: string, limit: number, cursor?: string) {
    const start = cursor ? decodeCursor(cursor, insuredId) : undefined;
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
      ...(result.LastEvaluatedKey ? { cursor: encodeCursor(result.LastEvaluatedKey) } : {}),
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
