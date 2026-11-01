import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cloudflareRangesFromEnv,
  ipInCidrs,
  isLoopbackIp,
  parseCidr,
  resolveClientNetwork,
} from './client-network.js';

const cfEdgeV4 = '172.70.10.20';
const cfEdgeV6 = '2606:4700:10::ac43:1';

test('CIDR IPv4 e IPv6 casam só dentro da faixa', () => {
  const ranges = ['104.16.0.0/13', '2a06:98c0::/29'].map((cidr) => parseCidr(cidr)).filter((c) => c !== undefined);
  assert.equal(ipInCidrs('104.23.255.255', ranges), true);
  assert.equal(ipInCidrs('104.24.0.0', ranges), false);
  assert.equal(ipInCidrs('2a06:98c7:ffff::1', ranges), true);
  assert.equal(ipInCidrs('2a06:98c8::1', ranges), false);
  assert.equal(ipInCidrs('::ffff:104.16.0.1', ranges), true);
  assert.equal(parseCidr('10.0.0.0/33'), undefined);
  assert.equal(parseCidr('not-an-ip/8'), undefined);
});

test('loopback reconhece 127.0.0.0/8, ::1 e IPv4 mapeado', () => {
  assert.equal(isLoopbackIp('127.0.0.1'), true);
  assert.equal(isLoopbackIp('127.8.9.10'), true);
  assert.equal(isLoopbackIp('::1'), true);
  assert.equal(isLoopbackIp('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackIp('0:0:0:0:0:0:0:1'), true);
  assert.equal(isLoopbackIp('10.0.0.1'), false);
  assert.equal(isLoopbackIp('::2'), false);
});

test('Cloudflare -> nginx -> API: usa cf-connecting-ip e cf-ipcountry', () => {
  assert.deepEqual(resolveClientNetwork({
    remoteAddress: '127.0.0.1',
    headers: { 'x-real-ip': cfEdgeV4, 'cf-connecting-ip': '200.160.2.3', 'cf-ipcountry': 'br' },
  }), { ip: '200.160.2.3', countryCode: 'BR', source: 'cloudflare' });
  assert.deepEqual(resolveClientNetwork({
    remoteAddress: '::ffff:127.0.0.1',
    headers: { 'x-real-ip': cfEdgeV6, 'cf-connecting-ip': '2001:db8::5', 'cf-ipcountry': 'PT' },
  }), { ip: '2001:db8::5', countryCode: 'PT', source: 'cloudflare' });
});

test('país desconhecido, Tor e cf-connecting-ip inválido não viram dado', () => {
  for (const country of ['XX', 'ZZ', 'T1', 'BRA', '']) {
    assert.deepEqual(resolveClientNetwork({
      remoteAddress: '127.0.0.1',
      headers: { 'x-real-ip': cfEdgeV4, 'cf-connecting-ip': '200.160.2.3', 'cf-ipcountry': country },
    }), { ip: '200.160.2.3', source: 'cloudflare' });
  }
  assert.deepEqual(resolveClientNetwork({
    remoteAddress: '127.0.0.1',
    headers: { 'x-real-ip': cfEdgeV4, 'cf-connecting-ip': 'forjado', 'cf-ipcountry': 'BR' },
  }), { countryCode: 'BR', source: 'cloudflare' });
});

test('acesso direto à origem via nginx nunca confia em cf-*', () => {
  assert.deepEqual(resolveClientNetwork({
    remoteAddress: '127.0.0.1',
    headers: { 'x-real-ip': '203.0.113.7', 'cf-connecting-ip': '200.160.2.3', 'cf-ipcountry': 'BR' },
  }), { ip: '203.0.113.7', source: 'nginx' });
});

test('peer não loopback ignora todos os headers', () => {
  assert.deepEqual(resolveClientNetwork({
    remoteAddress: '198.51.100.20',
    headers: { 'x-real-ip': cfEdgeV4, 'cf-connecting-ip': '200.160.2.3', 'cf-ipcountry': 'BR' },
  }), { ip: '198.51.100.20', source: 'socket' });
});

test('loopback sem x-real-ip válido, headers em array e peer ausente', () => {
  assert.deepEqual(resolveClientNetwork({ remoteAddress: '127.0.0.1', headers: {} }), { ip: '127.0.0.1', source: 'socket' });
  assert.deepEqual(resolveClientNetwork({
    remoteAddress: '127.0.0.1',
    headers: { 'x-real-ip': [cfEdgeV4], 'cf-connecting-ip': '200.160.2.3', 'cf-ipcountry': 'BR' },
  }), { ip: '127.0.0.1', source: 'socket' });
  assert.deepEqual(resolveClientNetwork({
    remoteAddress: '127.0.0.1',
    headers: { 'x-real-ip': cfEdgeV4, 'cf-connecting-ip': ['200.160.2.3'], 'cf-ipcountry': ['BR'] },
  }), { source: 'cloudflare' });
  assert.deepEqual(resolveClientNetwork({ remoteAddress: undefined, headers: { 'x-real-ip': '203.0.113.7' } }), { source: 'unknown' });
});

test('TAP_CLOUDFLARE_IP_RANGES substitui as faixas embutidas', () => {
  const custom = cloudflareRangesFromEnv('203.0.113.0/24, invalido');
  assert.equal(custom.length, 1);
  assert.deepEqual(resolveClientNetwork({
    remoteAddress: '127.0.0.1',
    headers: { 'x-real-ip': '203.0.113.7', 'cf-connecting-ip': '200.160.2.3', 'cf-ipcountry': 'BR' },
    cloudflareRanges: custom,
  }), { ip: '200.160.2.3', countryCode: 'BR', source: 'cloudflare' });
  assert.deepEqual(resolveClientNetwork({
    remoteAddress: '127.0.0.1',
    headers: { 'x-real-ip': cfEdgeV4, 'cf-connecting-ip': '200.160.2.3' },
    cloudflareRanges: custom,
  }), { ip: cfEdgeV4, source: 'nginx' });
  assert.equal(cloudflareRangesFromEnv('').length, 22);
});
