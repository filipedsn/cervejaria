import { assertQaEnvironment as assertFromMjs } from './guard.mjs';

export function assertQaEnvironment(opts?: { apiBase?: string; databaseUrl?: string }) {
  assertFromMjs(opts);
}
