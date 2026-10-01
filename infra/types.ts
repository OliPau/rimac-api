import type { AWS, AwsArn } from '@serverless/typescript';

export type Country = 'PE' | 'CL';
export type Functions = NonNullable<AWS['functions']>;
export type Resource = {
  Type: string;
  Properties: Record<string, unknown>;
  DependsOn?: string | string[];
};
export type Resources = Record<string, Resource>;

export interface Statement {
  Effect: 'Allow' | 'Deny';
  Action: string | string[];
  Resource: AwsArn | AwsArn[];
  Condition?: Record<string, Record<string, string>>;
}

type Key = {
  AttributeName: string;
  KeyType: 'HASH' | 'RANGE';
};

export type Table = {
  Type: 'AWS::DynamoDB::Table';
  Properties: {
    TableName: string;
    BillingMode: 'PAY_PER_REQUEST';
    SSESpecification: { SSEEnabled: boolean };
    AttributeDefinitions: { AttributeName: string; AttributeType: 'S' | 'N' }[];
    KeySchema: Key[];
    TimeToLiveSpecification?: { AttributeName: string; Enabled: boolean };
    GlobalSecondaryIndexes?: {
      IndexName: string;
      Projection: { ProjectionType: 'ALL' | 'KEYS_ONLY' };
      KeySchema: Key[];
    }[];
  };
};
