import type { Appointments, Outbox, Publisher, Request } from './index.js';

export class Dispatcher {
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

  async retry(): Promise<number> {
    const ids = await this.outbox.due(25);
    for (const id of ids) {
      await this.dispatch(id);
    }
    return ids.length;
  }
}

export class Create {
  constructor(
    private readonly appointments: Appointments,
    private readonly dispatcher: Dispatcher,
    private readonly reportFailure: () => void,
  ) {}

  async execute(input: Request, key?: string) {
    const accepted = await this.appointments.create(input, key);
    try {
      await this.dispatcher.dispatch(accepted.appointmentId);
    } catch {
      this.reportFailure();
    }
    return accepted;
  }
}
