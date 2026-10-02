import type { APIGatewayProxyEventV2, SQSEvent, Context } from 'aws-lambda';
import { handleHttp, handleConfirmation } from '../composition/appointment.js';
import { logger } from '../composition/config.js';

export async function handler(event: APIGatewayProxyEventV2 | SQSEvent, context: Context) {
  logger.addContext(context);
  if ('Records' in event) {
    return handleConfirmation(event);
  }
  return handleHttp(event);
}
