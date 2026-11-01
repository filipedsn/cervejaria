#!/usr/bin/env node
// Gera os saved objects da jornada do usuario (TAP-160) por ambiente.
// Uso: node scripts/observability/jornada-kibana.mjs --env dev|prd [--write]
//   sem --write imprime o NDJSON; com --write grava deploy/observability/kibana-jornada-dashboard-<env>.ndjson
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIGRATION = { coreMigrationVersion: '8.8.0' };
const UI_EVENTS = 'attributes.event.action : ui.*';

export function dataViewId(env) {
  return `quiver-tap-audit-${env}`;
}

export function dashboardId(env) {
  return `quiver-tap-jornada-${env}`;
}

function assertEnv(env) {
  if (env !== 'dev' && env !== 'prd') throw new Error('Use --env dev ou --env prd');
}

function dataView(env) {
  return {
    type: 'index-pattern',
    id: dataViewId(env),
    attributes: {
      title: `logs-audit*.otel-${env}`,
      name: `Quiver Tap Jornada ${env.toUpperCase()}`,
      timeFieldName: '@timestamp',
    },
    references: [],
    typeMigrationVersion: '8.0.0',
    ...MIGRATION,
  };
}

export const JOURNEY_COLUMNS = [
  'attributes.user.name', 'attributes.event.action', 'attributes.ui.route', 'attributes.ui.label',
  'attributes.http.route', 'attributes.http.response.status_code', 'attributes.client.geo.city_name',
  'attributes.client.address', 'attributes.user_agent.name',
];

function savedSearch(env, slug, title, description, query, columns) {
  return {
    type: 'search',
    id: `quiver-tap-jornada-${env}-${slug}`,
    attributes: {
      title,
      description,
      columns,
      sort: [['@timestamp', 'desc']],
      kibanaSavedObjectMeta: {
        searchSourceJSON: JSON.stringify({
          query: { language: 'kuery', query },
          filter: [],
          indexRefName: 'kibanaSavedObjectMeta.searchSourceJSON.index',
        }),
      },
    },
    references: [{ id: dataViewId(env), name: 'kibanaSavedObjectMeta.searchSourceJSON.index', type: 'index-pattern' }],
    typeMigrationVersion: '10.5.0',
    ...MIGRATION,
  };
}

function terms(label, field, size, orderColumn) {
  return {
    label, dataType: 'string', operationType: 'terms', sourceField: field, isBucketed: true,
    params: { size, orderBy: { type: 'column', columnId: orderColumn }, orderDirection: 'desc', otherBucket: true, missingBucket: false },
  };
}

const count = (label) => ({ label, dataType: 'number', operationType: 'count', sourceField: '___records___', isBucketed: false });

function lens(env, slug, title, query, columns, visualizationType, visualization) {
  return {
    type: 'lens',
    id: `quiver-tap-jornada-${env}-${slug}`,
    attributes: {
      title,
      visualizationType,
      state: {
        datasourceStates: {
          formBased: { layers: { l1: { columnOrder: Object.keys(columns), columns, incompleteColumns: {} } } },
        },
        visualization,
        query: { language: 'kuery', query },
        filters: [],
        adHocDataViews: {},
        internalReferences: [],
      },
    },
    references: [{ type: 'index-pattern', id: dataViewId(env), name: 'indexpattern-datasource-layer-l1' }],
    typeMigrationVersion: '8.9.0',
    ...MIGRATION,
  };
}

function horizontalBars(env, slug, title, query, field, fieldLabel, size) {
  return lens(env, slug, title, query, { c1: terms(fieldLabel, field, size, 'c2'), c2: count('Eventos') }, 'lnsXY', {
    preferredSeriesType: 'bar_horizontal',
    legend: { isVisible: false, position: 'right' },
    valueLabels: 'show',
    layers: [{ layerId: 'l1', layerType: 'data', seriesType: 'bar_horizontal', xAccessor: 'c1', accessors: ['c2'] }],
  });
}

function table(env, slug, title, query, columns) {
  return lens(env, slug, title, query, columns, 'lnsDatatable', {
    layerId: 'l1',
    layerType: 'data',
    columns: Object.keys(columns).map((columnId) => ({ columnId })),
  });
}

