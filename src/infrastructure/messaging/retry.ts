import type { Logger } from '@aws-lambda-powertools/logger';
import type { DispatchPendingAppointments } from '#application/appointments/use-cases/dispatch';
import { reportPublicationFailure } from './failure.js';

export function retryHandler(
  dispatch: DispatchPendingAppointments,
  pendingAge: () => Promise<number>,
  logger: Logger,
) {
  return async () => {
    const { failures, ...counts } = await dispatch.execute();
    for (const failure of failures) {
      reportPublicationFailure(logger, failure);
    }
    logger.info('OutboxRetry', { ...counts, pendingAge: await pendingAge() });
  };
}
