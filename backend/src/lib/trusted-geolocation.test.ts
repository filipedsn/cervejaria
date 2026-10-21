import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticatedEdgeGeoCountry, trustedGeoCountry, trustedGeoCountryForRequest, trustedProxyAddressesFromEnv } from './trusted-geolocation.js';

test('ignores spoofed Cloudflare headers when the immediate peer is not trusted', () => {
  assert.deepEqual(trustedGeoCountry({
    remoteAddress: '127.0.0.1',
    cfConnectingIp: '198.51.100.25',
    cfIpCountry: 'BR',
  }), { countryCode: null, source: 'unknown' });
});

test('uses country only when a trusted IPv4 proxy supplies a valid client IP', () => {
  assert.deepEqual(trustedGeoCountry({
    remoteAddress: '192.0.2.10',
    trustedProxyAddresses: ['192.0.2.10'],
    cfConnectingIp: '198.51.100.25',
    cfIpCountry: 'br',
  }), { countryCode: 'BR', source: 'trusted-proxy' });
});

test('normalizes IPv4-mapped IPv6 peer addresses without trusting other IPv6 peers', () => {
  assert.deepEqual(trustedGeoCountry({
    remoteAddress: '::ffff:192.0.2.10',
    trustedProxyAddresses: ['192.0.2.10'],
    cfConnectingIp: '2001:db8::5',
    cfIpCountry: 'PT',
  }), { countryCode: 'PT', source: 'trusted-proxy' });
  assert.deepEqual(trustedGeoCountry({
    remoteAddress: '2001:db8::10',
    trustedProxyAddresses: ['2001:db8::11'],
    cfConnectingIp: '2001:db8::5',
    cfIpCountry: 'PT',
  }), { countryCode: null, source: 'unknown' });
});

test('returns unknown for malformed client IP and Cloudflare unknown-country markers', () => {
  const trustedProxyAddresses = ['192.0.2.10'];
  assert.deepEqual(trustedGeoCountry({ remoteAddress: '192.0.2.10', trustedProxyAddresses, cfConnectingIp: 'spoofed', cfIpCountry: 'BR' }), { countryCode: null, source: 'unknown' });
  assert.deepEqual(trustedGeoCountry({ remoteAddress: '192.0.2.10', trustedProxyAddresses, cfConnectingIp: '198.51.100.25', cfIpCountry: 'XX' }), { countryCode: null, source: 'unknown' });
});

test('request adapter uses only exact trusted peers and keeps only country metadata', () => {
  assert.deepEqual(trustedGeoCountryForRequest({
    remoteAddress: '127.0.0.1',
    headers: { 'cf-connecting-ip': '198.51.100.9', 'cf-ipcountry': 'BR' },
    trustedProxyAddresses: ['192.0.2.8'],
  }), { countryCode: null, source: 'unknown' });
  assert.deepEqual(trustedGeoCountryForRequest({
    remoteAddress: '192.0.2.8',
    headers: { 'cf-connecting-ip': '198.51.100.9', 'cf-ipcountry': 'br' },
    trustedProxyAddresses: ['192.0.2.8'],
  }), { countryCode: 'BR', source: 'trusted-proxy' });
  assert.deepEqual(trustedGeoCountryForRequest({
    remoteAddress: '192.0.2.8',
    headers: { 'cf-connecting-ip': ['198.51.100.9'], 'cf-ipcountry': 'BR' },
    trustedProxyAddresses: ['192.0.2.8'],
  }), { countryCode: null, source: 'unknown' });
});

test('trusted proxy configuration is empty by default and accepts exact addresses only', () => {
  assert.deepEqual(trustedProxyAddressesFromEnv(' 192.0.2.8, ,2001:db8::8 '), ['192.0.2.8', '2001:db8::8']);
  assert.deepEqual(trustedProxyAddressesFromEnv(''), []);
});

test('DEV authenticated country rejects forged, duplicate and disabled inputs without retaining credentials', () => {
  const token = 'synthetic-test-only-'.padEnd(64, 'x');
  const valid = { mode: 'authenticated-edge-dev', environment: 'development', expectedToken: token, providedToken: token, country: 'br' };
  assert.deepEqual(authenticatedEdgeGeoCountry(valid), { countryCode: 'BR', source: 'authenticated-edge' });
  for (const change of [
    { mode: undefined }, { environment: 'production' }, { expectedToken: undefined },
    { expectedToken: 'short' }, { providedToken: 'f'.repeat(64) }, { providedToken: `${token}, ${token}` },
    { providedToken: [token, token] }, { country: ['BR', 'US'] },
    { country: 'BR, US' }, { country: 'XX' }, { country: 'T1' },
  ]) {
    assert.deepEqual(authenticatedEdgeGeoCountry({ ...valid, ...change }), { countryCode: null, source: 'unknown' });
  }
  assert.doesNotMatch(JSON.stringify(authenticatedEdgeGeoCountry(valid)), /synthetic-test-only|198\.51/);
});

test('runtime adapter cannot be activated by a loopback allowlist and refuses authenticated mode in PROD', () => {
  const names = ['TAP_GEO_MODE', 'TAP_GEO_EDGE_TOKEN', 'TAP_TRUSTED_GEO_PROXY_ADDRESSES', 'NODE_ENV'] as const;
  const previous = names.map((name) => process.env[name]);
  const token = 'synthetic-test-only-'.padEnd(64, 'x');
  try {
    process.env.NODE_ENV = 'development';
    delete process.env.TAP_GEO_MODE;
    process.env.TAP_GEO_EDGE_TOKEN = token;
    process.env.TAP_TRUSTED_GEO_PROXY_ADDRESSES = '127.0.0.1';
    const request = { remoteAddress: '127.0.0.1', headers: {
      'cf-connecting-ip': '198.51.100.9', 'cf-ipcountry': 'US',
      'x-tap-geo-auth': token, 'x-tap-geo-country': 'BR',
    } };
    assert.deepEqual(trustedGeoCountryForRequest(request), { countryCode: null, source: 'unknown' });
    process.env.TAP_GEO_MODE = 'authenticated-edge-dev';
    assert.deepEqual(trustedGeoCountryForRequest(request), { countryCode: 'BR', source: 'authenticated-edge' });
    process.env.NODE_ENV = 'production';
    assert.deepEqual(trustedGeoCountryForRequest(request), { countryCode: null, source: 'unknown' });
  } finally {
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
  }
});
