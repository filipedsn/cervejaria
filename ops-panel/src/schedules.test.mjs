import assert from 'node:assert/strict';
import { test } from 'node:test';
import { schedulesView } from './infra.mjs';
import {
  brtHourToUtc,
  pad2,
  SCHEDULE_IDS,
  scheduleTimeText,
  TIME_RE,
  utcHourToBrt,
} from './schedules.mjs';

test('BRT ↔ UTC: 01:00 BRT = 04:00 UTC; 02:23 BRT = 05:23 UTC', () => {
  assert.equal(brtHourToUtc(1), 4);
  assert.equal(utcHourToBrt(4), 1);
  assert.equal(brtHourToUtc(2), 5);
  assert.equal(utcHourToBrt(5), 2);
  assert.equal(brtHourToUtc(22), 1);
  assert.equal(utcHourToBrt(1), 22);
});

test('scheduleTimeText: diário, semanal e a cada minuto', () => {
  assert.equal(scheduleTimeText({ minute: '0', hour: '4', dow: '*' }), 'diário às 01:00');
  assert.equal(scheduleTimeText({ minute: '23', hour: '5', dow: '*' }), 'diário às 02:23');
  assert.equal(scheduleTimeText({ minute: '0', hour: '7', dow: '3' }), 'toda quarta às 04:00');
  assert.equal(scheduleTimeText({ minute: '*', hour: '*', dow: '*' }), 'a cada minuto');
});

test('TIME_RE aceita HH:MM válido', () => {
  assert.ok(TIME_RE.test('00:00'));
  assert.ok(TIME_RE.test('23:59'));
  assert.ok(TIME_RE.test('01:00'));
  assert.equal(TIME_RE.test('24:00'), false);
  assert.equal(TIME_RE.test('1:00'), false);
  assert.equal(TIME_RE.test('01:60'), false);
});

test('schedulesView: catálogo completo, BRT e travas de manage', () => {
  const report = {
    schedules: [
      { id: 'quiver-tap-backup', enabled: true, present: true, minute: '0', hour: '4', dow: '*' },
      { id: 'docker-image-prune', enabled: true, present: true, minute: '23', hour: '5', dow: '*' },
      { id: 'docker-builder-prune', enabled: false, present: true, minute: '0', hour: '7', dow: '3' },
      { id: 'quiver-tap-docker-state', enabled: true, present: true, minute: '*', hour: '*', dow: '*' },
    ],
  };
  const view = schedulesView(report, { manage: true });
  assert.equal(view.items.length, SCHEDULE_IDS.length);
  assert.equal(view.summary, '3 de 4 ligados');
  const backup = view.items.find((s) => s.id === 'quiver-tap-backup');
  assert.equal(backup.brtTime, '01:00');
  assert.equal(backup.timeText, 'diário às 01:00');
  assert.equal(backup.canDisable, true);
  assert.equal(backup.canSetTime, true);
  assert.ok(backup.warnDisable);
  const state = view.items.find((s) => s.id === 'quiver-tap-docker-state');
  assert.equal(state.canSetTime, false);
  assert.equal(state.timeText, 'a cada minuto');
  const builder = view.items.find((s) => s.id === 'docker-builder-prune');
  assert.equal(builder.canEnable, true);
  assert.equal(builder.canDisable, false);
  assert.equal(builder.timeText, 'toda quarta às 04:00');

  const readOnly = schedulesView(report);
  assert.equal(readOnly.manage, false);
  assert.equal(readOnly.items[0].canDisable, false);
  assert.equal(readOnly.items[0].canSetTime, false);
});

test('schedulesView: relatório antigo sem schedules não mostra a seção', () => {
  assert.equal(schedulesView({ backups: [] }), null);
});

test('pad2', () => {
  assert.equal(pad2(0), '00');
  assert.equal(pad2(9), '09');
  assert.equal(pad2(23), '23');
});
