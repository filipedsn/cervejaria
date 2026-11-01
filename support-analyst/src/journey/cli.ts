import { pathToFileURL } from 'node:url';
import { runJourney } from './run.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runJourney(process.argv.slice(2), { env: process.env }).then((code) => { process.exitCode = code; });
}
