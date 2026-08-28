import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePlatformSettings } from './system-config.js';

test('parsePlatformSettings validates stored JSON and preserves defaults for partial data', () => {
  const settings = parsePlatformSettings({
    appUrl: 'https://example.test',
    smtp: { enabled: true, host: 'smtp.example.test', port: 465, secure: true, user: 'alerts', from: 'Alertas <alerts@example.test>', passEnc: 'encrypted' },
    backup: { enabled: false, retentionDays: 7, scheduleHour: 4 },
  });

  if (!settings) throw new Error('valid settings should parse');
  assert.equal(settings.appUrl, 'https://example.test');
  assert.equal(settings.smtp.passEnc, 'encrypted');
  assert.equal(settings.backup.retentionDays, 7);

  const partial = parsePlatformSettings({ smtp: { host: 'smtp.example.test' } });
  if (!partial) throw new Error('partial settings should parse');
  assert.equal(partial.smtp.host, 'smtp.example.test');
  assert.equal(partial.smtp.port, 587);
  assert.equal(parsePlatformSettings(['invalid']), null);
});
