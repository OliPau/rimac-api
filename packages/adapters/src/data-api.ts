import {
  RDSDataClient,
  ExecuteStatementCommand,
  BeginTransactionCommand,
  CommitTransactionCommand,
  RollbackTransactionCommand,
} from '@aws-sdk/client-rds-data';
import type { Database, Parameters, Sql } from './sql.js';

interface Connection {
  resourceArn: string;
  secretArn: string;
  database: string;
}

export class DataApi implements Database {
  constructor(
    private readonly client: RDSDataClient,
    private readonly connection: Connection,
  ) {}

  execute(sql: string, parameters: Parameters = {}) {
    return this.retry(() => this.statement(sql, parameters));
  }

  async transaction<T>(action: (sql: Sql) => Promise<T>): Promise<T> {
    return this.retry(async () => {
      const result = await this.client.send(new BeginTransactionCommand(this.connection));
      const transactionId = result.transactionId;
      if (!transactionId) {
        throw new Error('Missing SQL transaction');
      }
      try {
        const value = await action({
          execute: (sql, parameters = {}) => this.statement(sql, parameters, transactionId),
        });
        await this.client.send(new CommitTransactionCommand({ ...this.connection, transactionId }));
        return value;
      } catch (error) {
        try {
          await this.client.send(
            new RollbackTransactionCommand({ ...this.connection, transactionId }),
          );
        } catch {
          // The server can already have rolled back an expired transaction.
        }
        throw error;
      }
    });
  }

  private async statement(sql: string, parameters: Parameters, transactionId?: string) {
    const result = await this.client.send(
      new ExecuteStatementCommand({
        ...this.connection,
        sql,
        includeResultMetadata: true,
        ...(transactionId ? { transactionId } : {}),
        parameters: Object.entries(parameters).map(([name, value]) => ({
          name,
          value: typeof value === 'number' ? { longValue: value } : { stringValue: value },
        })),
      }),
    );
    return (result.records ?? []).map((record) => {
      const row: Record<string, unknown> = {};
      record.forEach((value, index) => {
        const column = result.columnMetadata?.[index];
        const name = column?.label || column?.name;
        if (!name) {
          throw new Error('Missing SQL column metadata');
        }
        row[name] = value.isNull
          ? null
          : (value.stringValue ?? value.longValue ?? value.booleanValue);
      });
      return row;
    });
  }

  private async retry<T>(action: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await action();
      } catch (error) {
        const transient =
          error instanceof Error &&
          [
            'DatabaseResumingException',
            'DatabaseUnavailableException',
            'ServiceUnavailableError',
            'InternalServerErrorException',
          ].includes(error.name);
        if (!transient || attempt >= 4) {
          throw error;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * 2 ** attempt + Math.random() * 500),
        );
      }
    }
  }
}
