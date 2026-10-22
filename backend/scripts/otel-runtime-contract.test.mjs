import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { createServer as createPortServer } from 'node:net';

test('SDK exports actual sanitized Pino, audit exactly once, traces and runtime/business metrics', { timeout: 30_000 }, async () => {
  const received = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    let bytes = Buffer.concat(chunks); if (req.headers['content-encoding'] === 'gzip') bytes = gunzipSync(bytes);
    received.push({ path: req.url, body: JSON.parse(bytes.toString()) });
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:OTEL_|ELASTIC_OTEL_)/.test(key)));
  Object.assign(env, { NODE_ENV: 'development', RELEASE_SHA: 'b'.repeat(40), OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    PDV_ISOLATED_QA: '1',
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${server.address().port}`, OTEL_METRIC_EXPORT_INTERVAL: '200', LOG_LEVEL: 'info' });
  const preload = process.env.TAP96_TEST_BASELINE === '1' ? '@elastic/opentelemetry-node' : './scripts/otel-sdk.mjs';
  const code = `
    import { logger } from './src/lib/logger.ts';
    import { emitAuditEvent } from './src/lib/audit/emit-audit-event.ts';
    import { recordTransacaoMetric } from './src/lib/business-metrics.ts';
    import { trace } from '@opentelemetry/api';
    import { emitTechnicalTelemetry } from './src/lib/technical-telemetry-logger.ts';
    for (const level of ['info','warn','error']) logger[level]({ authorization:'synthetic-private-marker' }, 'tap96.safe.'+level);
    emitAuditEvent({ action:'tap96.audit.once', message:'safe synthetic audit', metadata:{ accessToken:'synthetic-private-marker' } });
    emitTechnicalTelemetry({ action:'technical_telemetry_probe', probeId:'safe-contract-probe' });
    recordTransacaoMetric('COMANDA_CRIADA','success','qa-contract');
    trace.getTracer('tap96-contract').startSpan('tap96.safe.trace').end();
    await new Promise(r=>setTimeout(r,700));
    if(globalThis[Symbol.for('quiver.otel.sdk')]) await globalThis[Symbol.for('quiver.otel.sdk')].shutdown();
    else process.exitCode=0;
  `;
  let stdout = '', stderr = '';
  try {
    const child = spawn(process.execPath, ['--import', '../scripts/node24-tsx-host.mjs', '--import', 'tsx', '--import', preload, '--input-type=module', '-e', code],
      { cwd: import.meta.dirname + '/..', env, windowsHide: true });
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    const timeout = setTimeout(() => child.kill(), 20_000);
    const status = await new Promise(resolve => child.once('exit', resolve)); clearTimeout(timeout);
    assert.equal(status, 0, stderr);
    const logs = received.flatMap(r => r.body.resourceLogs ?? []).flatMap(r => r.scopeLogs ?? []).flatMap(s => s.logRecords ?? []);
    for (const level of ['info', 'warn', 'error']) assert.equal(logs.filter(r => r.body?.stringValue === `tap96.safe.${level}`).length, 1, `actual Pino ${level}`);
    assert.equal(logs.filter(r => r.attributes?.some(a => a.key === 'event.action' && a.value.stringValue === 'tap96.audit.once')).length, 1);
    assert.doesNotMatch(stdout + JSON.stringify(received), /synthetic-private-marker/);
    const names = received.flatMap(r => r.body.resourceMetrics ?? []).flatMap(r => r.scopeMetrics ?? []).flatMap(s => s.metrics ?? []).map(m => m.name);
    assert.ok(names.includes('quiver.transacao.total'), 'business metrics provider');
    assert.ok(names.some(n => /process|nodejs|v8|eventloop/.test(n)), 'runtime metrics provider');
    assert.ok(received.some(r => r.path === '/v1/traces'), 'trace exporter');
    for (const request of received) {
      for (const resource of request.body.resourceLogs ?? request.body.resourceMetrics ?? request.body.resourceSpans ?? []) {
        const attrs = Object.fromEntries(resource.resource.attributes.map(a => [a.key, a.value.stringValue]));
        assert.equal(attrs['service.name'], 'quiver-tap-api-dev');
        assert.equal(attrs['service.version'], 'b'.repeat(40));
        assert.equal(attrs['data_stream.namespace'], 'dev');
        assert.equal(attrs['deployment.environment.name'], 'development');
        assert.ok(attrs['service.instance.id']);
        assert.ok(!Object.keys(attrs).some(k => /^(host|process|os|cloud|container)\./.test(k)));
      }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('real API DEV stop drains HTTP and flushes SDK providers before process exit', { timeout: 30_000 }, async () => {
  const received = [];
  const receiver = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    let bytes = Buffer.concat(chunks); if (req.headers['content-encoding'] === 'gzip') bytes = gunzipSync(bytes);
    received.push({ path: req.url, body: JSON.parse(bytes.toString()) });
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}');
  });
  await new Promise(resolve => receiver.listen(0, '127.0.0.1', resolve));
  const reservation = createPortServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const token = randomBytes(16).toString('hex');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(?:OTEL_|ELASTIC_OTEL_|PROD)/.test(k)));
  Object.assign(env, { NODE_ENV: 'development', PDV_ISOLATED_QA: '1', PORT: String(port), HOST: '127.0.0.1', RELEASE_SHA: 'd'.repeat(40),
    DATABASE_URL: 'postgresql://qa:qa@127.0.0.1:55449/cervejaria_qa_pdv_unico', QA_DATABASE_URL: 'postgresql://qa:qa@127.0.0.1:55449/cervejaria_qa_pdv_unico',
    JWT_SECRET: randomBytes(32).toString('hex'), QUIVER_DEV_SHUTDOWN_TOKEN: token, OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${receiver.address().port}`, OTEL_METRIC_EXPORT_INTERVAL: '60000', LOG_LEVEL: 'info' });
  const child = spawn(process.execPath, ['--import', '../scripts/node24-tsx-host.mjs', '--import', 'tsx', '--import', './scripts/otel-sdk.mjs', 'src/index.ts'],
    { cwd: import.meta.dirname + '/..', env, windowsHide: true });
  let output = '';
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const timeout = setTimeout(() => child.kill(), 20_000);
  try {
    for (let i = 0; ; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) break; } catch {}
      if (i > 60) throw new Error('isolated API did not start');
      await new Promise(r => setTimeout(r, 100));
    }
    const response = await fetch(`http://127.0.0.1:${port}/api/_dev/shutdown`, { method: 'POST', headers: { 'x-quiver-dev-shutdown-token': token } });
    assert.equal(response.status, 202);
    assert.equal(await exited, 0);
    assert.ok(received.some(r => r.path === '/v1/logs'), 'final Pino logs flushed');
    assert.ok(received.some(r => r.path === '/v1/metrics'), 'runtime provider flushed before first periodic interval');
    assert.ok(received.some(r => r.path === '/v1/traces'), 'HTTP spans flushed');
    assert.doesNotMatch(output + JSON.stringify(received), new RegExp(token));
  } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill(); await new Promise(resolve => receiver.close(resolve)); }
});
