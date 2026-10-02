import type { CreateAppointmentDto } from '#application/appointments/dto/create.dto';
import type { Appointments, PublicationDispatch } from '#application/appointments/ports/index';

export class CreateAppointment {
  constructor(
    private readonly appointments: Appointments,
    private readonly dispatcher: PublicationDispatch,
    private readonly reportFailure: () => void,
  ) {}

  async execute(input: CreateAppointmentDto) {
    const request = {
      insuredId: input.insuredId,
      scheduleId: input.scheduleId,
      countryISO: input.countryISO,
    };
    const accepted = await this.appointments.create(request, input.idempotencyKey);
    try {
      await this.dispatcher.dispatch(accepted.appointmentId);
    } catch {
      this.reportFailure();
    }
    return accepted;
  }
}
