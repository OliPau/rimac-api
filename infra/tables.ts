import { prefix } from './config.js';
import type { Table } from './types.js';

function table(name: string, attributes: string[]): Table {
  return {
    Type: 'AWS::DynamoDB::Table',
    Properties: {
      TableName: `${prefix}-${name.toLowerCase()}`,
      BillingMode: 'PAY_PER_REQUEST',
      SSESpecification: { SSEEnabled: true },
      AttributeDefinitions: attributes.map((AttributeName) => ({
        AttributeName,
        AttributeType: 'S',
      })),
      KeySchema: attributes.map((AttributeName, index) => ({
        AttributeName,
        KeyType: index === 0 ? 'HASH' : 'RANGE',
      })),
      ...(name === 'Appointments'
        ? {}
        : { TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true } }),
    },
  };
}

export function tables(): Record<'Appointments' | 'Keys' | 'Outbox', Table> {
  const resources = {
    Appointments: table('Appointments', ['insuredId', 'appointmentId']),
    Keys: table('Keys', ['id']),
    Outbox: table('Outbox', ['id']),
  };
  resources.Outbox.Properties.AttributeDefinitions.push(
    { AttributeName: 'state', AttributeType: 'S' },
    { AttributeName: 'dueAt', AttributeType: 'N' },
    { AttributeName: 'pendingSince', AttributeType: 'N' },
  );
  resources.Outbox.Properties.GlobalSecondaryIndexes = [
    {
      IndexName: 'pending-age',
      Projection: { ProjectionType: 'KEYS_ONLY' },
      KeySchema: [
        { AttributeName: 'state', KeyType: 'HASH' },
        { AttributeName: 'pendingSince', KeyType: 'RANGE' },
      ],
    },
    {
      IndexName: 'due',
      Projection: { ProjectionType: 'ALL' },
      KeySchema: [
        { AttributeName: 'state', KeyType: 'HASH' },
        { AttributeName: 'dueAt', KeyType: 'RANGE' },
      ],
    },
  ];
  return resources;
}
