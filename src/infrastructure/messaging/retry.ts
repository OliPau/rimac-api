import type { Logger } from '@aws-lambda-powertools/logger';
import type { DispatchPendingAppointments } from '#application/appointments/use-cases/dispatch';

export function retryHandler(
  dispatch: DispatchPendingAppointments,
  pendingAge: () => Promise<number>,
  logger: Logger,
) {
  return async () => {
    const count = await dispatch.execute();
    logger.info('OutboxRetry', { count, pendingAge: await pendingAge() });
  };
}
