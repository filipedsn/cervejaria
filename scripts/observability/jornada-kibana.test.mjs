import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildJourneyObjects,
  dashboardId,
  dataViewId,
  journeyRule,
  journeyRuleName,
  main,
  toNdjson,
} from './jornada-kibana.mjs';

test('buildJourneyObjects: data view, 3 buscas, 6 lens, mapa e dashboard por ambiente', () => {
  for (const env of ['dev', 'prd']) {
    const objects = buildJourneyObjects(env);
    const byType = (type) => objects.filter((object) => object.type === type);
    assert.equal(byType('index-pattern').length, 1);
    assert.equal(byType('index-pattern')[0].attributes.title, `logs-audit*.otel-${env}`);
    assert.equal(byType('search').length, 3);
    assert.equal(byType('lens').length, 6);
    assert.equal(byType('map').length, 1);
    assert.equal(byType('dashboard').length, 1);
    assert.ok(objects.every((object) => object.id.includes(`-${env}`)), 'ids nunca cruzam ambientes');
    const other = env === 'dev' ? 'prd' : 'dev';
    assert.ok(!JSON.stringify(objects).includes(`otel-${other}`), 'nenhuma referencia ao outro ambiente');
  }
});

test('buildJourneyObjects: toda referencia aponta para um objeto gerado', () => {
  const objects = buildJourneyObjects('dev');
  const ids = new Set(objects.map((object) => `${object.type}/${object.id}`));
  for (const object of objects) {
    for (const reference of object.references) {
      assert.ok(ids.has(`${reference.type}/${reference.id}`), `${object.id} -> ${reference.type}/${reference.id}`);
    }
  }
  const dashboard = objects.find((object) => object.id === dashboardId('dev'));
  const panels = JSON.parse(dashboard.attributes.panelsJSON);
  assert.equal(panels.length, dashboard.references.length);
  assert.deepEqual(panels.map((panel) => panel.panelRefName), dashboard.references.map((reference) => reference.name));
});

test('buildJourneyObjects: paineis usam os campos emitidos pela auditoria', () => {
  const serialized = JSON.stringify(buildJourneyObjects('dev'));
  for (const field of [
    'attributes.user.id', 'attributes.ui.route', 'attributes.ui.label', 'attributes.ui.vital.value',
    'attributes.ui.search.term', 'attributes.client.geo.location', 'attributes.client.geo.city_name',
  ]) {
    assert.ok(serialized.includes(field), field);
  }
  const map = buildJourneyObjects('dev').find((object) => object.type === 'map');
  const layers = JSON.parse(map.attributes.layerListJSON);
  assert.equal(layers.find((layer) => layer.id === 'cidades').sourceDescriptor.geoField, 'attributes.client.geo.location');
});

test('journeyRule: surto de ui.error agrupado por tela, sem acoes por padrao', () => {
  const rule = journeyRule('dev');
  assert.equal(rule.name, journeyRuleName('dev'));
  assert.equal(rule.name, 'quiver-tap-ui-error-surge-dev');
  assert.equal(rule.rule_type_id, '.es-query');
  assert.deepEqual(rule.params.index, ['logs-audit*.otel-dev']);
  assert.equal(rule.params.groupBy, 'top');
  assert.equal(rule.params.termField, 'attributes.ui.route');
  assert.equal(rule.params.timeWindowSize, 10);
  assert.deepEqual(rule.params.threshold, [5]);
  assert.match(rule.params.esQuery, /ui\.error/);
  assert.deepEqual(rule.actions, []);
  assert.ok(journeyRule('prd').tags.includes('production'));
  assert.deepEqual(journeyRule('dev', 9).params.threshold, [9]);
});

test('main: valida ambiente e argumentos; sem --write so imprime', () => {
  assert.throws(() => main(['--env', 'stg']), /--env dev ou --env prd/);
  assert.throws(() => main(['--env', 'dev', '--x']), /Argumento desconhecido/);
  const lines = [];
  main(['--env', 'dev'], { log: (line) => lines.push(line) });
  assert.equal(lines.length, 1);
  assert.equal(lines[0], toNdjson(buildJourneyObjects('dev')));
  assert.equal(dataViewId('dev'), 'quiver-tap-audit-dev');
  for (const line of lines[0].trim().split('\n')) JSON.parse(line);
});
