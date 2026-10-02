import { expect, test, vi } from 'vitest';
import { Logger } from '@aws-lambda-powertools/logger';
import { DispatchPendingAppointments } from '#application/appointments/use-cases/dispatch';
import { CreateAppointment } from '#application/appointments/use-cases/create';
import { retryHandler } from '#infrastructure/messaging/retry';
import { event } from './fixtures.js';

test('isolates every phase, retains both causes and counts mixed batch outcomes', async () => {
  const claimCause = new Error('private claim detail');
  const publishCause = new Error('private SNS detail');
  const recoveryCause = new Error('private update detail');
  const sentCause = new Error('private sent detail');
  const outbox = {
    due: vi.fn(async () => ['claim', 'publish', 'recovery', 'sent', 'skipped', 'ok']),
    claim: vi
      .fn()
      .mockRejectedValueOnce(claimCause)
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(event),
    sent: vi.fn().mockRejectedValueOnce(sentCause).mockResolvedValueOnce(undefined),
    failed: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(recoveryCause),
  };
  const publisher = {
    publish: vi
      .fn()
      .mockRejectedValueOnce(publishCause)
      .mockRejectedValueOnce('unknown')
      .mockResolvedValue(undefined),
  };
  const dispatch = new DispatchPendingAppointments(outbox, publisher);
  const result = await dispatch.execute();
  expect(result).toMatchObject({ attempted: 6, sent: 1, skipped: 1, failed: 4 });
  expect(result.failures).toEqual([
    { status: 'failed', appointmentId: 'claim', phase: 'claim', cause: claimCause },
    {
      status: 'failed',
      appointmentId: 'publish',
      correlationId: event.correlationId,
      phase: 'publish',
      cause: publishCause,
    },
    {
      status: 'failed',
      appointmentId: 'recovery',
      correlationId: event.correlationId,
      phase: 'publish',
      cause: 'unknown',
      recovery: { phase: 'reschedule', cause: recoveryCause },
    },
    {
      status: 'failed',
      appointmentId: 'sent',
      correlationId: event.correlationId,
      phase: 'sent',
      cause: sentCause,
    },
  ]);
  expect(result.failures[0]?.cause).toBe(claimCause);
  expect(result.failures[2]?.recovery?.cause).toBe(recoveryCause);
  expect(outbox.failed).toHaveBeenCalledTimes(2);
  expect(outbox.due).toHaveBeenCalledWith(25);
  const logger = new Logger({ serviceName: 'test' });
  const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
  vi.spyOn(dispatch, 'execute').mockResolvedValue(result);
  await retryHandler(dispatch, async () => 600, logger)();
  expect(log).toHaveBeenCalledTimes(4);
  expect(log).toHaveBeenCalledWith('PublicationFailed', {
    appointmentId: 'recovery',
    correlationId: event.correlationId,
    phase: 'publish',
    errorName: 'UnknownError',
    recoveryPhase: 'reschedule',
    recoveryErrorName: 'Error',
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain('private');
  expect(JSON.stringify(log.mock.calls)).not.toContain(event.insuredId);
  expect(info).toHaveBeenCalledWith('OutboxRetry', {
    attempted: 6,
    sent: 1,
    skipped: 1,
    failed: 4,
    pendingAge: 600,
  });
});

test('durable acceptance survives an unexpected dispatcher rejection', async () => {
  const accepted = {
    appointmentId: event.appointmentId,
    status: 'pending' as const,
    message: 'accepted',
    createdAt: event.occurredAt,
  };
  const report = vi.fn();
  const cause = new Error('unexpected');
  const create = new CreateAppointment(
    { create: vi.fn(async () => accepted), list: vi.fn(), confirm: vi.fn() },
    { dispatch: vi.fn().mockRejectedValue(cause) },
    report,
  );
  expect(await create.execute(event)).toBe(accepted);
  expect(report).toHaveBeenCalledWith({
    status: 'failed',
    appointmentId: event.appointmentId,
    phase: 'dispatch',
    cause,
  });
});
