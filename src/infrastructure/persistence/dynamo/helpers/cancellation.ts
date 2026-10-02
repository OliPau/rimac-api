import type { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

const retryableCodes = new Set([
  'None',
  'ConditionalCheckFailed',
  'TransactionConflict',
  'ProvisionedThroughputExceeded',
  'ThrottlingError',
]);

export function retryableCancellation(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') {
    return false;
  }
  const reasons = (error as TransactionCanceledException).CancellationReasons;
  return (
    reasons === undefined ||
    reasons.every(({ Code }) => Code === undefined || retryableCodes.has(Code))
  );
}
