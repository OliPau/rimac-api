import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { event } from '#infrastructure/messaging/dto/event.dto';

export async function backfillPending(client: DynamoDBDocumentClient, table: string) {
  let cursor: QueryCommandInput['ExclusiveStartKey'];
  let updated = 0;
  do {
    const page = await client.send(
      new QueryCommand({
        TableName: table,
        IndexName: 'due',
        KeyConditionExpression: '#state = :pending',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: { ':pending': 'pending' },
        Limit: 100,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }),
    );
    for (const item of page.Items ?? []) {
      if (item.pendingSince !== undefined) {
        continue;
      }
      if (typeof item.id !== 'string') {
        throw new Error('Invalid outbox identifier');
      }
      const pendingSince = Date.parse(event.parse(item.event).occurredAt);
      try {
        await client.send(
          new UpdateCommand({
            TableName: table,
            Key: { id: item.id },
            UpdateExpression: 'SET pendingSince = :since',
            ConditionExpression: '#state = :pending AND attribute_not_exists(pendingSince)',
            ExpressionAttributeNames: { '#state': 'state' },
            ExpressionAttributeValues: { ':since': pendingSince, ':pending': 'pending' },
          }),
        );
        updated++;
      } catch (error) {
        if (!(error instanceof Error) || error.name !== 'ConditionalCheckFailedException') {
          throw error;
        }
      }
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return updated;
}
