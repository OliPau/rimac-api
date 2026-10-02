import type { CreateAppointmentDto } from '#application/appointments/dto/create.dto';
import type {
  Appointments,
  PublicationDispatch,
  PublicationFailure,
} from '#application/appointments/ports/index';

export class CreateAppointment {
  constructor(
    private readonly appointments: Appointments,
    private readonly dispatcher: PublicationDispatch,
    private readonly reportFailure: (failure: PublicationFailure) => void,
  ) {}

  async execute(input: CreateAppointmentDto) {
    const request = {
      insuredId: input.insuredId,
      scheduleId: input.scheduleId,
      countryISO: input.countryISO,
    };
    const accepted = await this.appointments.create(request, input.idempotencyKey);
    if (accepted.status === 'completed') {
      return accepted;
    }
    try {
      const result = await this.dispatcher.dispatch(accepted.appointmentId);
      if (result.status === 'failed') {
        this.reportFailure(result);
      }
    } catch (cause) {
      this.reportFailure({
        status: 'failed',
        appointmentId: accepted.appointmentId,
        phase: 'dispatch',
        cause,
      });
    }
    return accepted;
  }
}
