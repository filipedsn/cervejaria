import { isIP } from 'node:net';

export type ClientNetworkSource = 'cloudflare' | 'nginx' | 'socket' | 'unknown';

export type ClientNetwork = {
  ip?: string;
  countryCode?: string;
  source: ClientNetworkSource;
};

type HeaderValue = string | string[] | undefined;

export const DEFAULT_CLOUDFLARE_IP_RANGES: readonly string[] = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
];

type ParsedCidr = { family: 4 | 6; network: bigint; prefix: number };

export function normalizeIp(value: string | undefined): string | undefined {
  const candidate = value?.trim().toLowerCase();
  if (!candidate) return undefined;
  if (isIP(candidate) === 4) return candidate;
  if (isIP(candidate) === 6) {
    const mappedV4 = candidate.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return mappedV4 && isIP(mappedV4) === 4 ? mappedV4 : candidate;
  }
  return undefined;
}

function ipv4ToBigInt(ip: string): bigint {
  return ip.split('.').reduce((acc, octet) => (acc << 8n) | BigInt(Number(octet)), 0n);
}

function ipv6ToBigInt(ip: string): bigint | undefined {
  let address = ip;
  const embeddedV4 = address.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (embeddedV4) {
    if (isIP(embeddedV4) !== 4) return undefined;
    const v4 = ipv4ToBigInt(embeddedV4);
    address = `${address.slice(0, -embeddedV4.length)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = address.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return undefined;
  if (halves.length === 2 && missing < 1) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return undefined;
    result = (result << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return result;
}

function ipToBigInt(ip: string): { family: 4 | 6; value: bigint } | undefined {
  const normalized = normalizeIp(ip);
  if (!normalized) return undefined;
  if (isIP(normalized) === 4) return { family: 4, value: ipv4ToBigInt(normalized) };
  const value = ipv6ToBigInt(normalized.replace(/%.*$/, ''));
  return value === undefined ? undefined : { family: 6, value };
}

export function parseCidr(cidr: string): ParsedCidr | undefined {
  const [address, prefixText, extra] = cidr.trim().split('/');
  if (!address || extra !== undefined) return undefined;
  const parsed = ipToBigInt(address);
  if (!parsed) return undefined;
  const bits = parsed.family === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? bits : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return undefined;
  const shift = BigInt(bits - prefix);
  return { family: parsed.family, network: (parsed.value >> shift) << shift, prefix };
}

export function ipInCidrs(ip: string, cidrs: readonly ParsedCidr[]): boolean {
  const parsed = ipToBigInt(ip);
  if (!parsed) return false;
  const bits = parsed.family === 4 ? 32 : 128;
  return cidrs.some((cidr) => {
    if (cidr.family !== parsed.family) return false;
    const shift = BigInt(bits - cidr.prefix);
    return (parsed.value >> shift) << shift === cidr.network;
  });
}

export function cloudflareRangesFromEnv(value = process.env.TAP_CLOUDFLARE_IP_RANGES): ParsedCidr[] {
  const configured = (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const source = configured.length > 0 ? configured : DEFAULT_CLOUDFLARE_IP_RANGES;
  return source.map(parseCidr).filter((cidr): cidr is ParsedCidr => cidr !== undefined);
}

export function isLoopbackIp(ip: string): boolean {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  if (isIP(normalized) === 4) return normalized.startsWith('127.');
  return ipv6ToBigInt(normalized) === 1n;
}

function singleHeader(value: HeaderValue): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function countryFromCloudflare(value: HeaderValue): string | undefined {
  const country = singleHeader(value)?.trim().toUpperCase();
  if (!country || !/^[A-Z]{2}$/.test(country) || ['XX', 'ZZ', 'T1'].includes(country)) return undefined;
  return country;
}

/**
 * PRD topology: Cloudflare -> nginx on the same host (X-Real-IP $remote_addr) -> API on loopback.
 * Forwarded headers are trusted only when the immediate peer is loopback, and Cloudflare
 * headers only when nginx saw a Cloudflare edge address.
 */
export function resolveClientNetwork(input: {
  remoteAddress?: string;
  headers: Record<string, HeaderValue>;
  cloudflareRanges?: readonly ParsedCidr[];
}): ClientNetwork {
  const peer = normalizeIp(input.remoteAddress);
  if (!peer) return { source: 'unknown' };
  if (!isLoopbackIp(peer)) return { ip: peer, source: 'socket' };

  const realIp = normalizeIp(singleHeader(input.headers['x-real-ip']));
  if (!realIp) return { ip: peer, source: 'socket' };

  if (ipInCidrs(realIp, input.cloudflareRanges ?? cloudflareRangesFromEnv())) {
    const clientIp = normalizeIp(singleHeader(input.headers['cf-connecting-ip']));
    const countryCode = countryFromCloudflare(input.headers['cf-ipcountry']);
    return {
      ...(clientIp ? { ip: clientIp } : {}),
      ...(countryCode ? { countryCode } : {}),
      source: 'cloudflare',
    };
  }
  return { ip: realIp, source: 'nginx' };
}
