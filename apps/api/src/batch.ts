import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { event as schema } from '@rimac/contracts';
import type { Event } from '@rimac/core';

export async function batch(
  input: SQSEvent,
  action: (event: Event) => Promise<void>,
  report: (messageId: string, name: string) => void,
): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];
  for (const record of input.Records) {
    try {
      await action(schema.parse(JSON.parse(record.body)));
    } catch (error) {
      report(record.messageId, error instanceof Error ? error.name : 'UnknownError');
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
