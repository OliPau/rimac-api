import { randomUUID } from 'node:crypto';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { event as eventSchema } from '@rimac/contracts';
import type { Event, Outbox } from '@rimac/core';

export class DynamoOutbox implements Outbox {
  private readonly leases = new Map<string, { owner: string; attempts: number }>();

  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly table: string,
    private readonly now: () => number = Date.now,
  ) {}

  async claim(id: string): Promise<Event | undefined> {
    const seconds = Math.floor(this.now() / 1000);
    const owner = randomUUID();
    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { id },
          UpdateExpression: 'SET dueAt = :lease, leaseOwner = :owner ADD attempts :one',
          ConditionExpression: '#state = :pending AND dueAt <= :now',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':lease': seconds + 60,
            ':owner': owner,
            ':one': 1,
            ':pending': 'pending',
            ':now': seconds,
          },
          ReturnValues: 'ALL_NEW',
        }),
      );
      const event = eventSchema.parse(result.Attributes?.event);
      this.leases.set(id, { owner, attempts: Number(result.Attributes?.attempts) });
      return event;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return undefined;
      }
      throw error;
    }
  }

  async sent(event: Event): Promise<void> {
    await this.release(event, true);
  }

  async failed(event: Event): Promise<void> {
    await this.release(event, false);
  }

  private async release(event: Event, sent: boolean): Promise<void> {
    const lease = this.leases.get(event.appointmentId);
    if (!lease) {
      throw new Error('Missing outbox lease');
    }
    const seconds = Math.floor(this.now() / 1000);
    const delay = Math.min(900, 2 ** Math.min(lease.attempts, 10) + Math.floor(Math.random() * 10));
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { id: event.appointmentId },
          ConditionExpression: 'leaseOwner = :owner',
          UpdateExpression: sent
            ? 'SET #state = :sent, expiresAt = :expiry REMOVE dueAt, leaseOwner'
            : 'SET dueAt = :next REMOVE leaseOwner',
          ...(sent ? { ExpressionAttributeNames: { '#state': 'state' } } : {}),
          ExpressionAttributeValues: {
            ':owner': lease.owner,
            ...(sent
              ? { ':sent': 'sent', ':expiry': seconds + 86400 }
              : { ':next': seconds + delay }),
          },
        }),
      );
    } finally {
      this.leases.delete(event.appointmentId);
    }
  }

  async due(limit: number): Promise<string[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: 'due',
        KeyConditionExpression: '#state = :pending AND dueAt <= :now',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: { ':pending': 'pending', ':now': Math.floor(this.now() / 1000) },
        Limit: limit,
      }),
    );
    return (result.Items ?? []).map((item) => {
      if (typeof item.id !== 'string') {
        throw new Error('Invalid outbox identifier');
      }
      return item.id;
    });
  }

  async pendingAge(): Promise<number> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: 'due',
        Limit: 1,
        KeyConditionExpression: '#state = :pending',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: { ':pending': 'pending' },
      }),
    );
    const first = result.Items?.[0];
    if (!first) {
      return 0;
    }
    const event = eventSchema.parse(first.event);
    return Math.max(0, Math.floor((this.now() - Date.parse(event.occurredAt)) / 1000));
  }
}
