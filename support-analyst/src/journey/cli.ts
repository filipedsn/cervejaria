import { pathToFileURL } from 'node:url';
import { runJourney } from './run.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const journeyDir = process.env.SUPPORT_ANALYST_JOURNEY_DIR?.trim() || undefined;
  runJourney(process.argv.slice(2), { env: process.env, journeyDir }).then((code) => { process.exitCode = code; });
}
