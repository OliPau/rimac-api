import { z } from 'zod';

export const project = {
  service: 'rimac',
  stage: 'demo',
  region: 'us-east-1',
} as const;

export const prefix = `${project.service}-${project.stage}`;
export const stacks = {
  application: prefix,
  data: `${project.service}-data-${project.stage}`,
  cost: `${project.service}-cost-${project.stage}`,
  github: `${project.service}-github`,
};

export const infrastructureParameters = [
  { ParameterKey: 'ProjectName', ParameterValue: project.service },
  { ParameterKey: 'Stage', ParameterValue: project.stage },
];

export function resource(name: string): string {
  return `${prefix}-${name}`;
}

const account = z
  .string()
  .regex(/^\d{12}$/)
  .refine((value) => value !== '000000000000');
const cluster = z.string().regex(/^arn:aws:rds:[a-z0-9-]+:\d{12}:cluster:[\w-]+$/);
const secret = z.string().regex(/^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:[\w/+=.@-]+$/);
export const deployment = z.object({
  account,
  cluster,
  secrets: z.object({ PE: secret, CL: secret }),
  swaggerSecret: secret,
});
export type Deployment = z.infer<typeof deployment>;

export function localDeployment(): Deployment {
  return {
    account: '000000000000',
    cluster: `arn:aws:rds:${project.region}:000000000000:cluster:${prefix}`,
    swaggerSecret: `arn:aws:secretsmanager:${project.region}:000000000000:secret:rimac/demo/swagger-local`,
    secrets: {
      PE: `arn:aws:secretsmanager:${project.region}:000000000000:secret:rimac/demo/pe-local`,
      CL: `arn:aws:secretsmanager:${project.region}:000000000000:secret:rimac/demo/cl-local`,
    },
  };
}
