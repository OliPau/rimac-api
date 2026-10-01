import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { Event, Publisher } from '@rimac/core';

export class SnsPublisher implements Publisher {
  constructor(
    private readonly client: SNSClient,
    private readonly topic: string,
  ) {}

  async publish(event: Event): Promise<void> {
    await this.client.send(
      new PublishCommand({
        TopicArn: this.topic,
        Message: JSON.stringify(event),
        MessageAttributes: { countryISO: { DataType: 'String', StringValue: event.countryISO } },
      }),
    );
  }
}

export class CompletionPublisher implements Publisher {
  constructor(
    private readonly client: EventBridgeClient,
    private readonly bus: string,
  ) {}

  async publish(event: Event): Promise<void> {
    const result = await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.bus,
            Source: 'rimac.appointments',
            DetailType: event.type,
            Detail: JSON.stringify(event),
          },
        ],
      }),
    );
    if (result.FailedEntryCount || result.Entries?.some((entry) => entry.ErrorCode)) {
      throw new Error('EventBridge rejected confirmation');
    }
    if (!result.Entries?.[0]?.EventId) {
      throw new Error('Missing EventBridge receipt');
    }
  }
}
