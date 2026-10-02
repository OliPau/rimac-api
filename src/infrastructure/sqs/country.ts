import type { SQSEvent } from 'aws-lambda';
import type { Logger } from '@aws-lambda-powertools/logger';
import type { Country } from '#domain/appointments/index';
import type { ProcessAppointment } from '#application/appointments/use-cases/process';
import { batch } from '#infrastructure/sqs/batch';

export function countryHandler(process: ProcessAppointment, country: Country, logger: Logger) {
  return (event: SQSEvent) =>
    batch(
      event,
      async (message) => {
        await process.execute(message);
        logger.info('CountrySaved', {
          appointmentId: message.appointmentId,
          correlationId: message.correlationId,
          country,
        });
      },
      (messageId, errorName) => logger.error('CountryFailed', { messageId, errorName, country }),
    );
}
