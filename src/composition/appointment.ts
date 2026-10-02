import { CreateAppointment } from '#application/appointments/use-cases/create';
import { ListAppointments } from '#application/appointments/use-cases/list';
import { ConfirmAppointment } from '#application/appointments/use-cases/confirm';
import { httpHandler } from '#infrastructure/http/handler';
import { confirmationHandler } from '#infrastructure/sqs/confirmation';
import { appointments, dispatcher } from './dynamo.js';
import { logger } from './config.js';

const create = new CreateAppointment(appointments, dispatcher, () =>
  logger.warn('ImmediatePublishFailed'),
);
const list = new ListAppointments(appointments);
const confirm = new ConfirmAppointment(appointments);
export const handleHttp = httpHandler(create, list, (errorName) =>
  logger.error('RequestFailed', { errorName }),
);

export const handleConfirmation = confirmationHandler(confirm, logger);
