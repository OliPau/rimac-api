import type { ListAppointmentsDto } from '#application/appointments/dto/list.dto';
import type { Appointments } from '#application/appointments/ports/index';
import { InvalidPagination } from '#application/appointments/errors';

export const pagination = { defaultLimit: 20, maximumLimit: 100 } as const;

export class ListAppointments {
  constructor(private readonly appointments: Appointments) {}

  execute({ insuredId, limit = pagination.defaultLimit, cursor }: ListAppointmentsDto) {
    if (!Number.isInteger(limit) || limit < 1 || limit > pagination.maximumLimit) {
      throw new InvalidPagination('Invalid page size');
    }
    return this.appointments.list(insuredId, limit, cursor);
  }
}