function cityMap(env) {
  const layers = [
    { id: 'basemap', type: 'EMS_VECTOR_TILE', sourceDescriptor: { type: 'EMS_TMS', isAutoSelect: true, lightModeDefault: 'road_map_desaturated' }, visible: true, alpha: 1, minZoom: 0, maxZoom: 24, label: null, style: { type: 'EMS_VECTOR_TILE' }, includeInFitToBounds: true },
    {
      id: 'cidades',
      type: 'GEOJSON_VECTOR',
      label: 'Eventos por local',
      visible: true,
      alpha: 0.85,
      minZoom: 0,
      maxZoom: 24,
      includeInFitToBounds: true,
      sourceDescriptor: {
        type: 'ES_GEO_GRID',
        id: 'cidades-source',
        geoField: 'attributes.client.geo.location',
        requestType: 'point',
        resolution: 'COARSE',
        metrics: [{ type: 'count' }],
        applyGlobalQuery: true,
        applyGlobalTime: true,
        applyForceRefresh: true,
        indexPatternRefName: 'layer_1_source_index_pattern',
      },
      style: {
        type: 'VECTOR',
        properties: {
          fillColor: { type: 'STATIC', options: { color: '#E7664C' } },
          lineColor: { type: 'STATIC', options: { color: '#FFFFFF' } },
          lineWidth: { type: 'STATIC', options: { size: 1 } },
          iconSize: { type: 'DYNAMIC', options: { minSize: 6, maxSize: 32, field: { name: 'doc_count', origin: 'source' }, fieldMetaOptions: { isEnabled: true, sigma: 3 } } },
          labelText: { type: 'DYNAMIC', options: { field: { name: 'doc_count', origin: 'source' } } },
        },
        isTimeAware: true,
      },
    },
  ];
  return {
    type: 'map',
    id: `quiver-tap-jornada-${env}-mapa`,
    attributes: {
      title: `Jornada ${env.toUpperCase()} - Onde (mapa)`,
      description: 'Eventos por localizacao aproximada (GeoIP do IP do cliente)',
      mapStateJSON: JSON.stringify({ zoom: 3, center: { lon: -50, lat: -15 }, timeFilters: { from: 'now-24h', to: 'now' }, refreshConfig: { isPaused: true, interval: 0 }, query: { query: '', language: 'kuery' }, filters: [], settings: { autoFitToDataBounds: true } }),
      layerListJSON: JSON.stringify(layers),
      uiStateJSON: JSON.stringify({ isLayerTOCOpen: true, openTOCDetails: [] }),
    },
    references: [{ name: 'layer_1_source_index_pattern', type: 'index-pattern', id: dataViewId(env) }],
    typeMigrationVersion: '8.4.0',
    ...MIGRATION,
  };
}

export function journeyRuleName(env) {
  return `quiver-tap-ui-error-surge-${env}`;
}

/** .es-query: more than `threshold` ui.error events per screen within 10 minutes. */
export function journeyRule(env, threshold = 5) {
  assertEnv(env);
  return {
    name: journeyRuleName(env),
    tags: ['quiver-tap', 'TAP-160', env === 'prd' ? 'production' : 'development', 'functional'],
    rule_type_id: '.es-query',
    consumer: 'stackAlerts',
    schedule: { interval: '5m' },
    enabled: true,
    params: {
      index: [`logs-audit*.otel-${env}`],
      timeField: '@timestamp',
      esQuery: JSON.stringify({ query: { bool: { filter: [{ term: { 'attributes.event.action': 'ui.error' } }] } } }),
      size: 10,
      timeWindowSize: 10,
      timeWindowUnit: 'm',
      thresholdComparator: '>',
      threshold: [threshold],
      aggType: 'count',
      groupBy: 'top',
      termField: 'attributes.ui.route',
      termSize: 10,
      searchType: 'esQuery',
      excludeHitsFromPreviousRun: false,
    },
    actions: [],
    notify_when: 'onActionGroupChange',
  };
}

