import assert from 'node:assert/strict';
import test from 'node:test';
import { trustedGeoCountry, trustedGeoCountryForRequest, trustedProxyAddressesFromEnv } from './trusted-geolocation.js';

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
