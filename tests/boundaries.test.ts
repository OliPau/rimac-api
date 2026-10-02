import { expect, test } from 'vitest';
import { verifyDependencies } from '../scripts/boundaries.js';

const domain = 'src/domain/models.ts';
const application = 'src/application/create.ts';
const infrastructure = 'src/infrastructure/dynamo/appointments.ts';
const api = 'src/composition/appointment.ts';

test('permits dependencies toward domain and application', () => {
  expect(() =>
    verifyDependencies(
      new Map([
        [api, [application, infrastructure]],
        [infrastructure, [application, domain]],
        [application, [domain]],
        [domain, []],
      ]),
    ),
  ).not.toThrow();
});

test('rejects reversed dependencies, deployment imports and cycles', () => {
  expect(() => verifyDependencies(new Map([[domain, [application]]]))).toThrow(
    'Forbidden dependency',
  );
  expect(() => verifyDependencies(new Map([[application, ['infra/config.ts']]]))).toThrow(
    'Forbidden dependency',
  );
  expect(() => verifyDependencies(new Map([['unexpected.ts', []]]))).toThrow(
    'Unknown backend layer',
  );
  expect(() =>
    verifyDependencies(new Map([['src/handlers/appointment.ts', [infrastructure]]])),
  ).toThrow('Forbidden dependency');
  const other = 'src/domain/identity.ts';
  expect(() =>
    verifyDependencies(
      new Map([
        [domain, [other]],
        [other, [domain]],
      ]),
    ),
  ).toThrow('Circular dependency');
});
