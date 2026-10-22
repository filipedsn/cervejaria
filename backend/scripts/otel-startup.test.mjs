import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

for (const environment of ['production', 'development']) {
  test(`preload establishes ${environment} identity before SDK import`, () => {
    const result = spawnSync(process.execPath, ['--import', './scripts/otel-resource-policy.mjs', '--eval',
      'console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith("OTEL_")))))'], {
      cwd: import.meta.dirname + '/..', encoding: 'utf8',
      env: { ...process.env, NODE_ENV: environment, RELEASE_SHA: 'a'.repeat(40), OTEL_SERVICE_NAME: 'wrong-inherited-service',
        OTEL_SDK_DISABLED: 'true', OTEL_NODE_DISABLED_INSTRUMENTATIONS: 'pino',
        OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment.name=wrong,data_stream.namespace=wrong,host.name=private' },
    });
    assert.equal(result.status, 0, result.stderr);
    const env = JSON.parse(result.stdout.trim());
    assert.equal(env.OTEL_SERVICE_NAME, environment === 'production' ? 'quiver-tap-api' : 'quiver-tap-api-dev');
    assert.match(env.OTEL_RESOURCE_ATTRIBUTES, new RegExp(`deployment.environment.name=${environment}`));
    assert.match(env.OTEL_RESOURCE_ATTRIBUTES, new RegExp(`data_stream.namespace=${environment === 'production' ? 'prd' : 'dev'}`));
    assert.match(env.OTEL_RESOURCE_ATTRIBUTES, /service.version=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
    assert.doesNotMatch(env.OTEL_RESOURCE_ATTRIBUTES, /wrong|host.name/);
    assert.equal(env.OTEL_NODE_RESOURCE_DETECTORS, 'env,serviceinstance');
    assert.equal(env.OTEL_SDK_DISABLED, 'false');
    assert.equal(env.OTEL_NODE_DISABLED_INSTRUMENTATIONS, undefined);
  });
}
