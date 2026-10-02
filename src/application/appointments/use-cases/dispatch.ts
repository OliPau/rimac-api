import type {
  DispatchBatch,
  Outbox,
  PublicationResult,
  Publisher,
} from '#application/appointments/ports/index';
import type { Event } from '#domain/appointments/index';

const retryBatchSize = 25;

export class DispatchPendingAppointments {
  constructor(
    private readonly outbox: Outbox,
    private readonly publisher: Publisher,
  ) {}

  async dispatch(id: string): Promise<PublicationResult> {
    let event: Event | undefined;
    try {
      event = await this.outbox.claim(id);
    } catch (cause) {
      return { status: 'failed', appointmentId: id, phase: 'claim', cause };
    }
    if (!event) {
      return { status: 'skipped' };
    }
    const context = { appointmentId: id, correlationId: event.correlationId };
    try {
      await this.publisher.publish(event);
    } catch (cause) {
      try {
        await this.outbox.failed(event);
      } catch (recoveryCause) {
        return {
          status: 'failed',
          ...context,
          phase: 'publish',
          cause,
          recovery: { phase: 'reschedule', cause: recoveryCause },
        };
      }
      return { status: 'failed', ...context, phase: 'publish', cause };
    }
    try {
      await this.outbox.sent(event);
    } catch (cause) {
      return { status: 'failed', ...context, phase: 'sent', cause };
    }
    return { status: 'sent' };
  }

  async execute(): Promise<DispatchBatch> {
    const ids = await this.outbox.due(retryBatchSize);
    const batch: DispatchBatch = { attempted: 0, sent: 0, skipped: 0, failed: 0, failures: [] };
    for (const id of ids) {
      const result = await this.dispatch(id);
      batch.attempted++;
      batch[result.status]++;
      if (result.status === 'failed') {
        batch.failures.push(result);
      }
    }
    return batch;
  }
}
