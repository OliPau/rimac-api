import type { APIGatewayProxyEventV2, SQSEvent, Context } from 'aws-lambda';
import { appointments, create } from './appointments.js';
import { httpHandler } from './http.js';
import { batch } from './batch.js';
import { logger } from './config.js';

const http = httpHandler(create, appointments, (name) =>
  logger.error('RequestFailed', { errorName: name }),
);

export async function handler(event: APIGatewayProxyEventV2 | SQSEvent, context: Context) {
  logger.addContext(context);
  if ('Records' in event) {
    return batch(
      event,
      async (message) => {
        await appointments.confirm(message);
        logger.info('AppointmentCompleted', {
          appointmentId: message.appointmentId,
          correlationId: message.correlationId,
        });
      },
      (messageId, errorName) => logger.error('ConfirmationFailed', { messageId, errorName }),
    );
  }
  return http(event);
}
