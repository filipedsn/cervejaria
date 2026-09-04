import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(here, 'server.mjs'), 'utf8');

test('cockpit expoe os estados decisorios no topo e conserva o fluxo de deploy', () => {
  for (const id of ['overviewProdDetail', 'overviewDevDetail', 'overviewCiDetail', 'overviewReleaseValue', 'globalState', 'btnPrepareRelease', 'releaseFlow']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Preparar release/);
  assert.match(app, /candidateDiffers/);
  assert.match(app, /ciState/);
  assert.match(app, /'FALHANDO'/);
  assert.match(app, /Migrations no deploy/);
  assert.match(app, /els\.releaseFlow\.hidden = true/);
  assert.match(app, /releaseStateForDisplay/);
  assert.match(app, /renderGlobalState/);
});

test('recovery continua dominante e impede que a acao normal seja protagonista', () => {
  assert.match(app, /recoveryActive \? 'RECOVERY'/);
  assert.match(app, /els\.prepareRelease\.hidden = recovery\.active/);
  assert.match(app, /if \(recovery\.active\) els\.releaseFlow\.hidden = true/);
});

test('servicos usam fonte local confiavel e preservam UNKNOWN quando ela falta', () => {
  for (const service of ['PostgreSQL', 'Alert Poller', 'Cloudflare']) {
    assert.match(app, new RegExp(`'${service}', serviceState`));
  }
  assert.match(html, /id="serviceList"/);
  assert.match(app, /service-group/);
  assert.match(app, /return ok === true \? 'OK' : ok === false \? 'OFFLINE' : 'UNKNOWN'/);
  assert.match(server, /http:\/\/127\.0\.0\.1:3098\/health/);
  assert.match(server, /postgres: \{ ok: prodReady\.ok \? true : null/);
  assert.match(server, /cloudflare: \{ ok: tunnelPid/);
});

test('navegacao e detalhes de investigacao reduzem a poluicao da visao geral', () => {
  assert.match(html, /class="section-nav"/);
  assert.match(html, /href="#releaseSection"/);
  assert.match(html, /id="terminalSection"/);
  assert.match(html, /id="logsSection"/);
  assert.match(app, /els\.terminalSection\.open = true/);
  assert.match(app, /releaseDetailsVisible/);
});

test('ledger e rollback seguem exibidos na area de release', () => {
  assert.match(html, /id="releaseHistory"/);
  assert.match(html, /id="btnRollback"/);
  assert.match(app, /history\.events\.slice\(0, 5\)/);
  assert.match(app, /RECOVERY_REQUIRED/);
});

test('home do Control Center tem shell, quatro cards e acoes existentes', () => {
  assert.match(html, /class="sidebar"/);
  assert.match(html, /QUVER TAP/);
  assert.match(html, /id="btnInvestigate"/);
  assert.match(html, /id="recentOperations"/);
  assert.match(html, /SEM DADOS/);
  assert.match(html, /data-quick-action="sync"/);
  assert.match(html, /data-quick-action="backup"/);
  assert.match(app, /home-control-grid/);
  assert.match(app, /renderRecentOperations/);
  assert.match(app, /actionMap/);
  assert.match(app, /Abrir recovery/);
  assert.match(app, /operational = \[/);
  assert.match(app, /saudaveis/);
});

test('observabilidade apresenta alertas sem expor configuracao Elastic ao navegador', () => {
  assert.match(server, /app\.get\('\/api\/alerts'/);
  assert.match(server, /readAlertsFromElastic/);
  assert.match(server, /OBS_ENV_FILE/);
  assert.match(html, /id="activeAlerts"/);
  assert.match(html, /id="pollerSemanticHealth"/);
  assert.match(app, /refreshAlerts/);
  assert.match(app, /Fonte indisponivel/);
  assert.doesNotMatch(app, /ELASTIC_API_KEY|ELASTIC_PASSWORD|Authorization/);
});
