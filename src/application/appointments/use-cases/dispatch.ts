import type { Outbox, Publisher } from '#application/appointments/ports/index';

const retryBatchSize = 25;

export class DispatchPendingAppointments {
  constructor(
    private readonly outbox: Outbox,
    private readonly publisher: Publisher,
  ) {}

  async dispatch(id: string): Promise<void> {
    const event = await this.outbox.claim(id);
    if (!event) {
      return;
    }

    try {
      await this.publisher.publish(event);
      await this.outbox.sent(event);
    } catch {
      await this.outbox.failed(event);
    }
  }

  async execute(): Promise<number> {
    const ids = await this.outbox.due(retryBatchSize);
    for (const id of ids) {
      await this.dispatch(id);
    }
    return ids.length;
  }
}
