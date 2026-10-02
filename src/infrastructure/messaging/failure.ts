import type { Logger } from '@aws-lambda-powertools/logger';
import type { PublicationFailure } from '#application/appointments/ports/index';

function errorName(cause: unknown): string {
  return cause instanceof Error ? cause.name : 'UnknownError';
}

export function reportPublicationFailure(logger: Logger, failure: PublicationFailure): void {
  logger.error('PublicationFailed', {
    appointmentId: failure.appointmentId,
    phase: failure.phase,
    errorName: errorName(failure.cause),
    ...(failure.correlationId ? { correlationId: failure.correlationId } : {}),
    ...(failure.recovery
      ? {
          recoveryPhase: failure.recovery.phase,
          recoveryErrorName: errorName(failure.recovery.cause),
        }
      : {}),
  });
}
