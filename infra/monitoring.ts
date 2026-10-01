import { prefix } from './config.js';
import type { Resources } from './types.js';

export function monitoring(): Resources {
  const alerts = { 'Fn::Sub': `arn:aws:sns:\${AWS::Region}:\${AWS::AccountId}:${prefix}-alerts` };
  const resources: Resources = {};
  for (const name of [
    'DLQPE',
    'DLQCL',
    'DeliveryDLQPE',
    'DeliveryDLQCL',
    'ConfirmationDLQ',
    'EventDeliveryDLQ',
  ]) {
    resources[`${name}Alarm`] = {
      Type: 'AWS::CloudWatch::Alarm',
      Properties: {
        AlarmName: `${prefix}-${name}`,
        Namespace: 'AWS/SQS',
        MetricName: 'ApproximateNumberOfMessagesVisible',
        Statistic: 'Maximum',
        Dimensions: [{ Name: 'QueueName', Value: { 'Fn::GetAtt': [name, 'QueueName'] } }],
        Period: 60,
        EvaluationPeriods: 1,
        Threshold: 0,
        ComparisonOperator: 'GreaterThanThreshold',
        TreatMissingData: 'notBreaching',
        AlarmActions: [alerts],
      },
    };
  }
  for (const name of ['appointment', 'appointment_pe', 'appointment_cl', 'retry']) {
    resources[`${name.replaceAll('_', '')}Errors`] = {
      Type: 'AWS::CloudWatch::Alarm',
      Properties: {
        AlarmName: `${prefix}-${name}-errors`,
        Namespace: 'AWS/Lambda',
        MetricName: 'Errors',
        Dimensions: [{ Name: 'FunctionName', Value: `${prefix}-${name}` }],
        Statistic: 'Sum',
        Period: 60,
        EvaluationPeriods: 1,
        Threshold: 0,
        ComparisonOperator: 'GreaterThanThreshold',
        TreatMissingData: 'notBreaching',
        AlarmActions: [alerts],
      },
    };
  }
  resources.PendingAge = {
    Type: 'AWS::CloudWatch::Alarm',
    Properties: {
      AlarmName: `${prefix}-pending-publications`,
      Namespace: 'Rimac',
      MetricName: 'PendingAge',
      Statistic: 'Maximum',
      Period: 60,
      EvaluationPeriods: 2,
      Threshold: 300,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
      AlarmActions: [alerts],
    },
  };
  resources.PendingMetric = {
    Type: 'AWS::Logs::MetricFilter',
    DependsOn: 'RetryLogGroup',
    Properties: {
      LogGroupName: `/aws/lambda/${prefix}-retry`,
      FilterPattern: '{ $.pendingAge = * }',
      MetricTransformations: [
        { MetricNamespace: 'Rimac', MetricName: 'PendingAge', MetricValue: '$.pendingAge' },
      ],
    },
  };
  for (const group of [
    'AppointmentLogGroup',
    'AppointmentUnderscorepeLogGroup',
    'AppointmentUnderscoreclLogGroup',
  ]) {
    resources[`${group}HandledErrors`] = {
      Type: 'AWS::Logs::MetricFilter',
      Properties: {
        LogGroupName: { Ref: group },
        FilterPattern: '{ $.level = "ERROR" }',
        MetricTransformations: [
          { MetricNamespace: 'Rimac', MetricName: 'HandledErrors', MetricValue: '1' },
        ],
      },
    };
  }
  resources.HandledErrors = {
    Type: 'AWS::CloudWatch::Alarm',
    Properties: {
      AlarmName: `${prefix}-handled-errors`,
      Namespace: 'Rimac',
      MetricName: 'HandledErrors',
      Statistic: 'Sum',
      Period: 60,
      EvaluationPeriods: 1,
      Threshold: 0,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
      AlarmActions: [alerts],
    },
  };
  return resources;
}
