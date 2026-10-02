import type { SQSEvent } from 'aws-lambda';
import type { Logger } from '@aws-lambda-powertools/logger';
import type { ConfirmAppointment } from '#application/appointments/use-cases/confirm';
import { batch } from '#infrastructure/sqs/batch';

export function confirmationHandler(confirm: ConfirmAppointment, logger: Logger) {
  return (event: SQSEvent) =>
    batch(
      event,
      async (message) => {
        await confirm.execute(message);
        logger.info('AppointmentCompleted', {
          appointmentId: message.appointmentId,
          correlationId: message.correlationId,
        });
      },
      (messageId, errorName) => logger.error('ConfirmationFailed', { messageId, errorName }),
    );
}
