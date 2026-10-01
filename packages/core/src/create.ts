import type { Appointments, Request } from './index.js';
import type { Dispatcher } from './dispatch.js';

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
