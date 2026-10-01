export function tables() {
  const resources = {};
  for (const [name, attributes] of Object.entries({
    Appointments: ['insuredId', 'appointmentId'],
    Keys: ['id'],
    Outbox: ['id'],
  })) {
    resources[name] = {
      Type: 'AWS::DynamoDB::Table',
      Properties: {
        TableName: `rimac-demo-${name.toLowerCase()}`,
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
  resources.Outbox.Properties.AttributeDefinitions.push(
    { AttributeName: 'state', AttributeType: 'S' },
    { AttributeName: 'dueAt', AttributeType: 'N' },
  );
  resources.Outbox.Properties.GlobalSecondaryIndexes = [
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
