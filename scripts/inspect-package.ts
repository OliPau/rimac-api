import { inspectPackages } from './packages.js';

await inspectPackages(process.argv[2] ?? '.serverless');
