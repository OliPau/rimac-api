import type { Event } from '#domain/appointments/index';
import type { Appointments } from '#application/appointments/ports/index';

export class ConfirmAppointment {
  constructor(private readonly appointments: Appointments) {}

  async execute(event: Event): Promise<void> {
    if (event.type !== 'appointment.completed') {
      throw new Error('Unexpected confirmation type');
    }
    await this.appointments.confirm(event);
  }
}
