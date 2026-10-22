import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

// Both npm start and the packaged launcher execute this before importing EDOT.
const environment = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const envFile = fileURLToPath(new URL(`../.env.${environment}`, import.meta.url));
if (environment === 'production' && process.env.PDV_ISOLATED_QA === '1') throw new Error('QA cannot bootstrap a production SDK');
if (existsSync(envFile) && process.env.PDV_ISOLATED_QA !== '1') {
  for (const key of Object.keys(process.env)) if (/^(OTEL_|ELASTIC_OTEL_)/.test(key)) delete process.env[key];
  Object.assign(process.env, parseEnv(readFileSync(envFile, 'utf8')));
}
process.env.NODE_ENV = environment;
const sha = /^[a-f0-9]{7,40}$/i.test(process.env.RELEASE_SHA ?? '')
  ? process.env.RELEASE_SHA.toLowerCase() : environment === 'production' ? 'unknown' : 'dev';
const namespace = environment === 'production' ? 'prd' : 'dev';
process.env.OTEL_SERVICE_NAME = environment === 'production' ? 'quiver-tap-api' : 'quiver-tap-api-dev';
process.env.OTEL_RESOURCE_ATTRIBUTES = [
  `service.name=${process.env.OTEL_SERVICE_NAME}`, `service.version=${sha}`,
  `deployment.environment.name=${environment}`, `data_stream.namespace=${namespace}`,
].join(',');
// No host/process/OS/cloud metadata or inherited resource attributes.
process.env.OTEL_NODE_RESOURCE_DETECTORS = 'env,serviceinstance';
process.env.OTEL_TRACES_EXPORTER = 'otlp';
process.env.OTEL_METRICS_EXPORTER = 'otlp';
process.env.OTEL_LOGS_EXPORTER = 'otlp';
process.env.OTEL_SDK_DISABLED = 'false';
delete process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS;
delete process.env.OTEL_NODE_DISABLED_INSTRUMENTATIONS;
// EDOT deliberately disables framework log export unless explicitly opted in.
process.env.ELASTIC_OTEL_NODE_ENABLE_LOG_SENDING = 'true';
process.env.OTEL_LOG_LEVEL = 'warn';
process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE = 'delta';
