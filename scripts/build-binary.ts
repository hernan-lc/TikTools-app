import { buildBinary } from './build-lib.ts';

await buildBinary(process.argv.slice(2));
