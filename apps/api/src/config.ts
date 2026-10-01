import { Logger } from '@aws-lambda-powertools/logger';

export const logger = new Logger({ serviceName: 'rimac', logLevel: 'INFO' });

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
}
