import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { handleSwagger } from '../composition/swagger.js';
import { logger } from '../composition/config.js';

export function handler(event: APIGatewayProxyEventV2, context: Context) {
  logger.addContext(context);
  return handleSwagger(event);
}