export function buildJourneyObjects(env) {
  assertEnv(env);
  const E = env.toUpperCase();
  const searches = [
    savedSearch(env, 'por-usuario', `Jornada por usuario ${E}`, 'Quem fez o que, onde: filtre por attributes.user.name ou attributes.session.id', 'attributes.event.category : audit', JOURNEY_COLUMNS),
    savedSearch(env, 'erros', `Erros de interface ${E}`, 'ui.error com mensagem, tipo e dispositivo', 'attributes.event.action : "ui.error"', ['attributes.user.name', 'attributes.ui.route', 'attributes.error.message', 'attributes.error.type', 'attributes.user_agent.name', 'attributes.client.geo.city_name']),
    savedSearch(env, 'buscas', `Buscas ${E}`, 'Termos digitados em campos de busca', 'attributes.event.action : "ui.search"', ['attributes.user.name', 'attributes.ui.route', 'attributes.ui.search.term', 'attributes.client.geo.city_name']),
  ];
  const visualizations = [
    horizontalBars(env, 'eventos-por-tela', `Jornada ${E} - Eventos por tela`, UI_EVENTS, 'attributes.ui.route', 'Tela', 15),
    table(env, 'top-acoes', `Jornada ${E} - Top acoes`, 'attributes.event.action : ("ui.click" or "ui.submit")', {
      c1: terms('Acao', 'attributes.ui.label', 20, 'c2'), c2: count('Vezes'),
    }),
    horizontalBars(env, 'erros-por-tela', `Jornada ${E} - Erros por tela`, 'attributes.event.action : "ui.error"', 'attributes.ui.route', 'Tela', 10),
    lens(env, 'usuarios-ativos', `Jornada ${E} - Usuarios ativos`, 'attributes.user.id : *', {
      c1: { label: 'Usuarios ativos', dataType: 'number', operationType: 'unique_count', sourceField: 'attributes.user.id', isBucketed: false },
    }, 'lnsMetric', { layerId: 'l1', layerType: 'data', metricAccessor: 'c1' }),
    table(env, 'web-vitals-p75', `Jornada ${E} - Web vitals p75 por tela`, 'attributes.event.action : "ui.web_vital"', {
      c1: terms('Tela', 'attributes.ui.route', 20, 'c3'),
      c2: terms('Metrica', 'attributes.ui.vital.name', 5, 'c3'),
      c3: { label: 'p75', dataType: 'number', operationType: 'percentile', sourceField: 'attributes.ui.vital.value', isBucketed: false, params: { percentile: 75 } },
    }),
    horizontalBars(env, 'eventos-por-cidade', `Jornada ${E} - Eventos por cidade`, 'attributes.client.geo.city_name : *', 'attributes.client.geo.city_name', 'Cidade', 15),
  ];
  const map = cityMap(env);
  const panels = [
    { ref: visualizations[3], type: 'lens', grid: { x: 0, y: 0, w: 12, h: 8 } },
    { ref: visualizations[0], type: 'lens', grid: { x: 12, y: 0, w: 18, h: 16 } },
    { ref: visualizations[1], type: 'lens', grid: { x: 30, y: 0, w: 18, h: 16 } },
    { ref: visualizations[2], type: 'lens', grid: { x: 0, y: 8, w: 12, h: 16 } },
    { ref: map, type: 'map', grid: { x: 0, y: 24, w: 30, h: 18 } },
    { ref: visualizations[5], type: 'lens', grid: { x: 30, y: 24, w: 18, h: 18 } },
    { ref: visualizations[4], type: 'lens', grid: { x: 0, y: 42, w: 48, h: 14 } },
    { ref: searches[0], type: 'search', grid: { x: 0, y: 56, w: 48, h: 20 } },
  ];
  const dashboard = {
    type: 'dashboard',
    id: dashboardId(env),
    attributes: {
      title: `Jornada do usuario - quem, o que, onde (${E})`,
      description: 'TAP-160: telas, acoes, buscas, erros, web vitals e local aproximado por usuario e sessao',
      panelsJSON: JSON.stringify(panels.map((panel, index) => ({
        type: panel.type,
        gridData: { ...panel.grid, i: String(index + 1) },
        panelIndex: String(index + 1),
        embeddableConfig: {},
        panelRefName: `panel_${index + 1}`,
      }))),
      optionsJSON: JSON.stringify({ useMargins: true, syncColors: false, syncCursor: true, syncTooltips: false, hidePanelTitles: false }),
      timeRestore: true,
      timeFrom: 'now-24h',
      timeTo: 'now',
      kibanaSavedObjectMeta: { searchSourceJSON: JSON.stringify({ query: { query: '', language: 'kuery' }, filter: [] }) },
    },
    references: panels.map((panel, index) => ({ name: `panel_${index + 1}`, type: panel.type, id: panel.ref.id })),
    typeMigrationVersion: '10.2.0',
    ...MIGRATION,
  };
  return [dataView(env), ...searches, ...visualizations, map, dashboard];
}

export function toNdjson(objects) {
  return `${objects.map((object) => JSON.stringify(object)).join('\n')}\n`;
}

export function ndjsonPath(env) {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'deploy', 'observability', `kibana-jornada-dashboard-${env}.ndjson`);
}

export function rulePath(env) {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'deploy', 'observability', `kibana-alert-ui-error-surge-${env}.json`);
}

export function main(argv, { log = console.log } = {}) {
  let env;
  let write = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--env') { env = argv[i + 1]; i += 1; }
    else if (argv[i] === '--write') write = true;
    else throw new Error(`Argumento desconhecido: ${argv[i]}`);
  }
  assertEnv(env);
  const ndjson = toNdjson(buildJourneyObjects(env));
  if (!write) { log(ndjson); return; }
  writeFileSync(ndjsonPath(env), ndjson);
  writeFileSync(rulePath(env), `${JSON.stringify(journeyRule(env), null, 2)}\n`);
  log(`Gravados ${ndjsonPath(env)} e ${rulePath(env)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
